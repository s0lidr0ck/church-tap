-- 032_user_verse_highlights_and_notes.sql
-- Private, per-user Bible study artifacts scoped to an organization + verse.
-- - Whole-verse highlights (with one of 8 preset color keys)
-- - Multiple notes per verse (markdown)
-- Idempotent.

-- Whole-verse highlights
CREATE TABLE IF NOT EXISTS ct_user_verse_highlights (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES ct_users(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES ct_organizations(id) ON DELETE CASCADE,
  verse_id INTEGER NOT NULL REFERENCES ct_verses(id) ON DELETE CASCADE,
  color_key TEXT NOT NULL, -- e.g. yellow|amber|orange|red|pink|purple|blue|green
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, organization_id, verse_id)
);

CREATE INDEX IF NOT EXISTS idx_ct_user_verse_highlights_user_org
  ON ct_user_verse_highlights(user_id, organization_id);

CREATE INDEX IF NOT EXISTS idx_ct_user_verse_highlights_verse
  ON ct_user_verse_highlights(organization_id, verse_id);

-- Verse notes (markdown)
CREATE TABLE IF NOT EXISTS ct_user_verse_notes (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES ct_users(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES ct_organizations(id) ON DELETE CASCADE,
  verse_id INTEGER NOT NULL REFERENCES ct_verses(id) ON DELETE CASCADE,
  title TEXT,
  body_markdown TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ct_user_verse_notes_user_org_created
  ON ct_user_verse_notes(user_id, organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ct_user_verse_notes_user_org_verse
  ON ct_user_verse_notes(user_id, organization_id, verse_id);

