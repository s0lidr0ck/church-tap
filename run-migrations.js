const MigrationSystem = require('./migrations/migration-system');
const path = require('path');

async function runMigrations() {
  const dbPath = path.join(__dirname, 'database.db');
  const migrationSystem = new MigrationSystem(dbPath);

  try {
    console.log('🚀 Starting database migrations...');
    await migrationSystem.migrate();
    console.log('✅ All migrations completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    migrationSystem.close();
  }
}

// Run migrations if this script is executed directly
if (require.main === module) {
  runMigrations();
}

module.exports = runMigrations;