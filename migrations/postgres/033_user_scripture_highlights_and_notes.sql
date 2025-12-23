-- 033_user_scripture_highlights_and_notes.sql
-- Private, per-user study artifacts for arbitrary scripture verses (book/chapter/verse),
-- used by the "Read Full Chapter" UI.
-- Idempotent.

-- Whole-verse highlights (scripture-targeted)
CREATE TABLE IF NOT EXISTS ct_user_scripture_highlights (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES ct_users(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES ct_organizations(id) ON DELETE CASCADE,
  book INTEGER NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  color_key TEXT NOT NULL, -- yellow|amber|orange|red|pink|purple|blue|green
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, organization_id, book, chapter, verse)
);

CREATE INDEX IF NOT EXISTS idx_ct_user_scripture_highlights_user_org
  ON ct_user_scripture_highlights(user_id, organization_id);

CREATE INDEX IF NOT EXISTS idx_ct_user_scripture_highlights_ref
  ON ct_user_scripture_highlights(organization_id, book, chapter, verse);

-- Notes (scripture-targeted)
CREATE TABLE IF NOT EXISTS ct_user_scripture_notes (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES ct_users(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES ct_organizations(id) ON DELETE CASCADE,
  book INTEGER NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  title TEXT,
  body_markdown TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ct_user_scripture_notes_user_org_created
  ON ct_user_scripture_notes(user_id, organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ct_user_scripture_notes_ref
  ON ct_user_scripture_notes(user_id, organization_id, book, chapter, verse);

