const express = require('express');
const { dbQuery, db } = require('../config/database');
const { requireOrgAuth } = require('../config/middleware');

const router = express.Router();

// Admin: Get all organization links (moved to admin routes)
// This route has been moved to organizationAdmin.routes.js to avoid conflicts

// Admin: Create organization link
router.post('/links', requireOrgAuth, (req, res) => {
  const { title, url, icon, sort_order } = req.body;
  
  if (!title || !url) {
    return res.status(400).json({ success: false, error: 'Title and URL are required' });
  }
  
  dbQuery.run(
    `INSERT INTO ct_organization_links (organization_id, title, url, icon, sort_order) 
     VALUES (?, ?, ?, ?, ?)`,
    [req.organizationId, title, url, icon || 'website', sort_order || 0],
    function(err) {
      if (err) {
        console.error('Error creating organization link:', err);
        return res.status(500).json({ success: false, error: 'Failed to create link' });
      }
      
      res.json({ 
        success: true, 
        link: {
          id: this.lastID,
          organization_id: req.organizationId,
          title,
          url,
          icon: icon || 'website',
          sort_order: sort_order || 0,
          is_active: true
        }
      });
    }
  );
});

// Admin: Update organization link
router.put('/links/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  const { title, url, icon, sort_order, is_active } = req.body;
  
  if (!title || !url) {
    return res.status(400).json({ success: false, error: 'Title and URL are required' });
  }
  
  dbQuery.run(
    `UPDATE ct_organization_links 
     SET title = $1, url = $2, icon = $3, sort_order = $4, is_active = $5
     WHERE id = $6 AND organization_id = $7`,
    [title, url, icon || 'website', sort_order || 0, is_active !== undefined ? is_active : true, id, req.organizationId],
    function(err) {
      if (err) {
        console.error('Error updating organization link:', err);
        return res.status(500).json({ success: false, error: 'Failed to update link' });
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ success: false, error: 'Link not found' });
      }
      
      res.json({ success: true });
    }
  );
});

// Admin: Delete organization link
router.delete('/links/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  
  dbQuery.run(
    `DELETE FROM ct_organization_links 
     WHERE id = $1 AND organization_id = $2`,
    [id, req.organizationId],
    function(err) {
      if (err) {
        console.error('Error deleting organization link:', err);
        return res.status(500).json({ success: false, error: 'Failed to delete link' });
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ success: false, error: 'Link not found' });
      }
      
      res.json({ success: true });
    }
  );
});

// Get organization links (public endpoint)
router.get('/links', (req, res) => {
  const orgId = req.organization?.id || 1;
  console.log('Public links request for organization:', orgId);
  console.log('Request query params:', req.query);
  console.log('Organization from middleware:', req.organization);
  console.log('Organization ID resolved:', orgId);
  
  dbQuery.all(
    `SELECT id, title, url, icon, sort_order 
     FROM ct_organization_links 
     WHERE organization_id = $1 AND is_active = true 
     ORDER BY sort_order ASC, title ASC`,
    [orgId],
    (err, rows) => {
      if (err) {
        console.error('Error fetching organization links:', err);
        return res.status(500).json({ success: false, error: 'Failed to fetch links' });
      }
      console.log('Found', rows.length, 'active organization links for org', orgId);
      console.log('Links found:', rows);
      res.json(rows);
    }
  );
});

// Calendar: get events for a specific day (YYYY-MM-DD)
router.get('/calendar/daily', (req, res) => {
  const orgId = req.organization?.id || 1;
  const { date } = req.query;
  if (!date) {
    return res.status(400).json({ success: false, error: 'date required (YYYY-MM-DD)' });
  }

  dbQuery.all(
    `SELECT id, title, description, location, address, start_at, end_at, all_day, link, notify_lead_minutes
     FROM CT_events
     WHERE organization_id = $1
       AND is_active = TRUE
       AND DATE(start_at) = $2
     ORDER BY start_at ASC`,
    [orgId, date],
    (err, rows) => {
      if (err) {
        console.error('Error fetching daily events:', err);
        return res.status(500).json({ success: false, error: 'Failed to fetch daily events' });
      }
      res.json({ success: true, events: rows || [] });
    }
  );
});

// Calendar: get events for a given month (YYYY-MM)
router.get('/calendar/month', (req, res) => {
  const orgId = req.organization?.id || 1;
  const { ym } = req.query; // e.g., 2025-09
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
    return res.status(400).json({ success: false, error: 'ym required (YYYY-MM)' });
  }

  dbQuery.all(
    `WITH bounds AS (
       SELECT DATE_TRUNC('month', $2::date) AS month_start,
              (DATE_TRUNC('month', $2::date) + INTERVAL '1 month') AS next_month
     )
     SELECT e.id, e.title, e.description, e.location, e.address, e.start_at, e.end_at, e.all_day, e.link, e.notify_lead_minutes
     FROM CT_events e, bounds b
     WHERE e.organization_id = $1
       AND e.is_active = TRUE
       AND e.start_at < b.next_month
       AND COALESCE(e.end_at, e.start_at) >= b.month_start
     ORDER BY e.start_at ASC`,
    [orgId, ym + '-01'],
    (err, rows) => {
      if (err) {
        console.error('Error fetching month events:', err);
        return res.status(500).json({ success: false, error: 'Failed to fetch month events' });
      }
      res.json({ success: true, events: rows || [] });
    }
  );
});

// Active CTA for organization
router.get('/cta', (req, res) => {
  const orgId = req.organization?.id || 1;
  dbQuery.get(
    `SELECT id, text, url, icon, bg_color, text_color, start_at, end_at
     FROM CT_organization_cta
     WHERE organization_id = $1
       AND is_active = TRUE
       AND (start_at IS NULL OR start_at <= NOW())
       AND (end_at IS NULL OR end_at >= NOW())
     ORDER BY COALESCE(start_at, NOW()) DESC
     LIMIT 1`,
    [orgId],
    (err, row) => {
      if (err) {
        console.error('Error fetching CTA:', err);
        return res.status(500).json({ success: false, error: 'Failed to fetch CTA' });
      }
      res.json({ success: true, cta: row || null });
    }
  );
});

// Get all public organizations for bracelet claiming
router.get('/public', (req, res) => {
  console.log('🏢 Fetching public organizations for bracelet claiming');

  db.query(
    `SELECT id, name, short_name, location
     FROM organizations
     WHERE is_active = true
     ORDER BY name ASC`,
    [],
    (err, result) => {
      if (err) {
        console.error('Error fetching public organizations:', err);
        return res.status(500).json({ success: false, error: 'Failed to fetch organizations' });
      }

      console.log('Found', result.rows.length, 'active organizations');
      res.json({ success: true, organizations: result.rows });
    }
  );
});

// Submit new organization request
router.post('/request', (req, res) => {
  const {
    tag_id,
    organization_name,
    organization_type,
    street_address,
    city,
    state,
    zip_code,
    country,
    first_name,
    last_name,
    contact_email,
    phone,
    website,
    description
  } = req.body;

  // Validate required fields
  if (!tag_id || !organization_name || !organization_type || !street_address || !city || !state || !zip_code || !first_name || !last_name || !contact_email) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: tag_id, organization_name, organization_type, street_address, city, state, zip_code, first_name, last_name, contact_email'
    });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(contact_email)) {
    return res.status(400).json({ success: false, error: 'Invalid email format' });
  }

  // Generate a subdomain suggestion based on organization name
  const suggested_subdomain = organization_name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '')
    .substring(0, 20);

  // Combine name fields
  const contact_name = `${first_name} ${last_name}`;

  // Combine address fields
  const full_address = `${street_address}, ${city}, ${state} ${zip_code}${country && country !== 'United States' ? ', ' + country : ''}`;

  console.log('📝 Submitting organization request:', {
    organization_name,
    organization_type,
    full_address,
    contact_email,
    contact_name,
    tag_id
  });

  db.query(`
    INSERT INTO ct_organization_requests (
      org_name, org_type, description, address, contact_name,
      contact_email, contact_phone, requested_subdomain,
      submitted_at, status, bracelet_uid, street_address, city, state, zip_code, country,
      first_name, last_name, website
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), 'pending', $9, $10, $11, $12, $13, $14, $15, $16, $17)
    RETURNING id
  `, [
    organization_name,
    organization_type,
    description || '',
    full_address,
    contact_name,
    contact_email,
    phone || null,
    suggested_subdomain,
    tag_id,
    street_address,
    city,
    state,
    zip_code,
    country || 'United States',
    first_name,
    last_name,
    website || null
  ], (err, result) => {
    if (err) {
      console.error('Error submitting organization request:', err);
      return res.status(500).json({ success: false, error: 'Failed to submit request' });
    }

    const requestId = result.rows[0].id;
    console.log('✅ Organization request submitted with ID:', requestId);

    res.json({
      success: true,
      message: 'Organization request submitted successfully',
      request_id: requestId
    });
  });
});

module.exports = router;
