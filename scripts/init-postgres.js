// Applies all migrations in migrations/postgres/*.sql against DATABASE_URL (idempotent)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const migrationsDir = path.join(__dirname, '..', 'migrations', 'postgres');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    for (const file of files) {
      const sqlPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(sqlPath, 'utf8');
      await client.query(sql);
      console.log(`✅ Applied: ${file}`);
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


