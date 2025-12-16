-- 020_create_worship_playlist.sql
-- Dedicated worship playlist config (separate from generic organization links like sermons)

CREATE TABLE IF NOT EXISTS ct_organization_worship_playlists (
  organization_id INTEGER PRIMARY KEY REFERENCES ct_organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Worship Playlist',
  youtube_url TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ct_org_worship_playlists_org_active
  ON ct_organization_worship_playlists(organization_id, is_active);


