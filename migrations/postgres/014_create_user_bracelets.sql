-- Migration: Create ct_user_bracelets mapping table (user can have multiple bracelets)

CREATE TABLE IF NOT EXISTS ct_user_bracelets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES ct_users(id) ON DELETE CASCADE,
  bracelet_uid VARCHAR(100) NOT NULL,
  is_primary BOOLEAN DEFAULT FALSE,
  nickname TEXT,
  registered_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uq_ct_user_bracelets_bracelet_uid UNIQUE (bracelet_uid)
);

CREATE INDEX IF NOT EXISTS idx_ct_user_bracelets_user_id
  ON ct_user_bracelets(user_id);

CREATE INDEX IF NOT EXISTS idx_ct_user_bracelets_is_primary
  ON ct_user_bracelets(user_id, is_primary);


