-- Store per-user defaults for study tools (cross-device).
-- Translation default is already stored as ct_user_preferences.preferred_translation.

ALTER TABLE IF EXISTS ct_user_preferences
  ADD COLUMN IF NOT EXISTS default_commentary_source_key TEXT,
  ADD COLUMN IF NOT EXISTS default_dictionary_source_key TEXT;

