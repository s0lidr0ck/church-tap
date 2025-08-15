-- Migration: Create organizations table for multi-tenancy
-- This enables white-label instances for different churches/organizations

CREATE TABLE ct_organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  subdomain TEXT UNIQUE NOT NULL, -- e.g., 'firstbaptist'
  custom_domain TEXT,             -- e.g., 'verses.firstbaptist.org'
  logo_url TEXT,
  primary_color TEXT DEFAULT '#3b82f6',
  secondary_color TEXT DEFAULT '#6366f1',
  settings TEXT DEFAULT '{}',     -- JSON settings for customization
  plan_type TEXT DEFAULT 'basic', -- basic, premium, enterprise
  max_admins INTEGER DEFAULT 3,
  max_verses INTEGER DEFAULT 365,
  features TEXT DEFAULT '[]',     -- JSON array of enabled features
  contact_email TEXT,
  contact_phone TEXT,
  address TEXT,
  timezone TEXT DEFAULT 'America/Chicago',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT 1,
  trial_ends_at DATETIME,
  last_billed_at DATETIME
);

-- Create indexes for performance
CREATE INDEX idx_organizations_subdomain ON ct_organizations(subdomain);
CREATE INDEX idx_organizations_custom_domain ON ct_organizations(custom_domain);
CREATE INDEX idx_organizations_is_active ON ct_organizations(is_active);

-- Insert default organization (existing data)
INSERT INTO ct_organizations (
  id, name, subdomain, settings, plan_type, features
) VALUES (
  1, 
  'Default Organization', 
  'default',
  '{"theme": "default", "features": {"community": true, "analytics": true}}',
  'enterprise',
  '["verses", "community", "analytics", "users", "api"]'
);