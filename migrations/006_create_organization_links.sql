-- Create Organization Links table
CREATE TABLE IF NOT EXISTS ct_organization_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  title VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  icon VARCHAR(50) DEFAULT 'website',
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_ct_organization_links_org_id ON ct_organization_links(organization_id);
CREATE INDEX IF NOT EXISTS idx_ct_organization_links_sort_order ON ct_organization_links(organization_id, sort_order, is_active);