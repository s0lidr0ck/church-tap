const { db } = require('./config/database');

async function runRecurringEventsMigration() {
  console.log('🔄 Starting recurring events migration...');

  const migrationSQL = `
    -- Add recurring event functionality to CT_events table
    DO $$
    BEGIN
        -- Add columns for recurring functionality
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ct_events' AND column_name = 'is_recurring') THEN
            ALTER TABLE CT_events ADD COLUMN is_recurring BOOLEAN DEFAULT FALSE;
            RAISE NOTICE 'Added is_recurring column';
        ELSE
            RAISE NOTICE 'is_recurring column already exists';
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ct_events' AND column_name = 'recurrence_type') THEN
            ALTER TABLE CT_events ADD COLUMN recurrence_type TEXT;
            RAISE NOTICE 'Added recurrence_type column';
        ELSE
            RAISE NOTICE 'recurrence_type column already exists';
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ct_events' AND column_name = 'recurrence_interval') THEN
            ALTER TABLE CT_events ADD COLUMN recurrence_interval INTEGER DEFAULT 1;
            RAISE NOTICE 'Added recurrence_interval column';
        ELSE
            RAISE NOTICE 'recurrence_interval column already exists';
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ct_events' AND column_name = 'recurrence_days') THEN
            ALTER TABLE CT_events ADD COLUMN recurrence_days TEXT;
            RAISE NOTICE 'Added recurrence_days column';
        ELSE
            RAISE NOTICE 'recurrence_days column already exists';
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ct_events' AND column_name = 'recurrence_end_date') THEN
            ALTER TABLE CT_events ADD COLUMN recurrence_end_date TIMESTAMP;
            RAISE NOTICE 'Added recurrence_end_date column';
        ELSE
            RAISE NOTICE 'recurrence_end_date column already exists';
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ct_events' AND column_name = 'parent_event_id') THEN
            ALTER TABLE CT_events ADD COLUMN parent_event_id INTEGER REFERENCES CT_events(id) ON DELETE CASCADE;
            RAISE NOTICE 'Added parent_event_id column';
        ELSE
            RAISE NOTICE 'parent_event_id column already exists';
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ct_events' AND column_name = 'instance_date') THEN
            ALTER TABLE CT_events ADD COLUMN instance_date DATE;
            RAISE NOTICE 'Added instance_date column';
        ELSE
            RAISE NOTICE 'instance_date column already exists';
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ct_events' AND column_name = 'is_instance') THEN
            ALTER TABLE CT_events ADD COLUMN is_instance BOOLEAN DEFAULT FALSE;
            RAISE NOTICE 'Added is_instance column';
        ELSE
            RAISE NOTICE 'is_instance column already exists';
        END IF;
    END $$;

    -- Create indexes for better performance
    CREATE INDEX IF NOT EXISTS idx_ct_events_recurring ON CT_events(is_recurring) WHERE is_recurring = TRUE;
    CREATE INDEX IF NOT EXISTS idx_ct_events_parent ON CT_events(parent_event_id) WHERE parent_event_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_ct_events_instance_date ON CT_events(instance_date) WHERE instance_date IS NOT NULL;
  `;

  try {
    await db.query(migrationSQL);
    console.log('✅ Recurring events migration completed successfully!');
    console.log('📊 The following features are now enabled:');
    console.log('   • Recurring events (daily, weekly, monthly)');
    console.log('   • Automatic instance generation');
    console.log('   • Event series management');
    console.log('   • Individual instance editing');

    // Verify the migration worked
    const checkResult = await db.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'ct_events' AND column_name IN ('is_recurring', 'recurrence_type', 'parent_event_id')
      ORDER BY column_name
    `);

    console.log(`\n🔍 Verification: Found ${checkResult.rows.length}/3 key recurring columns`);
    checkResult.rows.forEach(row => {
      console.log(`   ✓ ${row.column_name}`);
    });

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  }

  process.exit(0);
}

// Run the migration
console.log('🚀 Church Tap - Recurring Events Migration');
console.log('==========================================');
runRecurringEventsMigration();