-- Add verse community wall functionality
-- This allows users to share thoughts, insights, and reflections about specific verses

-- Community posts for verse discussions
CREATE TABLE IF NOT EXISTS CT_verse_community_posts (
  id SERIAL PRIMARY KEY,
  verse_id INTEGER REFERENCES CT_verses(id) ON DELETE CASCADE,
  verse_reference TEXT NOT NULL, -- e.g., "John 3:16" for posts without verse_id
  date DATE NOT NULL,
  content TEXT NOT NULL,
  author_name TEXT, -- Optional display name
  user_token TEXT, -- Anonymous user tracking
  ip_address TEXT,
  is_approved BOOLEAN DEFAULT FALSE,
  is_hidden BOOLEAN DEFAULT FALSE,
  heart_count INTEGER DEFAULT 0,
  organization_id INTEGER NOT NULL REFERENCES CT_organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for better performance
CREATE INDEX IF NOT EXISTS idx_verse_community_posts_verse_ref ON CT_verse_community_posts(verse_reference);
CREATE INDEX IF NOT EXISTS idx_verse_community_posts_date ON CT_verse_community_posts(date);
CREATE INDEX IF NOT EXISTS idx_verse_community_posts_org ON CT_verse_community_posts(organization_id);
CREATE INDEX IF NOT EXISTS idx_verse_community_posts_approved ON CT_verse_community_posts(is_approved, is_hidden);

-- Interactions with community posts (hearts/likes)
CREATE TABLE IF NOT EXISTS CT_verse_community_interactions (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES CT_verse_community_posts(id) ON DELETE CASCADE,
  user_token TEXT,
  ip_address TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Prevent duplicate likes from same user
CREATE UNIQUE INDEX IF NOT EXISTS idx_verse_community_unique_interaction 
ON CT_verse_community_interactions(post_id, user_token) 
WHERE user_token IS NOT NULL;

-- Strong's numbers reference data (for the second feature)
CREATE TABLE IF NOT EXISTS CT_strongs_references (
  id SERIAL PRIMARY KEY,
  strongs_number TEXT UNIQUE NOT NULL, -- e.g., "H7225", "G2316"
  language TEXT NOT NULL, -- "hebrew" or "greek"
  transliteration TEXT,
  phonetics TEXT,
  definition TEXT,
  short_definition TEXT,
  outline_of_biblical_usage TEXT,
  kjv_translation_count JSONB, -- JSON object with word -> count mapping
  total_kjv_occurrences INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strongs_number ON CT_strongs_references(strongs_number);
CREATE INDEX IF NOT EXISTS idx_strongs_language ON CT_strongs_references(language);