import fs from 'node:fs';
import path from 'node:path';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import express, { type Request, type Response } from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { pinoHttp } from 'pino-http';
import { env } from './config/env';
import { logger } from './lib/logger';
import { authenticate } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/errors';
import { runJobs } from './jobs';
import { safeEqual } from './lib/crypto';
import { apiLimiter, edgeProxyGuard, originCheck } from './middleware/security';
import { accountRouter } from './routes/account';
import { adminRouter } from './routes/admin';
import { authRouter } from './routes/auth';
import { cartRouter } from './routes/cart';
import { catalogRouter } from './routes/catalog';
import { contentRouter } from './routes/content';
import { ordersRouter, webhookRouter } from './routes/orders';
import { pageHead, renderPage, robotsTxt, sitemapXml } from './services/seo';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.trustProxy);
  app.set('query parser', 'simple');
  app.use(edgeProxyGuard);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'script-src': ["'self'", 'https://checkout.razorpay.com'],
          'frame-src': ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com', 'https://www.google.com'],
          'connect-src': ["'self'", 'https://api.razorpay.com', 'https://lumberjack.razorpay.com'],
          'img-src': ["'self'", 'data:', 'blob:', 'https:'],
          'style-src': ["'self'", "'unsafe-inline'"],
          'font-src': ["'self'", 'data:'],
          'form-action': ["'self'", 'https://api.razorpay.com'],
          'upgrade-insecure-requests': env.isProd ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      // Razorpay Checkout opens popups for some banks/UPI apps.
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    }),
  );
  app.use(compression());
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => !req.url?.startsWith('/api') || req.url === '/api/health' },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    }),
  );

  // Health check for load balancers / uptime monitors.
  app.get('/api/health', (_req, res) => {
    const db = mongoose.connection.readyState === 1;
    res.status(db ? 200 : 503).json({ ok: db, db: db ? 'connected' : 'disconnected' });
  });

  // Background jobs on demand, for hosts that pause the CPU between requests (see jobs.ts).
  app.post('/api/internal/jobs', async (req, res) => {
    if (!env.cronSecret) return void res.status(404).end();
    if (!safeEqual(req.get('x-cron-secret') ?? '', env.cronSecret)) return void res.status(403).end();
    const ran = await runJobs();
    res.json({ ok: true, ran });
  });

  // Webhooks need the raw body for signature verification, so they go before the JSON parser.
  app.use('/api', webhookRouter);

  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());
  app.use('/api', apiLimiter, originCheck, authenticate);

  app.use('/api', catalogRouter);
  app.use('/api', cartRouter);
  app.use('/api', ordersRouter);
  app.use('/api', authRouter);
  app.use('/api', accountRouter);
  app.use('/api', contentRouter);
  // SEO tags for the Cloudflare Pages function, which serves index.html from the edge.
  app.get('/api/seo/head', async (req, res) => {
    const urlPath = typeof req.query.path === 'string' && req.query.path.startsWith('/') ? req.query.path.slice(0, 500) : '/';
    res.set('Cache-Control', 'no-cache').json(await pageHead(urlPath));
  });
  app.use('/api/admin', adminRouter);
  app.use('/api', notFoundHandler);

  // Uploaded images: file names are content-addressed by random key, so cache them forever.
  app.use(
    '/uploads',
    express.static(env.uploadDir, {
      immutable: true,
      maxAge: '365d',
      index: false,
      fallthrough: false,
      setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
    }),
  );

  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').send(robotsTxt());
  });
  app.get('/sitemap.xml', async (_req, res) => {
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(await sitemapXml());
  });

  // Production: serve the built storefront, with per-route SEO tags rendered on the server.
  const indexHtml = path.join(env.clientDist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(
      '/assets',
      express.static(path.join(env.clientDist, 'assets'), { immutable: true, maxAge: '365d', index: false, fallthrough: false }),
    );
    app.use(express.static(env.clientDist, { index: false, maxAge: '1h' }));
    // '/{*splat}' (optional splat) also matches the root path in Express 5.
    app.get('/{*splat}', async (req: Request, res: Response) => {
      const { html, status } = await renderPage(req.path);
      res.status(status).set('Cache-Control', 'no-cache').type('html').send(html);
    });
  }

  app.use(errorHandler);
  return app;
}
