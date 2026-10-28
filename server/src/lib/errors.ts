export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, fields?: Record<string, string>, code = 'bad_request') =>
  new AppError(400, code, message, fields);
export const unauthorized = (message = 'Please sign in to continue.') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have permission to do that.') => new AppError(403, 'forbidden', message);
export const notFound = (message = 'Not found.') => new AppError(404, 'not_found', message);
export const conflict = (message: string, code = 'conflict', details?: unknown) =>
  new AppError(409, code, message, undefined, details);
export const unprocessable = (message: string, code = 'unprocessable', details?: unknown) =>
  new AppError(422, code, message, undefined, details);
export const serviceUnavailable = (message: string, code = 'unavailable') => new AppError(503, code, message);
