// Ensure database has all required tables and columns
require('dotenv').config();
const { Client } = require('pg');

async function ensureSchema() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log('No DATABASE_URL provided, skipping schema check');
    return;
  }

  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    console.log('✅ Database connection successful');

    // Check if ct_organization_requests table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'ct_organization_requests'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('❌ ct_organization_requests table missing');
      console.log('🔧 Creating organization requests table...');

      // Run the basic table creation
      await client.query(`
        CREATE TABLE IF NOT EXISTS ct_organization_requests (
          id SERIAL PRIMARY KEY,
          org_name TEXT NOT NULL,
          org_type TEXT NOT NULL,
          description TEXT,
          address TEXT,
          city TEXT,
          state TEXT,
          zip_code TEXT,
          country TEXT DEFAULT 'United States',
          contact_name TEXT NOT NULL,
          contact_email TEXT NOT NULL,
          contact_phone TEXT,
          requested_subdomain TEXT NOT NULL,
          status TEXT DEFAULT 'pending',
          submitted_at TIMESTAMP DEFAULT NOW(),
          reviewed_at TIMESTAMP,
          reviewed_by INTEGER,
          review_notes TEXT,
          approval_email_sent BOOLEAN DEFAULT FALSE,
          organization_id INTEGER,
          admin_account_created BOOLEAN DEFAULT FALSE,
          setup_token TEXT,
          setup_token_expires_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
      `);
      console.log('✅ Basic table created');
    }

    // Check for new columns and add them if missing
    const columnCheck = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'ct_organization_requests'
      AND column_name IN ('street_address', 'first_name', 'last_name', 'website', 'bracelet_uid');
    `);

    const existingColumns = columnCheck.rows.map(row => row.column_name);
    const requiredColumns = ['street_address', 'first_name', 'last_name', 'website', 'bracelet_uid'];
    const missingColumns = requiredColumns.filter(col => !existingColumns.includes(col));

    if (missingColumns.length > 0) {
      console.log(`🔧 Adding missing columns: ${missingColumns.join(', ')}`);

      for (const column of missingColumns) {
        await client.query(`ALTER TABLE ct_organization_requests ADD COLUMN IF NOT EXISTS ${column} TEXT;`);
      }
      console.log('✅ Missing columns added');
    }

    // Create indexes if they don't exist
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_ct_org_requests_status ON ct_organization_requests(status)',
      'CREATE INDEX IF NOT EXISTS idx_ct_org_requests_submitted_at ON ct_organization_requests(submitted_at)',
      'CREATE INDEX IF NOT EXISTS idx_ct_org_requests_subdomain ON ct_organization_requests(requested_subdomain)'
    ];

    for (const indexQuery of indexes) {
      await client.query(indexQuery);
    }

    console.log('✅ Database schema is ready');

  } catch (error) {
    console.error('❌ Database schema check failed:', error.message);
    // Don't fail the startup, just log the error
  } finally {
    await client.end();
  }
}

// Run if called directly
if (require.main === module) {
  ensureSchema()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Schema check failed:', err);
      process.exit(0); // Don't fail startup
    });
}

module.exports = { ensureSchema };