import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { MongoMemoryServer } from 'mongodb-memory-server';

let server: MongoMemoryServer | undefined;

/** Uses a locally installed mongod when available so tests don't need to download MongoDB. */
function systemBinary(): string | undefined {
  if (process.env.MONGOMS_SYSTEM_BINARY) return process.env.MONGOMS_SYSTEM_BINARY;
  const candidates = [
    'C:\\Program Files\\MongoDB\\Server\\8.2\\bin\\mongod.exe',
    'C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongod.exe',
    'C:\\Program Files\\MongoDB\\Server\\7.0\\bin\\mongod.exe',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  try {
    const found = execSync(process.platform === 'win32' ? 'where mongod' : 'which mongod', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .split(/\r?\n/)[0]
      ?.trim();
    return found || undefined;
  } catch {
    return undefined;
  }
}

export async function setup({ provide }: { provide: (key: string, value: string) => void }) {
  if (process.env.MONGODB_TEST_URI) {
    provide('mongoUri', process.env.MONGODB_TEST_URI);
    return;
  }
  const binary = systemBinary();
  server = await MongoMemoryServer.create({
    binary: binary ? { systemBinary: binary, checkMD5: false } : undefined,
  });
  provide('mongoUri', server.getUri());
}

export async function teardown() {
  await server?.stop();
  fs.rmSync('.test-uploads', { recursive: true, force: true });
}

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}
