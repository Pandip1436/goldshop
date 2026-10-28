import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, beforeAll, inject } from 'vitest';
import '../src/models';

beforeAll(async () => {
  const base = inject('mongoUri');
  // A private database per test file keeps files independent while sharing one server.
  const dbName = `goldshop_test_${crypto.randomBytes(4).toString('hex')}`;
  const url = new URL(base);
  url.pathname = `/${dbName}`;
  await mongoose.connect(url.toString());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});

afterAll(async () => {
  // Only ever drops the throwaway database this file created.
  if (mongoose.connection.name?.startsWith('goldshop_test_')) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
