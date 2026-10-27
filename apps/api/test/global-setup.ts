import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { validateEnv } from '../src/env.ts';

export async function setup(): Promise<void> {
  const database = drizzle(validateEnv(process.env).DATABASE_URL);
  await migrate(database, { migrationsFolder: join(import.meta.dirname, '../drizzle') });
  await database.$client.end();
}
