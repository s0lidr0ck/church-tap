-- 017_create_fundraising_goals.sql
-- Simple per-organization fundraising goal config

CREATE TABLE IF NOT EXISTS ct_fundraising_goals (
  organization_id INTEGER PRIMARY KEY REFERENCES ct_organizations(id) ON DELETE CASCADE,
  goal_title TEXT NOT NULL,
  goal_amount_cents INTEGER NOT NULL CHECK (goal_amount_cents > 0),
  current_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (current_amount_cents >= 0),
  deadline_date DATE NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ct_fundraising_goals_org_active
  ON ct_fundraising_goals(organization_id, is_active);


