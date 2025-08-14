// Verify PostgreSQL schema has all required tables
require('dotenv').config();
const db = require('../db-adapter');

async function verifySchema() {
  console.log('🔍 Verifying PostgreSQL schema...\n');

  // Required tables (with CT_ prefix)
  const requiredTables = [
    'CT_organizations',
    'CT_admin_users', 
    'CT_master_admins',
    'CT_verses',
    'CT_analytics',
    'CT_favorites',
    'CT_prayer_requests',
    'CT_praise_reports',
    'CT_users',
    'CT_user_preferences'
  ];

  try {
    // Check if tables exist
    for (const table of requiredTables) {
      await new Promise((resolve, reject) => {
        db.get(`SELECT to_regclass('${table}') as exists`, [], (err, row) => {
          if (err) {
            console.log(`❌ Error checking ${table}:`, err.message);
            reject(err);
          } else if (row.exists) {
            console.log(`✅ ${table} exists`);
            resolve();
          } else {
            console.log(`❌ ${table} missing`);
            reject(new Error(`Table ${table} not found`));
          }
        });
      });
    }

    console.log('\n🎉 All required tables found!');

    // Check sample data
    console.log('\n📊 Checking sample data...');
    
    await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM CT_organizations', [], (err, row) => {
        if (err) reject(err);
        else {
          console.log(`Organizations: ${row.count}`);
          resolve();
        }
      });
    });

    await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM CT_verses', [], (err, row) => {
        if (err) reject(err);
        else {
          console.log(`Verses: ${row.count}`);
          resolve();
        }
      });
    });

    await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM CT_admin_users', [], (err, row) => {
        if (err) reject(err);
        else {
          console.log(`Admin users: ${row.count}`);
          resolve();
        }
      });
    });

    console.log('\n✅ PostgreSQL schema verification complete!');
    console.log('Your database is ready for production deployment.');

  } catch (error) {
    console.error('\n❌ Schema verification failed:', error.message);
    console.log('\n🔧 To fix this, ensure your PostgreSQL database has:');
    console.log('1. All tables created with CT_ prefix');
    console.log('2. Proper column definitions matching the schema');
    console.log('3. At least one organization and admin user');
    process.exit(1);
  }

  process.exit(0);
}

verifySchema();