-- 029_create_commentary_tables.sql
-- Store external Bible commentaries (e.g., MyBible .mybible SQLite libraries)
-- Idempotent.

CREATE TABLE IF NOT EXISTS ct_commentary_sources (
  id SERIAL PRIMARY KEY,
  source_key TEXT UNIQUE NOT NULL,          -- e.g. "clarke.cmt"
  title TEXT,
  abbreviation TEXT,
  description TEXT,
  author TEXT,
  version TEXT,
  language TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ct_commentary_sources_key
  ON ct_commentary_sources(source_key);

CREATE TABLE IF NOT EXISTS ct_commentary_entries (
  id BIGSERIAL PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES ct_commentary_sources(id) ON DELETE CASCADE,
  book INTEGER NOT NULL,
  chapter INTEGER NOT NULL,
  from_verse INTEGER NOT NULL,
  to_verse INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Avoid duplicates on repeated imports
CREATE UNIQUE INDEX IF NOT EXISTS uq_ct_commentary_entries_range
  ON ct_commentary_entries(source_id, book, chapter, from_verse, to_verse);

CREATE INDEX IF NOT EXISTS idx_ct_commentary_entries_lookup
  ON ct_commentary_entries(source_id, book, chapter, from_verse, to_verse);

-- Optional assets table for MyBible "data" blobs (not imported by default).
CREATE TABLE IF NOT EXISTS ct_commentary_assets (
  id BIGSERIAL PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES ct_commentary_sources(id) ON DELETE CASCADE,
  asset_key TEXT,            -- e.g. MyBible data.id
  filename TEXT,
  content BYTEA,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ct_commentary_assets_key
  ON ct_commentary_assets(source_id, asset_key);

