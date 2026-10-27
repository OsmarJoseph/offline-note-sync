import { defineConfig } from 'vitest/config';
import { validateEnv } from './src/env.ts';

process.loadEnvFile();
process.env.DATABASE_URL = testDatabaseUrl(validateEnv(process.env).DATABASE_URL);

function testDatabaseUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `${url.pathname}_test`;
  return url.href;
}

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    env: { ENABLE_DEV_ROUTES: 'true' },
  },
});
