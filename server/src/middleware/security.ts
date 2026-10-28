import type { NextFunction, Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/env';
import { safeEqual } from '../lib/crypto';
import { forbidden } from '../lib/errors';

/** Paths answered without the proxy secret: uptime checks, and the scheduler (which has its own secret). */
const PROXY_EXEMPT = new Set(['/api/health', '/api/internal/jobs']);

/**
 * When the storefront is served by Cloudflare Pages, its function forwards every request here with
 * PROXY_SECRET and the visitor's IP. Requests that skip the proxy (straight to the *.run.app address)
 * are refused, so nobody can bypass it to forge their IP and dodge the rate limits.
 */
export function edgeProxyGuard(req: Request, _res: Response, next: NextFunction): void {
  if (!env.proxySecret || PROXY_EXEMPT.has(req.path)) return next();
  if (!safeEqual(req.get('x-proxy-secret') ?? '', env.proxySecret)) return next(forbidden('Requests must come through the storefront.'));
  // The proxy's own address is all the network sees, so take the visitor's from the header it sent.
  const clientIp = req.get('x-client-ip');
  if (clientIp) req.headers['x-forwarded-for'] = clientIp;
  delete req.headers['x-proxy-secret'];
  next();
}

const allowedOrigins = new Set([env.publicUrl, ...env.extraOrigins]);
if (!env.isProd) {
  allowedOrigins.add('http://localhost:5173');
  allowedOrigins.add('http://127.0.0.1:5173');
  allowedOrigins.add(`http://localhost:${env.port}`);
  allowedOrigins.add(`http://127.0.0.1:${env.port}`);
}

/**
 * Development only: allow the dev server opened from another device on the local network
 * (e.g. testing on a phone at http://192.168.1.20:5173). Never applies in production.
 */
const LAN_DEV_ORIGIN = /^http:\/\/(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):(5173|4000)$/;

function isAllowedOrigin(origin: string): boolean {
  if (allowedOrigins.has(origin)) return true;
  return !env.isProd && LAN_DEV_ORIGIN.test(origin);
}

/**
 * CSRF defence for cookie-authenticated APIs: browsers always send Origin on cross-site
 * state-changing requests, so anything from an unknown origin is refused. SameSite=Lax cookies
 * provide a second layer. Non-browser clients (no Origin header) are unaffected.
 */
export function originCheck(req: Request, _res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  const site = req.get('sec-fetch-site');
  if (origin && !isAllowedOrigin(origin)) return next(forbidden('Request origin not allowed.'));
  if (!origin && site === 'cross-site') return next(forbidden('Cross-site request blocked.'));
  next();
}

const json = (message: string) => ({ error: { code: 'rate_limited', message } });

function limiter(windowMinutes: number, limit: number, message: string, keyByEmail = false) {
  return rateLimit({
    windowMs: windowMinutes * 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => env.isTest,
    message: json(message),
    keyGenerator: (req) => {
      const ip = ipKeyGenerator(req.ip ?? '');
      const email = keyByEmail && typeof req.body?.email === 'string' ? req.body.email.toLowerCase().slice(0, 254) : '';
      return email ? `${ip}:${email}` : ip;
    },
  });
}

export const apiLimiter = limiter(1, 300, 'Too many requests. Please slow down.');
export const authLimiter = limiter(15, 20, 'Too many sign-in attempts. Please wait a few minutes.', true);
export const checkoutLimiter = limiter(10, 30, 'Too many checkout attempts. Please wait a few minutes.');
export const formLimiter = limiter(10, 8, 'Too many submissions. Please try again later.');
export const lookupLimiter = limiter(10, 30, 'Too many lookups. Please try again later.');
