-- 030_create_dictionary_tables.sql
-- Store MyBible dictionaries (*.dct.mybible SQLite libraries)
-- Idempotent.

CREATE TABLE IF NOT EXISTS ct_dictionary_sources (
  id SERIAL PRIMARY KEY,
  source_key TEXT UNIQUE NOT NULL,          -- e.g. "eastons.dct" or "strong.dct"
  title TEXT,
  abbreviation TEXT,
  description TEXT,
  author TEXT,
  version TEXT,
  language TEXT,
  is_strongs BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ct_dictionary_sources_key
  ON ct_dictionary_sources(source_key);

CREATE TABLE IF NOT EXISTS ct_dictionary_entries (
  id BIGSERIAL PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES ct_dictionary_sources(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  relative_order INTEGER,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Avoid duplicates on repeated imports (word + order within a dictionary)
CREATE UNIQUE INDEX IF NOT EXISTS uq_ct_dictionary_entries_word_order
  ON ct_dictionary_entries(source_id, word, COALESCE(relative_order, 0));

CREATE INDEX IF NOT EXISTS idx_ct_dictionary_entries_lookup
  ON ct_dictionary_entries(source_id, word);

