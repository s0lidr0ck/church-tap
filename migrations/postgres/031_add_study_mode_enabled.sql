-- Add Study Mode preference (user-level)
-- This is a user preference (cross-device) that is mirrored to localStorage in the client.

ALTER TABLE IF EXISTS ct_user_preferences
  ADD COLUMN IF NOT EXISTS study_mode_enabled BOOLEAN DEFAULT FALSE;

-- Backfill existing rows (safe if column already existed)
UPDATE ct_user_preferences
SET study_mode_enabled = FALSE
WHERE study_mode_enabled IS NULL;

