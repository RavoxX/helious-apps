import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@helious/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 180000,
    fileParallelism: false,
  },
});
