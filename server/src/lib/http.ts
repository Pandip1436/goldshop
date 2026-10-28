import type { Request } from 'express';
import { Types } from 'mongoose';
import type { z } from 'zod';
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from '@goldshop/shared';
import { badRequest, notFound } from './errors';

/** Parses a body/query with a zod schema, turning issues into a field map the UI can show inline. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  const first = Object.values(fields)[0] ?? 'Please check the highlighted fields.';
  throw badRequest(first, fields, 'validation_error');
}

export function objectId(value: unknown, label = 'Resource'): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value) || !/^[a-f0-9]{24}$/i.test(value)) {
    throw notFound(`${label} not found.`);
  }
  return new Types.ObjectId(value);
}

export function pagination(req: Request, maxLimit = PAGE_SIZE_MAX, defaultLimit = PAGE_SIZE_DEFAULT) {
  const page = Math.max(1, Math.min(1000, Number.parseInt(String(req.query.page ?? '1'), 10) || 1));
  const limit = Math.max(1, Math.min(maxLimit, Number.parseInt(String(req.query.limit ?? defaultLimit), 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

export function paginated<T>(items: T[], total: number, page: number, limit: number) {
  return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

/** Escapes user input for safe use inside a RegExp. */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function queryString(value: unknown, max = 100): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v ? v.slice(0, max) : undefined;
}

export function queryInt(value: unknown): number | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}
