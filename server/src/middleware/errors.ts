import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import type { ApiErrorBody } from '@goldshop/shared';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` } } satisfies ApiErrorBody);
}

/** Centralised error handler: every API error leaves in the same JSON shape. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) return;

  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err, path: req.path }, err.message);
    res.status(err.status).json({
      error: { code: err.code, message: err.message, fields: err.fields, details: err.details },
    } satisfies ApiErrorBody);
    return;
  }

  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Each image must be under 10 MB.' : 'Upload failed.';
    res.status(400).json({ error: { code: 'upload_error', message } } satisfies ApiErrorBody);
    return;
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const fields = Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message]));
    res.status(400).json({ error: { code: 'validation_error', message: 'Please check the highlighted fields.', fields } } satisfies ApiErrorBody);
    return;
  }

  if ((err as { code?: number }).code === 11000) {
    const key = Object.keys((err as { keyPattern?: Record<string, unknown> }).keyPattern ?? {})[0] ?? 'value';
    res.status(409).json({
      error: { code: 'duplicate', message: `That ${key} is already in use.`, fields: { [key]: 'Already in use' } },
    } satisfies ApiErrorBody);
    return;
  }

  // body-parser errors (malformed JSON, payload too large)
  const status = (err as { status?: number; type?: string }).status;
  if (status && status >= 400 && status < 500) {
    res.status(status).json({ error: { code: 'bad_request', message: 'The request could not be read.' } } satisfies ApiErrorBody);
    return;
  }

  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong on our side. Please try again.' } } satisfies ApiErrorBody);
}
