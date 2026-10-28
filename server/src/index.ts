import fs from 'node:fs';
import { createApp } from './app';
import { env } from './config/env';
import { connectDb, disconnectDb } from './db';
import { startJobs, stopJobs } from './jobs';
import { logger } from './lib/logger';
import './models';

async function main() {
  fs.mkdirSync(env.uploadDir, { recursive: true });
  await connectDb();
  const app = createApp();
  const server = app.listen(env.port, () => {
    logger.info(
      {
        port: env.port,
        publicUrl: env.publicUrl,
        razorpay: env.razorpay.enabled ? (env.razorpay.keyId.startsWith('rzp_live_') ? 'live' : 'test') : 'not configured',
        email: env.smtp.enabled ? 'smtp' : 'not configured',
      },
      'Server ready',
    );
  });
  startJobs();

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    stopJobs();
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
