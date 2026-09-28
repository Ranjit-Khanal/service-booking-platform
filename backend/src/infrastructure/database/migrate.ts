// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const sql = await fs.readFile(path.join(__dirname, 'migrations', '001_init.sql'), 'utf8');
    await client.query(sql);
    console.log('Migration 001_init applied');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
