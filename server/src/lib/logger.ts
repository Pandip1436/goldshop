import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.logLevel,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-razorpay-signature"]',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.razorpay_signature',
    ],
    censor: '[redacted]',
  },
  ...(env.isProd || env.isTest
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }),
});
