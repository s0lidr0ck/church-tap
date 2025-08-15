-- Migration: Add organization_id to existing tables for multi-tenancy
-- This enables data isolation between different organizations

-- Add organization_id to verses table
ALTER TABLE ct_verses ADD COLUMN organization_id INTEGER DEFAULT 1;
UPDATE ct_verses SET organization_id = 1 WHERE organization_id IS NULL;

-- Add organization_id to admin_users table
ALTER TABLE ct_admin_users ADD COLUMN organization_id INTEGER DEFAULT 1;
UPDATE ct_admin_users SET organization_id = 1 WHERE organization_id IS NULL;

-- Add organization_id to prayer_requests table
ALTER TABLE ct_prayer_requests ADD COLUMN organization_id INTEGER DEFAULT 1;
UPDATE ct_prayer_requests SET organization_id = 1 WHERE organization_id IS NULL;

-- Add organization_id to praise_reports table  
ALTER TABLE ct_praise_reports ADD COLUMN organization_id INTEGER DEFAULT 1;
UPDATE ct_praise_reports SET organization_id = 1 WHERE organization_id IS NULL;

-- Add organization_id to users table
ALTER TABLE ct_users ADD COLUMN organization_id INTEGER DEFAULT 1;
UPDATE ct_users SET organization_id = 1 WHERE organization_id IS NULL;

-- Add organization_id to analytics table
ALTER TABLE ct_analytics ADD COLUMN organization_id INTEGER DEFAULT 1;
UPDATE ct_analytics SET organization_id = 1 WHERE organization_id IS NULL;

-- Add organization_id to favorites table
ALTER TABLE ct_favorites ADD COLUMN organization_id INTEGER DEFAULT 1;
UPDATE ct_favorites SET organization_id = 1 WHERE organization_id IS NULL;

-- Add organization_id to user_collections table
ALTER TABLE ct_user_collections ADD COLUMN organization_id INTEGER DEFAULT 1;
UPDATE ct_user_collections SET organization_id = 1 WHERE organization_id IS NULL;

-- Add organization_id to personal_prayer_requests table
ALTER TABLE ct_personal_prayer_requests ADD COLUMN organization_id INTEGER DEFAULT 1;
UPDATE ct_personal_prayer_requests SET organization_id = 1 WHERE organization_id IS NULL;

-- Create indexes for performance
CREATE INDEX idx_verses_organization_id ON ct_verses(organization_id);
CREATE INDEX idx_admin_users_organization_id ON ct_admin_users(organization_id);
CREATE INDEX idx_prayer_requests_organization_id ON ct_prayer_requests(organization_id);
CREATE INDEX idx_praise_reports_organization_id ON ct_praise_reports(organization_id);
CREATE INDEX idx_users_organization_id ON ct_users(organization_id);
CREATE INDEX idx_analytics_organization_id ON ct_analytics(organization_id);
CREATE INDEX idx_favorites_organization_id ON ct_favorites(organization_id);
CREATE INDEX idx_user_collections_organization_id ON ct_user_collections(organization_id);
CREATE INDEX idx_personal_prayer_requests_organization_id ON ct_personal_prayer_requests(organization_id);