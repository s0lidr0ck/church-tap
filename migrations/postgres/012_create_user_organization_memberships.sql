-- Migration: Create user <-> organization memberships (multi-group support)
-- This enables users to join multiple groups with statuses (active/pending/left/denied)

CREATE TABLE IF NOT EXISTS ct_user_organization_memberships (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES ct_users(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES ct_organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  joined_at TIMESTAMP DEFAULT NOW(),
  left_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, organization_id),
  CONSTRAINT chk_ct_user_org_memberships_status
    CHECK (status IN ('active', 'pending', 'denied', 'left'))
);

CREATE INDEX IF NOT EXISTS idx_ct_user_org_memberships_user
  ON ct_user_organization_memberships(user_id);

CREATE INDEX IF NOT EXISTS idx_ct_user_org_memberships_org
  ON ct_user_organization_memberships(organization_id);

CREATE INDEX IF NOT EXISTS idx_ct_user_org_memberships_status
  ON ct_user_organization_memberships(status);


