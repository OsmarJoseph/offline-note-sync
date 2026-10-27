import { defineConfig } from 'vitest/config';

process.loadEnvFile();

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    env: { ENABLE_DEV_ROUTES: 'true' },
  },
});
