-- Postgres initialization for Church Tap (CT_*) schema
-- This creates required tables and seeds a default organization and admin

-- Organizations
CREATE TABLE IF NOT EXISTS CT_organizations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  subdomain TEXT UNIQUE NOT NULL,
  custom_domain TEXT,
  logo_url TEXT,
  primary_color TEXT DEFAULT '#3b82f6',
  secondary_color TEXT DEFAULT '#6366f1',
  settings JSONB DEFAULT '{}'::jsonb,
  plan_type TEXT DEFAULT 'basic',
  max_admins INTEGER DEFAULT 3,
  max_verses INTEGER DEFAULT 365,
  features JSONB DEFAULT '[]'::jsonb,
  contact_email TEXT,
  contact_phone TEXT,
  address TEXT,
  timezone TEXT DEFAULT 'America/Chicago',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  trial_ends_at TIMESTAMP,
  last_billed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ct_org_subdomain ON CT_organizations(subdomain);
CREATE INDEX IF NOT EXISTS idx_ct_org_custom_domain ON CT_organizations(custom_domain);
CREATE INDEX IF NOT EXISTS idx_ct_org_is_active ON CT_organizations(is_active);

-- Admin users
CREATE TABLE IF NOT EXISTS CT_admin_users (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES CT_organizations(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  avatar_url TEXT,
  permissions JSONB,
  role TEXT DEFAULT 'admin',
  last_login_at TIMESTAMP,
  last_login_ip TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  email_verified BOOLEAN DEFAULT TRUE,
  invitation_token TEXT,
  invitation_expires_at TIMESTAMP,
  invited_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ct_admin_users_email ON CT_admin_users(email);
CREATE INDEX IF NOT EXISTS idx_ct_admin_users_org_role ON CT_admin_users(organization_id, role);

-- Admin invitations
CREATE TABLE IF NOT EXISTS CT_admin_invitations (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES CT_organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  permissions JSONB,
  invited_by INTEGER NOT NULL REFERENCES CT_admin_users(id) ON DELETE CASCADE,
  invitation_token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  accepted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ct_admin_inv_token ON CT_admin_invitations(invitation_token);
CREATE INDEX IF NOT EXISTS idx_ct_admin_inv_email ON CT_admin_invitations(email);

-- Admin activity log
CREATE TABLE IF NOT EXISTS CT_admin_activity_log (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES CT_organizations(id) ON DELETE CASCADE,
  admin_user_id INTEGER NOT NULL REFERENCES CT_admin_users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id INTEGER,
  details JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ct_admin_activity_user ON CT_admin_activity_log(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_ct_admin_activity_org ON CT_admin_activity_log(organization_id);
CREATE INDEX IF NOT EXISTS idx_ct_admin_activity_created ON CT_admin_activity_log(created_at);

-- Verses
CREATE TABLE IF NOT EXISTS CT_verses (
  id SERIAL PRIMARY KEY,
  date DATE,
  content_type TEXT,
  verse_text TEXT,
  image_path TEXT,
  bible_reference TEXT,
  context TEXT,
  tags TEXT,
  published BOOLEAN DEFAULT FALSE,
  hearts INTEGER DEFAULT 0,
  organization_id INTEGER NOT NULL REFERENCES CT_organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ct_verses_org ON CT_verses(organization_id);
CREATE INDEX IF NOT EXISTS idx_ct_verses_date ON CT_verses(date);

-- Analytics
CREATE TABLE IF NOT EXISTS CT_analytics (
  id SERIAL PRIMARY KEY,
  verse_id INTEGER,
  action TEXT,
  ip_address TEXT,
  user_agent TEXT,
  timestamp TIMESTAMP DEFAULT NOW(),
  organization_id INTEGER NOT NULL REFERENCES CT_organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ct_analytics_org ON CT_analytics(organization_id);
CREATE INDEX IF NOT EXISTS idx_ct_analytics_timestamp ON CT_analytics(timestamp);

-- Users
CREATE TABLE IF NOT EXISTS CT_users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  display_name TEXT,
  is_verified BOOLEAN DEFAULT FALSE,
  organization_id INTEGER NOT NULL REFERENCES CT_organizations(id) ON DELETE CASCADE,
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- User preferences
CREATE TABLE IF NOT EXISTS CT_user_preferences (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES CT_users(id) ON DELETE CASCADE,
  life_stage TEXT,
  interests JSONB,
  struggles JSONB,
  prayer_frequency TEXT,
  preferred_translation TEXT,
  notification_enabled BOOLEAN,
  notification_time TEXT,
  timezone TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Community: prayer requests and praise reports
CREATE TABLE IF NOT EXISTS CT_prayer_requests (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  content TEXT NOT NULL,
  user_token TEXT,
  ip_address TEXT,
  is_approved BOOLEAN DEFAULT FALSE,
  is_hidden BOOLEAN DEFAULT FALSE,
  prayer_count INTEGER DEFAULT 0,
  organization_id INTEGER NOT NULL REFERENCES CT_organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS CT_praise_reports (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  content TEXT NOT NULL,
  user_token TEXT,
  ip_address TEXT,
  is_approved BOOLEAN DEFAULT FALSE,
  is_hidden BOOLEAN DEFAULT FALSE,
  celebration_count INTEGER DEFAULT 0,
  organization_id INTEGER NOT NULL REFERENCES CT_organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS CT_prayer_interactions (
  id SERIAL PRIMARY KEY,
  prayer_request_id INTEGER NOT NULL REFERENCES CT_prayer_requests(id) ON DELETE CASCADE,
  user_token TEXT,
  ip_address TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS CT_celebration_interactions (
  id SERIAL PRIMARY KEY,
  praise_report_id INTEGER NOT NULL REFERENCES CT_praise_reports(id) ON DELETE CASCADE,
  user_token TEXT,
  ip_address TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Collections (optional features referenced by adapter)
CREATE TABLE IF NOT EXISTS CT_user_collections (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES CT_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  organization_id INTEGER NOT NULL REFERENCES CT_organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS CT_collection_verses (
  id SERIAL PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES CT_user_collections(id) ON DELETE CASCADE,
  verse_id INTEGER NOT NULL REFERENCES CT_verses(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS CT_user_verse_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES CT_users(id) ON DELETE CASCADE,
  verse_id INTEGER NOT NULL REFERENCES CT_verses(id) ON DELETE CASCADE,
  viewed_at TIMESTAMP DEFAULT NOW()
);

-- Master admin tables
CREATE TABLE IF NOT EXISTS CT_master_admins (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  role TEXT DEFAULT 'master_admin',
  permissions JSONB,
  avatar_url TEXT,
  last_login_at TIMESTAMP,
  last_login_ip TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS CT_master_admin_sessions (
  id TEXT PRIMARY KEY,
  master_admin_id INTEGER NOT NULL REFERENCES CT_master_admins(id) ON DELETE CASCADE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS CT_master_admin_activity (
  id SERIAL PRIMARY KEY,
  master_admin_id INTEGER NOT NULL REFERENCES CT_master_admins(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id INTEGER,
  organization_id INTEGER REFERENCES CT_organizations(id) ON DELETE SET NULL,
  details JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Seed default organization (id = 1) if none exists
INSERT INTO CT_organizations (id, name, subdomain, settings, plan_type, features, is_active)
SELECT 1, 'Default Organization', 'default', '{}'::jsonb, 'enterprise', '["verses","community","analytics","users","api"]'::jsonb, TRUE
WHERE NOT EXISTS (SELECT 1 FROM CT_organizations WHERE id = 1);

-- Seed default admin user if none exists
INSERT INTO CT_admin_users (organization_id, username, password_hash, email, role, is_active, permissions)
SELECT 1, 'admin', '$2a$12$/EUpuYIygezZcOJ0bnoYlu2p2jqcH8TJ2ksubT2Z2mXayFSyOx90a', 'admin@local', 'super_admin', TRUE,
       ('["super_admin","manage_verses","manage_users","manage_analytics","manage_community","manage_settings"]')::jsonb
WHERE NOT EXISTS (SELECT 1 FROM CT_admin_users WHERE username = 'admin');


