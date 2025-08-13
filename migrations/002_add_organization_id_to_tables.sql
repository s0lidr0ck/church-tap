-- Migration: Add organization_id to existing tables for multi-tenancy
-- This enables data isolation between different organizations

-- Add organization_id to verses table
ALTER TABLE verses ADD COLUMN organization_id INTEGER DEFAULT 1;
UPDATE verses SET organization_id = 1 WHERE organization_id IS NULL;

-- Add organization_id to admin_users table
ALTER TABLE admin_users ADD COLUMN organization_id INTEGER DEFAULT 1;
UPDATE admin_users SET organization_id = 1 WHERE organization_id IS NULL;

-- Add organization_id to prayer_requests table
ALTER TABLE prayer_requests ADD COLUMN organization_id INTEGER DEFAULT 1;
UPDATE prayer_requests SET organization_id = 1 WHERE organization_id IS NULL;

-- Add organization_id to praise_reports table  
ALTER TABLE praise_reports ADD COLUMN organization_id INTEGER DEFAULT 1;
UPDATE praise_reports SET organization_id = 1 WHERE organization_id IS NULL;

-- Add organization_id to users table
ALTER TABLE users ADD COLUMN organization_id INTEGER DEFAULT 1;
UPDATE users SET organization_id = 1 WHERE organization_id IS NULL;

-- Add organization_id to analytics table
ALTER TABLE analytics ADD COLUMN organization_id INTEGER DEFAULT 1;
UPDATE analytics SET organization_id = 1 WHERE organization_id IS NULL;

-- Add organization_id to favorites table
ALTER TABLE favorites ADD COLUMN organization_id INTEGER DEFAULT 1;
UPDATE favorites SET organization_id = 1 WHERE organization_id IS NULL;

-- Add organization_id to user_collections table
ALTER TABLE user_collections ADD COLUMN organization_id INTEGER DEFAULT 1;
UPDATE user_collections SET organization_id = 1 WHERE organization_id IS NULL;

-- Add organization_id to personal_prayer_requests table
ALTER TABLE personal_prayer_requests ADD COLUMN organization_id INTEGER DEFAULT 1;
UPDATE personal_prayer_requests SET organization_id = 1 WHERE organization_id IS NULL;

-- Create indexes for performance
CREATE INDEX idx_verses_organization_id ON verses(organization_id);
CREATE INDEX idx_admin_users_organization_id ON admin_users(organization_id);
CREATE INDEX idx_prayer_requests_organization_id ON prayer_requests(organization_id);
CREATE INDEX idx_praise_reports_organization_id ON praise_reports(organization_id);
CREATE INDEX idx_users_organization_id ON users(organization_id);
CREATE INDEX idx_analytics_organization_id ON analytics(organization_id);
CREATE INDEX idx_favorites_organization_id ON favorites(organization_id);
CREATE INDEX idx_user_collections_organization_id ON user_collections(organization_id);
CREATE INDEX idx_personal_prayer_requests_organization_id ON personal_prayer_requests(organization_id);