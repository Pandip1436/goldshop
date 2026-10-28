import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

/** Directory containing the server's package.json — the same whether running from src/ or the bundled dist/. */
function findServerRoot(): string {
  let dir = import.meta.dirname;
  for (let i = 0; i < 6; i++) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { name?: string };
      if (pkg.name === '@goldshop/server') return dir;
    } catch {
      // keep walking up
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}
const serverRoot = findServerRoot();

// Real environment variables always win over the .env file.
if (process.env.NODE_ENV !== 'test') dotenv.config({ path: path.join(serverRoot, '.env'), quiet: true });

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : v === 'true' || v === '1'));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/gold_shop'),
  JWT_SECRET: z.string().optional(),
  PUBLIC_URL: z.string().url().optional(),
  EXTRA_ORIGINS: z.string().optional().default(''),
  TRUST_PROXY: z.coerce.number().int().min(0).optional(),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  UPLOAD_DIR: z.string().optional(),
  CLIENT_DIST: z.string().optional(),
  PROXY_SECRET: z.string().optional().default(''),
  CRON_SECRET: z.string().optional().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),

  RAZORPAY_KEY_ID: z.string().optional().default(''),
  RAZORPAY_KEY_SECRET: z.string().optional().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(''),

  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().positive().optional().default(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  MAIL_FROM: z.string().optional().default(''),
  ORDER_NOTIFY_EMAIL: z.string().optional().default(''),

  PINCODE_LOOKUP: bool(false),
  ORDER_RESERVATION_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(30),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', z.treeifyError(parsed.error));
  process.exit(1);
}
const raw = parsed.data;
const isProd = raw.NODE_ENV === 'production';
const isTest = raw.NODE_ENV === 'test';

if (isProd && (!raw.JWT_SECRET || raw.JWT_SECRET.length < 32)) {
  console.error('JWT_SECRET must be set to at least 32 random characters in production.');
  process.exit(1);
}
if (isProd && !raw.PUBLIC_URL) {
  console.error('PUBLIC_URL must be set in production (e.g. https://www.yourstore.in).');
  process.exit(1);
}

export const env = {
  nodeEnv: raw.NODE_ENV,
  isProd,
  isTest,
  serverRoot,
  port: raw.PORT,
  mongoUri: raw.MONGODB_URI,
  // In development a per-process secret is acceptable: sessions simply reset on restart.
  jwtSecret: raw.JWT_SECRET ?? crypto.randomBytes(32).toString('hex'),
  publicUrl: (raw.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  extraOrigins: raw.EXTRA_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  trustProxy: raw.TRUST_PROXY ?? (isProd ? 1 : 0),
  cookieSecure: raw.COOKIE_SECURE ? raw.COOKIE_SECURE === 'true' : isProd,
  uploadDir: path.resolve(serverRoot, raw.UPLOAD_DIR ?? 'uploads'),
  clientDist: path.resolve(serverRoot, raw.CLIENT_DIST ?? '../client/dist'),
  // Set when the storefront is served by an edge proxy (Cloudflare Pages): only requests carrying it are answered.
  proxySecret: raw.PROXY_SECRET,
  // Lets an external scheduler (Cloud Scheduler) run the background jobs on hosts that idle between requests.
  cronSecret: raw.CRON_SECRET,
  logLevel: raw.LOG_LEVEL ?? (isTest ? 'silent' : isProd ? 'info' : 'debug'),
  razorpay: {
    keyId: raw.RAZORPAY_KEY_ID,
    keySecret: raw.RAZORPAY_KEY_SECRET,
    webhookSecret: raw.RAZORPAY_WEBHOOK_SECRET,
    get enabled() {
      return Boolean(this.keyId && this.keySecret);
    },
  },
  smtp: {
    host: raw.SMTP_HOST,
    port: raw.SMTP_PORT,
    secure: raw.SMTP_SECURE,
    user: raw.SMTP_USER,
    pass: raw.SMTP_PASS,
    from: raw.MAIL_FROM,
    notify: raw.ORDER_NOTIFY_EMAIL,
    get enabled() {
      return Boolean(this.host && this.from);
    },
  },
  pincodeLookup: raw.PINCODE_LOOKUP,
  reservationMinutes: raw.ORDER_RESERVATION_MINUTES,
};

export type Env = typeof env;
