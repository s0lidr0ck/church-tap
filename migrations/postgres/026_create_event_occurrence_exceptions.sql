-- 026_create_event_occurrence_exceptions.sql
-- Allows cancelling (excluding) specific occurrences of a recurring event
-- so the generator will not recreate them.
-- Idempotent.

CREATE TABLE IF NOT EXISTS ct_event_occurrence_exceptions (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES ct_organizations(id) ON DELETE CASCADE,
  parent_event_id INTEGER NOT NULL REFERENCES ct_events(id) ON DELETE CASCADE,
  instance_date DATE NOT NULL,
  action TEXT NOT NULL DEFAULT 'cancelled', -- currently only 'cancelled'
  reason TEXT,
  created_by_admin_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (parent_event_id, instance_date)
);

CREATE INDEX IF NOT EXISTS idx_ct_event_exceptions_org_parent_date
  ON ct_event_occurrence_exceptions(organization_id, parent_event_id, instance_date);

