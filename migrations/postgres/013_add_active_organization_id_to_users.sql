-- Migration: Add active_organization_id to ct_users to remember last selected group

ALTER TABLE ct_users
ADD COLUMN IF NOT EXISTS active_organization_id INTEGER REFERENCES ct_organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ct_users_active_organization_id
  ON ct_users(active_organization_id);


