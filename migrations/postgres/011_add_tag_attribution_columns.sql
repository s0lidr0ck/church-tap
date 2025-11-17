-- Migration: Add tag attribution columns for better analytics tracking
-- This adds originating_tag_id and tagged_session_id to track the source of user activities

-- Add columns to anonymous_sessions table
ALTER TABLE anonymous_sessions 
ADD COLUMN IF NOT EXISTS originating_tag_id VARCHAR(100),
ADD COLUMN IF NOT EXISTS tagged_session_id VARCHAR(100);

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_anonymous_sessions_originating_tag_id 
ON anonymous_sessions(originating_tag_id);

CREATE INDEX IF NOT EXISTS idx_anonymous_sessions_tagged_session_id 
ON anonymous_sessions(tagged_session_id);

-- Add column to tag_interactions table if it doesn't exist
ALTER TABLE tag_interactions 
ADD COLUMN IF NOT EXISTS tagged_session_id VARCHAR(100);

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_tag_interactions_tagged_session_id 
ON tag_interactions(tagged_session_id);

-- Update existing records to set originating_tag_id from tag_interactions
UPDATE anonymous_sessions AS s
SET originating_tag_id = (
  SELECT t.tag_id 
  FROM tag_interactions t 
  WHERE t.session_id = s.session_id 
  ORDER BY t.created_at ASC 
  LIMIT 1
)
WHERE s.originating_tag_id IS NULL
AND EXISTS (SELECT 1 FROM tag_interactions t WHERE t.session_id = s.session_id);

COMMENT ON COLUMN anonymous_sessions.originating_tag_id IS 'The NFC tag (UID or custom_id) that initiated this session';
COMMENT ON COLUMN anonymous_sessions.tagged_session_id IS 'Unique identifier for this tagged session';
COMMENT ON COLUMN tag_interactions.tagged_session_id IS 'Links this interaction to a tagged session for attribution';

