-- 018_topic_verse_ranges.sql
-- Add verse range support to topic verses (single chapter ranges: verse_start..verse_end)

ALTER TABLE ct_scripture_topic_verses
  ADD COLUMN IF NOT EXISTS verse_start INTEGER,
  ADD COLUMN IF NOT EXISTS verse_end INTEGER;

-- Backfill from old single-verse column if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ct_scripture_topic_verses' AND column_name = 'verse'
  ) THEN
    EXECUTE 'UPDATE ct_scripture_topic_verses SET verse_start = COALESCE(verse_start, verse), verse_end = COALESCE(verse_end, verse) WHERE verse_start IS NULL OR verse_end IS NULL';
  END IF;
END $$;

ALTER TABLE ct_scripture_topic_verses
  ALTER COLUMN verse_start SET NOT NULL,
  ALTER COLUMN verse_end SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_ct_scripture_topic_verses_range'
  ) THEN
    EXECUTE 'ALTER TABLE ct_scripture_topic_verses
             ADD CONSTRAINT chk_ct_scripture_topic_verses_range
             CHECK (verse_start >= 1 AND verse_end >= verse_start)';
  END IF;
END $$;

-- Replace the old unique constraint (topic_id, book_number, chapter, verse, translation_code) if it exists
ALTER TABLE ct_scripture_topic_verses
  DROP CONSTRAINT IF EXISTS ct_scripture_topic_verses_topic_id_book_number_chapter_verse_translation_code_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ct_scripture_topic_verses_unique_range'
  ) THEN
    EXECUTE 'ALTER TABLE ct_scripture_topic_verses
             ADD CONSTRAINT ct_scripture_topic_verses_unique_range
             UNIQUE (topic_id, book_number, chapter, verse_start, verse_end, translation_code)';
  END IF;
END $$;

-- Drop old verse column if it exists
ALTER TABLE ct_scripture_topic_verses
  DROP COLUMN IF EXISTS verse;


