-- Migration: Create NFC tags table for managing physical NFC tags
-- This enables assigning custom IDs to NFC tags and associating them with organizations

CREATE TABLE nfc_tags (
  id SERIAL PRIMARY KEY,
  custom_id VARCHAR(50) UNIQUE NOT NULL,     -- Custom identifier assigned by admin (e.g., "BATCH1-001")
  organization_id INTEGER REFERENCES ct_organizations(id) ON DELETE SET NULL,
  nfc_id VARCHAR(100),                       -- Actual NFC tag ID (written to tag)
  status VARCHAR(20) DEFAULT 'available',    -- available, assigned, active, inactive, lost
  assigned_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_scanned_at TIMESTAMP,
  scan_count INTEGER DEFAULT 0,
  notes TEXT,                                -- Admin notes about the tag
  batch_name VARCHAR(100),                   -- For organizing tags by batch
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_nfc_tags_custom_id ON nfc_tags(custom_id);
CREATE INDEX idx_nfc_tags_organization_id ON nfc_tags(organization_id);
CREATE INDEX idx_nfc_tags_status ON nfc_tags(status);
CREATE INDEX idx_nfc_tags_batch_name ON nfc_tags(batch_name);
CREATE INDEX idx_nfc_tags_nfc_id ON nfc_tags(nfc_id);

-- Create a trigger to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_nfc_tags_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER nfc_tags_updated_at_trigger
    BEFORE UPDATE ON nfc_tags
    FOR EACH ROW
    EXECUTE FUNCTION update_nfc_tags_updated_at();