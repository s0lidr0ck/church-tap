// Applies migrations/postgres/000_init.sql against DATABASE_URL
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const sqlPath = path.join(__dirname, '..', 'migrations', 'postgres', '000_init.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Split on semicolons while keeping statements simple; allow dollar-quoted bodies as-is
  // For our schema, straightforward split is sufficient
  const statements = sql
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(Boolean);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    for (const stmt of statements) {
      await client.query(stmt);
    }
    await client.query('COMMIT');
    console.log('✅ Postgres schema initialized.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Postgres initialization failed:', err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main();
}


