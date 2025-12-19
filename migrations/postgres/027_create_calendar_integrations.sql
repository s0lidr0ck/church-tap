-- 027_create_calendar_integrations.sql
-- Store external calendar sync configuration per organization (Google Calendar via ICS feed).
-- Idempotent.

CREATE TABLE IF NOT EXISTS ct_organization_calendar_integrations (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES ct_organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'google_ics',
  -- We store the final .ics URL we fetch (public/basic.ics or private-*/basic.ics).
  ics_url TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sync_window_days_ahead INTEGER NOT NULL DEFAULT 180,
  sync_window_days_back INTEGER NOT NULL DEFAULT 14,
  last_synced_at TIMESTAMP NULL,
  last_sync_status TEXT NULL, -- 'ok' | 'error'
  last_sync_error TEXT NULL,
  last_etag TEXT NULL,
  last_modified TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_ct_org_calendar_integrations_enabled
  ON ct_organization_calendar_integrations(is_enabled, provider);

