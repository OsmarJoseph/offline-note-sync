import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';
import { validateEnv } from '../src/env.ts';

const MAINTENANCE_DATABASE = 'postgres';

export async function setup(): Promise<void> {
  const databaseUrl = validateEnv(process.env).DATABASE_URL;
  await createDatabaseIfMissing(new URL(databaseUrl));
  const database = drizzle(databaseUrl);
  await migrate(database, { migrationsFolder: join(import.meta.dirname, '../drizzle') });
  await database.$client.end();
}

async function createDatabaseIfMissing(databaseUrl: URL): Promise<void> {
  const databaseName = databaseUrl.pathname.slice(1);
  const maintenanceUrl = new URL(databaseUrl);
  maintenanceUrl.pathname = `/${MAINTENANCE_DATABASE}`;
  const client = new Client({ connectionString: maintenanceUrl.href });
  await client.connect();
  try {
    const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [
      databaseName,
    ]);
    if (rowCount === 0) {
      await client.query(`create database ${client.escapeIdentifier(databaseName)}`);
    }
  } finally {
    await client.end();
  }
}
