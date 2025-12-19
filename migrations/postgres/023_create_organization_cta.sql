-- 023_create_organization_cta.sql
-- Per-organization Call-To-Action (CTA) banners/cards, configurable from admin UI.
-- Note: This table is referenced by:
-- - routes/organizationAdmin.routes.js  (admin CRUD)
-- - routes/organization.routes.js       (public active CTA fetch)
--
-- Idempotent (safe to run repeatedly via scripts/init-postgres.js).

CREATE TABLE IF NOT EXISTS ct_organization_cta (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES ct_organizations(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  url TEXT,
  icon TEXT NOT NULL DEFAULT '📣',
  bg_color TEXT NOT NULL DEFAULT '#0ea5e9',
  text_color TEXT NOT NULL DEFAULT '#ffffff',
  start_at TIMESTAMP NULL,
  end_at TIMESTAMP NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ct_org_cta_org_active
  ON ct_organization_cta(organization_id, is_active);

CREATE INDEX IF NOT EXISTS idx_ct_org_cta_org_window
  ON ct_organization_cta(organization_id, start_at, end_at);

