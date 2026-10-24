import { defineConfig } from 'drizzle-kit';
import { validateEnv } from './src/env.ts';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: { url: validateEnv(process.env).DATABASE_URL },
});
