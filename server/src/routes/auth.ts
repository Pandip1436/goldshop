import bcrypt from 'bcryptjs';
import { Router, type Request, type Response } from 'express';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  type SessionUser,
} from '@goldshop/shared';
import { env } from '../config/env';
import { randomToken, sha256 } from '../lib/crypto';
import { badRequest, conflict, unauthorized } from '../lib/errors';
import { logger } from '../lib/logger';
import { parse } from '../lib/http';
import { clearSession, issueSession } from '../middleware/auth';
import { authLimiter } from '../middleware/security';
import { User } from '../models';
import { mergeGuestCart } from '../services/cart';
import { sendPasswordResetEmail } from '../services/notifications';
import { CART_COOKIE } from './cart';

export const BCRYPT_ROUNDS = 12;
// Compared against when the email doesn't exist, so response time doesn't reveal which emails have accounts.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export function toSessionUser(u: {
  _id: unknown;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
  marketingConsent?: { email?: boolean | null } | null;
}): SessionUser {
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    phone: u.phone || undefined,
    role: u.role as SessionUser['role'],
    marketingConsent: Boolean(u.marketingConsent?.email),
  };
}

async function adoptGuestCart(req: Request, res: Response, userId: string) {
  const guestToken = req.cookies?.[CART_COOKIE];
  if (typeof guestToken === 'string' && guestToken) {
    await mergeGuestCart(guestToken, userId).catch((err) => logger.warn({ err }, 'cart merge failed'));
    res.clearCookie(CART_COOKIE, { path: '/' });
  }
}

export const authRouter = Router();

authRouter.get('/auth/me', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ user: req.user ? { ...req.user, phone: req.user.phone || undefined } : null });
});

authRouter.post('/auth/register', authLimiter, async (req, res) => {
  const input = parse(registerSchema, req.body);
  if (await User.exists({ email: input.email })) {
    throw conflict('An account with this email already exists. Please sign in instead.', 'email_taken');
  }
  const user = await User.create({
    name: input.name,
    email: input.email,
    phone: input.phone,
    passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
    role: 'customer',
    marketingConsent: { email: input.marketingConsent, updatedAt: new Date() },
  });
  issueSession(res, user);
  await adoptGuestCart(req, res, String(user._id));
  res.status(201).json({ user: toSessionUser(user) });
});

authRouter.post('/auth/login', authLimiter, async (req, res) => {
  const input = parse(loginSchema, req.body);
  const user = await User.findOne({ email: input.email }).select('+passwordHash');
  const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok || !user.isActive) throw unauthorized('Email or password is incorrect.');
  user.lastLoginAt = new Date();
  await user.save();
  issueSession(res, user);
  await adoptGuestCart(req, res, String(user._id));
  res.json({ user: toSessionUser(user) });
});

authRouter.post('/auth/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.post('/auth/forgot-password', authLimiter, async (req, res) => {
  const { email } = parse(forgotPasswordSchema, req.body);
  const user = await User.findOne({ email, isActive: true });
  if (user) {
    const token = randomToken(32);
    await User.updateOne(
      { _id: user._id },
      { $set: { resetTokenHash: sha256(token), resetTokenExpires: new Date(Date.now() + 30 * 60_000) } },
    );
    const sent = await sendPasswordResetEmail(user.email, user.name, token);
    if (!sent && !env.isProd) {
      logger.info({ link: `${env.publicUrl}/reset-password?token=${token}` }, 'Password reset link (SMTP not configured; dev only)');
    }
  }
  // Identical response either way, so this endpoint can't be used to discover accounts.
  res.json({ ok: true, message: 'If an account exists for that email, we have sent a link to reset the password.' });
});

authRouter.post('/auth/reset-password', authLimiter, async (req, res) => {
  const { token, password } = parse(resetPasswordSchema, req.body);
  const user = await User.findOne({ resetTokenHash: sha256(token), resetTokenExpires: { $gt: new Date() } }).select(
    '+resetTokenHash +resetTokenExpires',
  );
  if (!user) throw badRequest('This reset link is invalid or has expired. Please request a new one.', undefined, 'token_invalid');
  user.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  user.resetTokenHash = undefined;
  user.resetTokenExpires = undefined;
  await user.save();
  issueSession(res, user);
  res.json({ user: toSessionUser(user) });
});
