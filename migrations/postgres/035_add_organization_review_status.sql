-- 035_add_organization_review_status.sql
-- Add organization review/verification fields for self-serve org creation.
-- Idempotent.

ALTER TABLE ct_organizations
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS created_by_bracelet_uid TEXT,
  ADD COLUMN IF NOT EXISTS created_via TEXT;

CREATE INDEX IF NOT EXISTS idx_ct_org_review_status
  ON ct_organizations(review_status);


