-- 019_default_topic_templates.sql
-- Master-managed default topic templates, enabled/disabled per organization.

CREATE TABLE IF NOT EXISTS ct_topic_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ct_topic_templates_active
  ON ct_topic_templates(is_active, sort_order);

CREATE TABLE IF NOT EXISTS ct_topic_template_verses (
  id SERIAL PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES ct_topic_templates(id) ON DELETE CASCADE,
  bible_reference TEXT NOT NULL,
  book_number INTEGER NOT NULL CHECK (book_number >= 1 AND book_number <= 66),
  chapter INTEGER NOT NULL CHECK (chapter >= 1),
  verse_start INTEGER NOT NULL CHECK (verse_start >= 1),
  verse_end INTEGER NOT NULL CHECK (verse_end >= verse_start),
  translation_code TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (template_id, book_number, chapter, verse_start, verse_end, translation_code)
);

CREATE INDEX IF NOT EXISTS idx_ct_topic_template_verses_template
  ON ct_topic_template_verses(template_id);

CREATE TABLE IF NOT EXISTS ct_organization_topic_template_settings (
  organization_id INTEGER NOT NULL REFERENCES ct_organizations(id) ON DELETE CASCADE,
  template_id INTEGER NOT NULL REFERENCES ct_topic_templates(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_ct_org_topic_template_settings_org
  ON ct_organization_topic_template_settings(organization_id, is_enabled);


