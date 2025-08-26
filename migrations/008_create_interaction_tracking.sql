-- Migration: Create interaction tracking system for anonymous user tracking
-- This enables tracking NFC tag interactions, user sessions, and IP-based analytics

-- Anonymous sessions table - tracks anonymous sessions based on IP and user agent
CREATE TABLE anonymous_sessions (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(100) UNIQUE NOT NULL,     -- Generated session identifier
  ip_address INET NOT NULL,                     -- User's IP address
  user_agent TEXT,                              -- Browser user agent string
  country VARCHAR(100),                         -- Geolocation country
  region VARCHAR(100),                          -- Geolocation region/state
  city VARCHAR(100),                            -- Geolocation city
  latitude DECIMAL(10, 8),                      -- Latitude coordinates
  longitude DECIMAL(11, 8),                     -- Longitude coordinates
  organization_id INTEGER REFERENCES ct_organizations(id) ON DELETE SET NULL,
  first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  total_interactions INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tag interactions table - tracks every NFC tag scan and interaction
CREATE TABLE tag_interactions (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(100) REFERENCES anonymous_sessions(session_id) ON DELETE CASCADE,
  tag_id VARCHAR(100) NOT NULL,                -- The MAC address or custom_id of the scanned tag
  interaction_type VARCHAR(50) DEFAULT 'scan', -- scan, view, share, etc.
  page_url TEXT,                               -- Which page was accessed
  referrer TEXT,                               -- HTTP referrer
  user_agent TEXT,                             -- Browser user agent
  ip_address INET NOT NULL,                    -- IP address at time of interaction
  organization_id INTEGER REFERENCES ct_organizations(id) ON DELETE SET NULL,
  interaction_data JSONB,                      -- Additional interaction data
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_anonymous_sessions_session_id ON anonymous_sessions(session_id);
CREATE INDEX idx_anonymous_sessions_ip_address ON anonymous_sessions(ip_address);
CREATE INDEX idx_anonymous_sessions_organization_id ON anonymous_sessions(organization_id);
CREATE INDEX idx_anonymous_sessions_created_at ON anonymous_sessions(created_at);
CREATE INDEX idx_anonymous_sessions_coordinates ON anonymous_sessions(latitude, longitude);

CREATE INDEX idx_tag_interactions_session_id ON tag_interactions(session_id);
CREATE INDEX idx_tag_interactions_tag_id ON tag_interactions(tag_id);
CREATE INDEX idx_tag_interactions_organization_id ON tag_interactions(organization_id);
CREATE INDEX idx_tag_interactions_created_at ON tag_interactions(created_at);
CREATE INDEX idx_tag_interactions_ip_address ON tag_interactions(ip_address);
CREATE INDEX idx_tag_interactions_interaction_type ON tag_interactions(interaction_type);

-- Create a trigger to update the updated_at timestamp for anonymous_sessions
CREATE OR REPLACE FUNCTION update_anonymous_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER anonymous_sessions_updated_at_trigger
    BEFORE UPDATE ON anonymous_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_anonymous_sessions_updated_at();

-- Create aggregate view for quick analytics
CREATE VIEW session_analytics AS
SELECT 
  DATE(created_at) as date,
  organization_id,
  country,
  city,
  COUNT(*) as session_count,
  SUM(total_interactions) as total_interactions,
  AVG(total_interactions) as avg_interactions_per_session
FROM anonymous_sessions
GROUP BY DATE(created_at), organization_id, country, city;

-- Create tag interaction analytics view
CREATE VIEW tag_analytics AS
SELECT 
  DATE(created_at) as date,
  tag_id,
  organization_id,
  interaction_type,
  COUNT(*) as interaction_count,
  COUNT(DISTINCT session_id) as unique_sessions
FROM tag_interactions
GROUP BY DATE(created_at), tag_id, organization_id, interaction_type;