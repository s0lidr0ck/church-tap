-- 016_create_scripture_topics.sql
-- Configurable "Topics" for Emergency Scripture (per organization)

CREATE TABLE IF NOT EXISTS ct_scripture_topics (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES ct_organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_ct_scripture_topics_org
  ON ct_scripture_topics(organization_id, is_active, sort_order);

CREATE TABLE IF NOT EXISTS ct_scripture_topic_verses (
  id SERIAL PRIMARY KEY,
  topic_id INTEGER NOT NULL REFERENCES ct_scripture_topics(id) ON DELETE CASCADE,
  bible_reference TEXT NOT NULL,
  book_number INTEGER NOT NULL CHECK (book_number >= 1 AND book_number <= 66),
  chapter INTEGER NOT NULL CHECK (chapter >= 1),
  verse INTEGER NOT NULL CHECK (verse >= 1),
  translation_code TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (topic_id, book_number, chapter, verse, translation_code)
);

CREATE INDEX IF NOT EXISTS idx_ct_scripture_topic_verses_topic
  ON ct_scripture_topic_verses(topic_id);


