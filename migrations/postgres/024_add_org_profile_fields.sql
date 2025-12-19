-- 024_add_org_profile_fields.sql
-- Add organization profile fields required by master/admin/tap flows.
-- Idempotent.

ALTER TABLE ct_organizations
  ADD COLUMN IF NOT EXISTS org_type TEXT,
  ADD COLUMN IF NOT EXISTS join_type TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS zip_code TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

-- Helpful indexes for lookup/filtering.
CREATE INDEX IF NOT EXISTS idx_ct_org_join_type
  ON ct_organizations(join_type);

CREATE INDEX IF NOT EXISTS idx_ct_org_geo
  ON ct_organizations(city, state, country);

