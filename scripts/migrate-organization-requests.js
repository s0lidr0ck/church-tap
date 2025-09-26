// Run the organization requests migration
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const sqlPath = path.join(__dirname, '..', 'migrations', 'postgres', '010_create_organization_requests.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Split on semicolons while keeping statements simple
  const statements = sql
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(Boolean);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    for (const stmt of statements) {
      console.log('Executing:', stmt.substring(0, 100) + '...');
      await client.query(stmt);
    }
    await client.query('COMMIT');
    console.log('✅ Organization requests migration completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main();
}