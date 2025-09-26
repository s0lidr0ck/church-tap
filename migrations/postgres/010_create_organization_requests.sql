-- Organization Requests Table
-- This table stores requests for new organizations to be reviewed by master admins

CREATE TABLE IF NOT EXISTS ct_organization_requests (
  id SERIAL PRIMARY KEY,

  -- Organization Details
  org_name TEXT NOT NULL,
  org_type TEXT NOT NULL CHECK (org_type IN ('church', 'ministry', 'small_group', 'bible_study')),
  description TEXT,

  -- Address Information
  address TEXT, -- Combined address for compatibility
  street_address TEXT,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  country TEXT DEFAULT 'United States',

  -- Contact Information
  contact_name TEXT NOT NULL, -- Combined name for compatibility
  first_name TEXT,
  last_name TEXT,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  contact_title TEXT,

  -- Organization Setup
  website TEXT,
  requested_subdomain TEXT NOT NULL,

  -- Request Tracking
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'under_review', 'approved', 'denied')),
  submitted_at TIMESTAMP DEFAULT NOW(),
  reviewed_at TIMESTAMP,
  reviewed_by INTEGER, -- Reference to CT_master_admins.id
  review_notes TEXT,

  -- Approval Process
  approval_email_sent BOOLEAN DEFAULT FALSE,
  admin_account_created BOOLEAN DEFAULT FALSE,
  organization_id INTEGER, -- Reference to CT_organizations.id when approved
  setup_token TEXT,
  setup_token_expires_at TIMESTAMP,

  -- Source Tracking
  bracelet_uid TEXT, -- NFC tag that initiated the request
  source_ip TEXT,
  user_agent TEXT,

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ct_org_requests_status ON ct_organization_requests(status);
CREATE INDEX IF NOT EXISTS idx_ct_org_requests_submitted_at ON ct_organization_requests(submitted_at);
CREATE INDEX IF NOT EXISTS idx_ct_org_requests_subdomain ON ct_organization_requests(requested_subdomain);
CREATE INDEX IF NOT EXISTS idx_ct_org_requests_bracelet_uid ON ct_organization_requests(bracelet_uid);
CREATE INDEX IF NOT EXISTS idx_ct_org_requests_organization_id ON ct_organization_requests(organization_id);

-- Add foreign key constraints
ALTER TABLE ct_organization_requests
ADD CONSTRAINT fk_org_requests_organization
FOREIGN KEY (organization_id) REFERENCES CT_organizations(id) ON DELETE SET NULL;

-- Note: We can't add foreign key to CT_master_admins as it might not exist yet
-- This should be added in a later migration if needed