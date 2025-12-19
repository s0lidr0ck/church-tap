-- 025_create_events.sql
-- Core events table used by the group calendar (admin + public).
-- Idempotent.

CREATE TABLE IF NOT EXISTS ct_events (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES ct_organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  address TEXT,
  start_at TIMESTAMP NOT NULL,
  end_at TIMESTAMP NULL,
  all_day BOOLEAN NOT NULL DEFAULT FALSE,
  link TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notify_lead_minutes INTEGER NOT NULL DEFAULT 120,

  -- Recurring series fields (series definition rows)
  is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
  recurrence_type TEXT,
  recurrence_interval INTEGER NOT NULL DEFAULT 1,
  recurrence_days TEXT, -- JSON string like "[0,3,6]" (Sun/Wed/Sat)
  recurrence_end_date TIMESTAMP NULL,

  -- Generated instance fields
  parent_event_id INTEGER REFERENCES ct_events(id) ON DELETE CASCADE,
  instance_date DATE,
  is_instance BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ct_events_org_start
  ON ct_events(organization_id, start_at);

CREATE INDEX IF NOT EXISTS idx_ct_events_org_active_start
  ON ct_events(organization_id, is_active, start_at);

CREATE INDEX IF NOT EXISTS idx_ct_events_parent_instance_date
  ON ct_events(parent_event_id, instance_date);

