-- 028_add_external_event_sync_fields.sql
-- Add fields to ct_events to support external calendar sync (Google ICS).
-- Idempotent.

ALTER TABLE ct_events
  ADD COLUMN IF NOT EXISTS external_source TEXT,
  ADD COLUMN IF NOT EXISTS external_uid TEXT,
  ADD COLUMN IF NOT EXISTS external_parent_uid TEXT,
  ADD COLUMN IF NOT EXISTS external_integration_id INTEGER REFERENCES ct_organization_calendar_integrations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_last_seen_at TIMESTAMP;

-- Uniqueness for upserts (only when external_uid exists).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ct_events_external_uid
  ON ct_events(organization_id, external_source, external_uid)
  WHERE external_uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ct_events_external_integration
  ON ct_events(external_integration_id, external_last_seen_at);

