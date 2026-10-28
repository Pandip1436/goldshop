import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', seed: 'scripts/seed.ts', 'create-admin': 'scripts/create-admin.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: true,
  // The shared workspace package is TypeScript source, so it is bundled; real dependencies stay external.
  noExternal: ['@goldshop/shared'],
});
