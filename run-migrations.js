// Disabled legacy SQLite migrations
// App Runner build previously invoked `node run-migrations.js` which required SQLite.
// We now use Postgres only and initialize schema via `scripts/init-postgres.js` when needed.
// Keep this file as a no-op so existing build pipelines succeed.

async function runMigrations() {
  console.log('⏭️  Skipping legacy SQLite migrations (Postgres-only deployment).');
  return true;
}

if (require.main === module) {
  runMigrations();
}

module.exports = runMigrations;