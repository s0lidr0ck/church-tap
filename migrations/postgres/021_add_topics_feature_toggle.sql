-- 021_add_topics_feature_toggle.sql
-- Add per-organization toggle for the Topics (tag) button / Emergency Scripture topics.
-- Idempotent.

ALTER TABLE ct_organization_features
  ADD COLUMN IF NOT EXISTS topics_enabled BOOLEAN NOT NULL DEFAULT TRUE;

