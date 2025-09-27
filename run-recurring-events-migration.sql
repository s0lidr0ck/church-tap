-- Add recurring event functionality to CT_events table
-- This allows events to be created once and repeat automatically

-- First, let's check if CT_events table exists and add recurring columns
DO $$
BEGIN
    -- Add columns for recurring functionality
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ct_events' AND column_name = 'is_recurring') THEN
        ALTER TABLE CT_events ADD COLUMN is_recurring BOOLEAN DEFAULT FALSE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ct_events' AND column_name = 'recurrence_type') THEN
        ALTER TABLE CT_events ADD COLUMN recurrence_type TEXT; -- 'weekly', 'monthly', 'daily'
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ct_events' AND column_name = 'recurrence_interval') THEN
        ALTER TABLE CT_events ADD COLUMN recurrence_interval INTEGER DEFAULT 1; -- Every N weeks/months/days
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ct_events' AND column_name = 'recurrence_days') THEN
        ALTER TABLE CT_events ADD COLUMN recurrence_days TEXT; -- JSON array like '["sunday", "wednesday"]' for weekly
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ct_events' AND column_name = 'recurrence_end_date') THEN
        ALTER TABLE CT_events ADD COLUMN recurrence_end_date TIMESTAMP; -- When to stop generating instances
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ct_events' AND column_name = 'parent_event_id') THEN
        ALTER TABLE CT_events ADD COLUMN parent_event_id INTEGER REFERENCES CT_events(id) ON DELETE CASCADE; -- Links generated instances to parent
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ct_events' AND column_name = 'instance_date') THEN
        ALTER TABLE CT_events ADD COLUMN instance_date DATE; -- For generated instances, the specific date
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ct_events' AND column_name = 'is_instance') THEN
        ALTER TABLE CT_events ADD COLUMN is_instance BOOLEAN DEFAULT FALSE; -- True for auto-generated instances
    END IF;
END $$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_ct_events_recurring ON CT_events(is_recurring) WHERE is_recurring = TRUE;
CREATE INDEX IF NOT EXISTS idx_ct_events_parent ON CT_events(parent_event_id) WHERE parent_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ct_events_instance_date ON CT_events(instance_date) WHERE instance_date IS NOT NULL;