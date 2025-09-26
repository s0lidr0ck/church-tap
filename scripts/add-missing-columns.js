// Add missing columns to ct_organization_requests table
require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query('BEGIN');

    // Add missing columns
    const alterStatements = [
      'ALTER TABLE ct_organization_requests ADD COLUMN IF NOT EXISTS street_address TEXT',
      'ALTER TABLE ct_organization_requests ADD COLUMN IF NOT EXISTS first_name TEXT',
      'ALTER TABLE ct_organization_requests ADD COLUMN IF NOT EXISTS last_name TEXT',
      'ALTER TABLE ct_organization_requests ADD COLUMN IF NOT EXISTS website TEXT',
      'ALTER TABLE ct_organization_requests ADD COLUMN IF NOT EXISTS bracelet_uid TEXT',
      'ALTER TABLE ct_organization_requests ADD COLUMN IF NOT EXISTS source_ip TEXT',
      'ALTER TABLE ct_organization_requests ADD COLUMN IF NOT EXISTS user_agent TEXT'
    ];

    for (const stmt of alterStatements) {
      console.log('Executing:', stmt);
      await client.query(stmt);
    }

    // Add missing indexes
    const indexStatements = [
      'CREATE INDEX IF NOT EXISTS idx_ct_org_requests_status ON ct_organization_requests(status)',
      'CREATE INDEX IF NOT EXISTS idx_ct_org_requests_submitted_at ON ct_organization_requests(submitted_at)',
      'CREATE INDEX IF NOT EXISTS idx_ct_org_requests_subdomain ON ct_organization_requests(requested_subdomain)',
      'CREATE INDEX IF NOT EXISTS idx_ct_org_requests_bracelet_uid ON ct_organization_requests(bracelet_uid)',
      'CREATE INDEX IF NOT EXISTS idx_ct_org_requests_organization_id ON ct_organization_requests(organization_id)'
    ];

    for (const stmt of indexStatements) {
      console.log('Executing:', stmt);
      await client.query(stmt);
    }

    await client.query('COMMIT');
    console.log('✅ Missing columns and indexes added successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to add columns:', err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main();
}