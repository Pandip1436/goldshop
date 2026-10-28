import mongoose from 'mongoose';
import { env } from './config/env';
import { logger } from './lib/logger';

mongoose.set('strictQuery', true);

export async function connectDb(uri = env.mongoUri): Promise<void> {
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
    autoIndex: true,
  });
  // Wait until every index exists — the unique ones are what make payments and webhooks idempotent.
  // (init() only creates missing indexes; it never drops any.)
  await Promise.all(Object.values(mongoose.models).map((m) => m.init().catch((err) => logger.warn({ err, model: m.modelName }, 'Index build failed'))));
  logger.info({ db: mongoose.connection.name }, 'MongoDB connected');
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
