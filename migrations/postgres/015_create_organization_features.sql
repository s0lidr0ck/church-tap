-- 015_create_organization_features.sql
-- Per-organization feature flags for group customization (Postgres, idempotent)

CREATE TABLE IF NOT EXISTS ct_organization_features (
  organization_id INTEGER PRIMARY KEY REFERENCES ct_organizations(id) ON DELETE CASCADE,

  -- Feature toggles
  prayer_requests_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  praise_reports_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  insights_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  verse_commentary_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  anonymous_posts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  group_calendar_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  group_links_enabled BOOLEAN NOT NULL DEFAULT TRUE,

  -- If NULL => all translations are enabled. If [] => none enabled.
  enabled_translations TEXT[] NULL,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Ensure every existing org has a row (defaults are all-on)
INSERT INTO ct_organization_features (organization_id)
SELECT o.id
FROM ct_organizations o
LEFT JOIN ct_organization_features f ON f.organization_id = o.id
WHERE f.organization_id IS NULL;

-- Best-effort update trigger (optional): keep updated_at fresh via app-side updates.


