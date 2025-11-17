const { db } = require('./config/database');
const fs = require('fs');
const path = require('path');

console.log('🔧 Running tag attribution columns migration...');

const migrationFile = path.join(__dirname, 'migrations', 'postgres', '011_add_tag_attribution_columns.sql');
const sql = fs.readFileSync(migrationFile, 'utf8');

db.query(sql, (err, result) => {
  if (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
  
  console.log('✅ Migration completed successfully!');
  console.log('📊 Added columns: originating_tag_id, tagged_session_id');
  console.log('🔍 Run the debug endpoint to verify: /api/master/analytics/debug-database');
  process.exit(0);
});

