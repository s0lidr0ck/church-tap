-- Migration: Enhance admin_users table for multi-admin support
-- This adds role management, invitations, and better user management

-- Add new columns to admin_users
ALTER TABLE ct_admin_users ADD COLUMN email TEXT;
ALTER TABLE ct_admin_users ADD COLUMN first_name TEXT;
ALTER TABLE ct_admin_users ADD COLUMN last_name TEXT;
ALTER TABLE ct_admin_users ADD COLUMN phone TEXT;
ALTER TABLE ct_admin_users ADD COLUMN avatar_url TEXT;
ALTER TABLE ct_admin_users ADD COLUMN permissions TEXT; -- JSON array of permissions
ALTER TABLE ct_admin_users ADD COLUMN last_login_at DATETIME;
ALTER TABLE ct_admin_users ADD COLUMN last_login_ip TEXT;
ALTER TABLE ct_admin_users ADD COLUMN is_active BOOLEAN DEFAULT 1;
ALTER TABLE ct_admin_users ADD COLUMN email_verified BOOLEAN DEFAULT 1;
ALTER TABLE ct_admin_users ADD COLUMN invitation_token TEXT;
ALTER TABLE ct_admin_users ADD COLUMN invitation_expires_at DATETIME;
ALTER TABLE ct_admin_users ADD COLUMN invited_by INTEGER;
ALTER TABLE ct_admin_users ADD COLUMN updated_at DATETIME;

-- Update the existing admin user with default email
UPDATE ct_admin_users SET 
  email = 'admin@dailyverse.local',
  first_name = 'System',
  last_name = 'Administrator',
  permissions = '["super_admin", "manage_verses", "manage_users", "manage_analytics", "manage_community", "manage_settings"]',
  updated_at = CURRENT_TIMESTAMP
WHERE username = 'admin';

-- Set default permissions for any admin users without permissions
UPDATE ct_admin_users SET 
  permissions = '["admin", "manage_verses", "manage_analytics", "manage_community"]'
WHERE permissions IS NULL;

-- Create admin invitations table for invitation management
CREATE TABLE admin_invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  permissions TEXT,
  invited_by INTEGER NOT NULL,
  invitation_token TEXT UNIQUE NOT NULL,
  expires_at DATETIME NOT NULL,
  accepted_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES ct_organizations(id),
  FOREIGN KEY (invited_by) REFERENCES ct_admin_users(id)
);

-- Create admin activity log for audit trail
CREATE TABLE admin_activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  admin_user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id INTEGER,
  details TEXT, -- JSON details
  ip_address TEXT,
  user_agent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES ct_organizations(id),
  FOREIGN KEY (admin_user_id) REFERENCES ct_admin_users(id)
);

-- Create indexes
CREATE INDEX idx_admin_users_email ON ct_admin_users(email);
CREATE INDEX idx_admin_users_organization_role ON ct_admin_users(organization_id, role);
CREATE INDEX idx_admin_invitations_token ON admin_invitations(invitation_token);
CREATE INDEX idx_admin_invitations_email ON admin_invitations(email);
CREATE INDEX idx_admin_activity_log_admin_user ON admin_activity_log(admin_user_id);
CREATE INDEX idx_admin_activity_log_organization ON admin_activity_log(organization_id);
CREATE INDEX idx_admin_activity_log_created_at ON admin_activity_log(created_at);