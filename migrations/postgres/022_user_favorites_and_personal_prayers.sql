-- Migration: User favorites + personal prayers (server-synced)
-- Creates tables needed for /favorites and /my-prayers pages.

-- Favorites (verse_id points to ct_verses.id)
CREATE TABLE IF NOT EXISTS ct_user_favorites (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES ct_users(id) ON DELETE CASCADE,
  verse_id INTEGER NOT NULL REFERENCES ct_verses(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES ct_organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, verse_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_ct_user_favorites_user_org ON ct_user_favorites(user_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_ct_user_favorites_org_created ON ct_user_favorites(organization_id, created_at);

-- Personal prayer journal (separate from community prayer requests)
CREATE TABLE IF NOT EXISTS ct_personal_prayer_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES ct_users(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES ct_organizations(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  is_answered BOOLEAN DEFAULT FALSE,
  answered_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ct_personal_prayers_user_org ON ct_personal_prayer_requests(user_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_ct_personal_prayers_org_created ON ct_personal_prayer_requests(organization_id, created_at);
