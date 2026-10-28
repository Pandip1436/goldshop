import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup.ts'],
    // Each file gets its own database; files run in parallel against one in-memory server.
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
      PUBLIC_URL: 'http://localhost:5173',
      RAZORPAY_KEY_ID: 'rzp_test_dummykey',
      RAZORPAY_KEY_SECRET: 'test_key_secret',
      RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret',
      UPLOAD_DIR: '.test-uploads',
      LOG_LEVEL: 'silent',
    },
  },
});
