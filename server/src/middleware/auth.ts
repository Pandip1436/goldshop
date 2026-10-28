import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role } from '@goldshop/shared';
import { env } from '../config/env';
import { forbidden, unauthorized } from '../lib/errors';
import { User } from '../models';

export const SESSION_COOKIE = 'gs_session';
const SESSION_DAYS = 14;

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  marketingConsent: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

interface SessionClaims {
  sub: string;
  v: number;
}

export function issueSession(res: Response, user: { _id: unknown; tokenVersion?: number }): void {
  const token = jwt.sign({ sub: String(user._id), v: user.tokenVersion ?? 0 } satisfies SessionClaims, env.jwtSecret, {
    expiresIn: `${SESSION_DAYS}d`,
    algorithm: 'HS256',
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: env.cookieSecure, sameSite: 'lax', path: '/' });
}

/** Attaches `req.user` when a valid session cookie is present. Never rejects on its own. */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  try {
    const claims = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] }) as SessionClaims;
    const user = await User.findById(claims.sub)
      .select('name email phone role isActive tokenVersion marketingConsent')
      .lean();
    if (!user || !user.isActive || (user.tokenVersion ?? 0) !== claims.v) {
      clearSession(res);
      return next();
    }
    req.user = {
      id: String(user._id),
      name: user.name,
      email: user.email,
      phone: user.phone ?? '',
      role: user.role as Role,
      marketingConsent: Boolean(user.marketingConsent?.email),
    };
  } catch {
    clearSession(res);
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthorized());
  next();
}

/**
 * Server-side permission map. The admin UI hides what a role cannot do, but these checks are
 * what actually protect the data.
 */
export const PERMISSIONS = {
  'dashboard:read': ['admin', 'staff'],
  'catalog:write': ['admin', 'staff'],
  'inventory:write': ['admin', 'staff'],
  'orders:read': ['admin', 'staff'],
  'orders:write': ['admin', 'staff'],
  'orders:refund': ['admin'],
  'customers:read': ['admin', 'staff'],
  'coupons:write': ['admin'],
  'content:write': ['admin', 'staff'],
  'reviews:write': ['admin', 'staff'],
  'enquiries:write': ['admin', 'staff'],
  'reports:read': ['admin'],
  'rates:write': ['admin', 'staff'],
  'settings:write': ['admin'],
  'staff:write': ['admin'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | undefined, permission: Permission): boolean {
  return Boolean(role && (PERMISSIONS[permission] as readonly Role[]).includes(role));
}

export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(unauthorized());
    if (!can(req.user.role, permission)) return next(forbidden());
    next();
  };
}

export function requireStaff(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'admin' && req.user.role !== 'staff') return next(forbidden());
  next();
}
