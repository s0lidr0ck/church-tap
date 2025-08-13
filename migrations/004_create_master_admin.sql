-- Migration: Create master admin system for managing organizations
-- This creates a separate admin system for the SaaS platform management

CREATE TABLE master_admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  role TEXT DEFAULT 'master_admin', -- master_admin, super_admin, support
  permissions TEXT, -- JSON array of permissions
  avatar_url TEXT,
  last_login_at DATETIME,
  last_login_ip TEXT,
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create master admin sessions table
CREATE TABLE master_admin_sessions (
  id TEXT PRIMARY KEY,
  master_admin_id INTEGER NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (master_admin_id) REFERENCES master_admins(id) ON DELETE CASCADE
);

-- Create master admin activity log
CREATE TABLE master_admin_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  master_admin_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT, -- organization, user, billing, etc.
  resource_id INTEGER,
  organization_id INTEGER, -- which org was affected (if applicable)
  details TEXT, -- JSON details
  ip_address TEXT,
  user_agent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (master_admin_id) REFERENCES master_admins(id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

-- Insert default master admin
INSERT INTO master_admins (
  email, username, password_hash, first_name, last_name, role, permissions
) VALUES (
  'master@dailyverse.saas',
  'master',
  '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- password: 'master123'
  'Master',
  'Administrator', 
  'super_admin',
  '["manage_organizations", "manage_billing", "manage_users", "view_analytics", "manage_system"]'
);

-- Create indexes
CREATE INDEX idx_master_admins_email ON master_admins(email);
CREATE INDEX idx_master_admins_username ON master_admins(username);
CREATE INDEX idx_master_admin_sessions_admin_id ON master_admin_sessions(master_admin_id);
CREATE INDEX idx_master_admin_activity_admin_id ON master_admin_activity(master_admin_id);
CREATE INDEX idx_master_admin_activity_organization ON master_admin_activity(organization_id);