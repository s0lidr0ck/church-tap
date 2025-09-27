const express = require('express');
const { dbQuery } = require('../config/database');
const { db } = require('../config/database');
const { requireOrgAuth } = require('../config/middleware');
const RecurringEventService = require('../services/recurringEventService');

const router = express.Router();

// Admin: Get all organization links
router.get('/links', requireOrgAuth, (req, res) => {
  db.query(
    `SELECT * FROM ct_organization_links
     WHERE organization_id = $1
     ORDER BY sort_order ASC, title ASC`,
    [req.organizationId],
    (err, result) => {
      if (err) {
        console.error('Error fetching organization links:', err);
        return res.status(500).json({ success: false, error: 'Failed to fetch links' });
      }
      res.json(result.rows || []);
    }
  );
});

// Admin: Create organization link
router.post('/links', requireOrgAuth, (req, res) => {
  const { title, url, icon, sort_order } = req.body;
  
  if (!title || !url) {
    return res.status(400).json({ success: false, error: 'Title and URL are required' });
  }
  
  dbQuery.run(
    `INSERT INTO ct_organization_links (organization_id, title, url, icon, sort_order)
     VALUES ($1, $2, $3, $4, $5)`,
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

module.exports = router;
 
// ===========================
// Events (CT_events) - Admin
// ===========================
router.get('/events', requireOrgAuth, (req, res) => {
  // First check if recurring columns exist
  db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'ct_events' AND column_name = 'is_recurring'
  `, [], (err, columnCheck) => {
    if (err) {
      console.error('Error checking columns:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }

    const hasRecurringColumns = columnCheck.rows.length > 0;

    // Use appropriate query based on whether recurring columns exist
    const query = hasRecurringColumns ? `
      SELECT id, title, description, location, address, start_at, end_at, all_day, link, is_active, notify_lead_minutes,
             is_recurring, recurrence_type, recurrence_interval, recurrence_days, recurrence_end_date,
             parent_event_id, instance_date, is_instance
      FROM CT_events
      WHERE organization_id = $1
      ORDER BY start_at DESC
    ` : `
      SELECT id, title, description, location, address, start_at, end_at, all_day, link, is_active, notify_lead_minutes,
             FALSE as is_recurring, NULL as recurrence_type, 1 as recurrence_interval, NULL as recurrence_days, NULL as recurrence_end_date,
             NULL as parent_event_id, NULL as instance_date, FALSE as is_instance
      FROM CT_events
      WHERE organization_id = $1
      ORDER BY start_at DESC
    `;

    db.query(query, [req.organizationId], (err, result) => {
      if (err) {
        console.error('Error fetching events:', err);
        return res.status(500).json({ success: false, error: 'Failed to fetch events' });
      }
      res.json({ success: true, events: result.rows || [] });
    });
  });
});

router.post('/events', requireOrgAuth, async (req, res) => {
  const {
    title, description, location, address, start_at, end_at, all_day, link, is_active, notify_lead_minutes,
    is_recurring, recurrence_type, recurrence_interval, recurrence_days, recurrence_end_date
  } = req.body || {};

  if (!title || !start_at) {
    return res.status(400).json({ success: false, error: 'Title and start_at are required' });
  }

  try {
    // Check if recurring columns exist
    const columnCheck = await db.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'ct_events' AND column_name = 'is_recurring'
    `, []);

    const hasRecurringColumns = columnCheck.rows.length > 0;

    // Use appropriate query based on whether recurring columns exist
    const query = hasRecurringColumns ? `
      INSERT INTO CT_events (
        organization_id, title, description, location, address, start_at, end_at, all_day, link, is_active, notify_lead_minutes,
        is_recurring, recurrence_type, recurrence_interval, recurrence_days, recurrence_end_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id
    ` : `
      INSERT INTO CT_events (
        organization_id, title, description, location, address, start_at, end_at, all_day, link, is_active, notify_lead_minutes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id
    `;

    const params = hasRecurringColumns ? [
      req.organizationId, title, description || null, location || null, address || null,
      start_at, end_at || null, !!all_day, link || null, is_active !== false, notify_lead_minutes || 120,
      !!is_recurring, recurrence_type || null, recurrence_interval || 1,
      recurrence_days ? JSON.stringify(recurrence_days) : null, recurrence_end_date || null
    ] : [
      req.organizationId, title, description || null, location || null, address || null,
      start_at, end_at || null, !!all_day, link || null, is_active !== false, notify_lead_minutes || 120
    ];

    const result = await db.query(query, params);

    const eventId = result.rows[0].id;

    // If it's a recurring event and recurring columns exist, generate instances
    if (hasRecurringColumns && is_recurring) {
      const event = {
        id: eventId,
        ...req.body,
        organization_id: req.organizationId,
        is_recurring: true
      };
      await RecurringEventService.generateInstancesForEvent(event, new Date(Date.now() + 90 * 24 * 60 * 60 * 1000));
    }

    res.json({ success: true, id: eventId });
  } catch (err) {
    console.error('Error creating event:', err);
    return res.status(500).json({ success: false, error: 'Failed to create event' });
  }
});

router.put('/events/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  const { title, description, location, address, start_at, end_at, all_day, link, is_active, notify_lead_minutes } = req.body || {};
  if (!title || !start_at) {
    return res.status(400).json({ success: false, error: 'Title and start_at are required' });
  }
  db.query(`
    UPDATE CT_events
    SET title = $1, description = $2, location = $3, address = $4, start_at = $5, end_at = $6, all_day = $7, link = $8, is_active = $9, notify_lead_minutes = $10
    WHERE id = $11 AND organization_id = $12
  `, [title, description || null, location || null, address || null, start_at, end_at || null, !!all_day, link || null, is_active !== false, notify_lead_minutes || 120, id, req.organizationId], (err, result) => {
    if (err) {
      console.error('Error updating event:', err);
      return res.status(500).json({ success: false, error: 'Failed to update event' });
    }
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Event not found' });
    res.json({ success: true });
  });
});

router.delete('/events/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  db.query(`DELETE FROM CT_events WHERE id = $1 AND organization_id = $2`, [id, req.organizationId], (err, result) => {
    if (err) {
      console.error('Error deleting event:', err);
      return res.status(500).json({ success: false, error: 'Failed to delete event' });
    }
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Event not found' });
    res.json({ success: true });
  });
});

// ===========================
// CTA (CT_organization_cta) - Admin
// ===========================
router.get('/ctas', requireOrgAuth, (req, res) => {
  dbQuery.all(`
    SELECT id, text, url, icon, bg_color, text_color, start_at, end_at, is_active
    FROM CT_organization_cta
    WHERE organization_id = $1
    ORDER BY COALESCE(start_at, NOW()) DESC
  `, [req.organizationId], (err, rows) => {
    if (err) {
      console.error('Error fetching CTAs:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch CTAs' });
    }
    res.json({ success: true, ctas: rows || [] });
  });
});

router.post('/ctas', requireOrgAuth, (req, res) => {
  const { text, url, icon, bg_color, text_color, start_at, end_at, is_active } = req.body || {};
  if (!text) {
    return res.status(400).json({ success: false, error: 'Text is required' });
  }
  dbQuery.run(`
    INSERT INTO CT_organization_cta (organization_id, text, url, icon, bg_color, text_color, start_at, end_at, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [req.organizationId, text, url || null, icon || '📣', bg_color || '#0ea5e9', text_color || '#ffffff', start_at || null, end_at || null, is_active !== false], function(err) {
    if (err) {
      console.error('Error creating CTA:', err);
      return res.status(500).json({ success: false, error: 'Failed to create CTA' });
    }
    res.json({ success: true, id: this.lastID });
  });
});

router.put('/ctas/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  const { text, url, icon, bg_color, text_color, start_at, end_at, is_active } = req.body || {};
  if (!text) {
    return res.status(400).json({ success: false, error: 'Text is required' });
  }
  dbQuery.run(`
    UPDATE CT_organization_cta
    SET text = $1, url = $2, icon = $3, bg_color = $4, text_color = $5, start_at = $6, end_at = $7, is_active = $8
    WHERE id = $9 AND organization_id = $10
  `, [text, url || null, icon || '📣', bg_color || '#0ea5e9', text_color || '#ffffff', start_at || null, end_at || null, is_active !== false, id, req.organizationId], (err, result) => {
    if (err) {
      console.error('Error updating CTA:', err);
      return res.status(500).json({ success: false, error: 'Failed to update CTA' });
    }
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'CTA not found' });
    res.json({ success: true });
  });
});

router.delete('/ctas/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  db.query(`DELETE FROM ct_organization_cta WHERE id = $1 AND organization_id = $2`, [id, req.organizationId], (err, result) => {
    if (err) {
      console.error('Error deleting CTA:', err);
      return res.status(500).json({ success: false, error: 'Failed to delete CTA' });
    }
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'CTA not found' });
    res.json({ success: true });
  });
});

// ===========================
// BRACELET MEMBERSHIP REQUESTS
// ===========================

// Get all bracelet membership requests for the organization
router.get('/bracelet-requests', requireOrgAuth, (req, res) => {
  const { status } = req.query;
  
  let whereClause = 'WHERE bm.organization_id = $1';
  const params = [req.organizationId];
  
  if (status && ['pending', 'approved', 'denied'].includes(status)) {
    whereClause += ' AND bm.status = $2';
    params.push(status);
  }
  
  const sql = `
    SELECT 
      bm.id,
      bm.bracelet_uid,
      bm.status,
      bm.requested_at,
      bm.approved_at,
      bm.approved_by,
      nt.scan_count,
      nt.last_scanned_at,
      au.username as approved_by_username
    FROM ct_bracelet_memberships bm
    LEFT JOIN ct_nfc_tags nt ON bm.bracelet_uid = nt.custom_id
    LEFT JOIN CT_admin_users au ON bm.approved_by = au.id
    ${whereClause}
    ORDER BY bm.requested_at DESC
  `;
  
  db.query(sql, params, (err, result) => {
    if (err) {
      console.error('Error fetching bracelet requests:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    res.json({ success: true, requests: result.rows || [] });
  });
});

// Approve a bracelet membership request
router.post('/bracelet-requests/:id/approve', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  const adminId = req.user?.id; // Get admin ID from session
  
  // First, verify the request belongs to this organization and is pending
  db.query(`
    SELECT bm.id, bm.bracelet_uid, bm.organization_id, bm.status
    FROM ct_bracelet_memberships bm
    WHERE bm.id = $1 AND bm.organization_id = $2
  `, [id, req.organizationId], (err, result) => {
    if (err) {
      console.error('Error fetching bracelet request:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Bracelet request not found' });
    }
    
    const request = result.rows[0];
    
    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Request has already been processed' });
    }
    
    // Update the membership request to approved
    db.query(`
      UPDATE ct_bracelet_memberships 
      SET status = 'approved', approved_at = NOW(), approved_by = $1
      WHERE id = $2
    `, [adminId, id], (updateErr) => {
      if (updateErr) {
        console.error('Error approving bracelet request:', updateErr);
        return res.status(500).json({ success: false, error: 'Failed to approve request' });
      }
      
      // Update the NFC tag status to 'assigned' 
      db.query(`
        UPDATE ct_nfc_tags 
        SET status = 'assigned', assigned_by = $1, assigned_at = NOW()
        WHERE custom_id = $2
      `, [adminId, request.bracelet_uid], (tagUpdateErr) => {
        if (tagUpdateErr) {
          console.error('Error updating NFC tag status:', tagUpdateErr);
          // Don't fail the approval, just log the error
        }
        
        console.log(`✅ Bracelet request approved: ${request.bracelet_uid} for organization ${req.organizationId}`);
        
        res.json({ 
          success: true, 
          message: 'Bracelet request approved successfully'
        });
      });
    });
  });
});

// Deny a bracelet membership request
router.post('/bracelet-requests/:id/deny', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const adminId = req.user?.id; // Get admin ID from session
  
  // First, verify the request belongs to this organization and is pending
  db.query(`
    SELECT bm.id, bm.bracelet_uid, bm.organization_id, bm.status
    FROM ct_bracelet_memberships bm
    WHERE bm.id = $1 AND bm.organization_id = $2
  `, [id, req.organizationId], (err, result) => {
    if (err) {
      console.error('Error fetching bracelet request:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Bracelet request not found' });
    }
    
    const request = result.rows[0];
    
    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Request has already been processed' });
    }
    
    // Update the membership request to denied
    db.query(`
      UPDATE ct_bracelet_memberships 
      SET status = 'denied', approved_at = NOW(), approved_by = $1
      WHERE id = $2
    `, [adminId, id], (updateErr) => {
      if (updateErr) {
        console.error('Error denying bracelet request:', updateErr);
        return res.status(500).json({ success: false, error: 'Failed to deny request' });
      }
      
      // Remove the organization assignment from the NFC tag and reset status
      db.query(`
        UPDATE ct_nfc_tags 
        SET organization_id = NULL, status = 'available', assigned_by = NULL, assigned_at = NULL
        WHERE custom_id = $1
      `, [request.bracelet_uid], (tagUpdateErr) => {
        if (tagUpdateErr) {
          console.error('Error resetting NFC tag:', tagUpdateErr);
          // Don't fail the denial, just log the error
        }
        
        console.log(`❌ Bracelet request denied: ${request.bracelet_uid} for organization ${req.organizationId}`);
        
        res.json({ 
          success: true, 
          message: 'Bracelet request denied successfully'
        });
      });
    });
  });
});

// Get organization CTAs (Call to Actions)
router.get('/ctas', requireOrgAuth, (req, res) => {
  dbQuery.all(`
    SELECT * FROM ct_organization_cta 
    WHERE organization_id = $1 AND is_active = true
    ORDER BY sort_order ASC, created_at DESC
  `, [req.organizationId], (err, rows) => {
    if (err) {
      console.error('Error fetching CTAs:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch CTAs' });
    }
    
    res.json({ success: true, ctas: rows || [] });
  });
});

// Create CTA
router.post('/ctas', requireOrgAuth, (req, res) => {
  const { title, description, url, button_text, sort_order, is_active } = req.body;
  const organizationId = req.organizationId;
  
  dbQuery.run(`
    INSERT INTO ct_organization_cta (organization_id, title, description, url, button_text, sort_order, is_active, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
  `, [organizationId, title, description, url, button_text, sort_order || 0, is_active !== false], function(err) {
    if (err) {
      console.error('Error creating CTA:', err);
      return res.status(500).json({ success: false, error: 'Failed to create CTA' });
    }
    
    res.json({ success: true, cta_id: this.lastID });
  });
});

// Update CTA
router.put('/ctas/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  const { title, description, url, button_text, sort_order, is_active } = req.body;
  const organizationId = req.organizationId;
  
  dbQuery.run(`
    UPDATE ct_organization_cta 
    SET title = $1, description = $2, url = $3, button_text = $4, sort_order = $5, is_active = $6, updated_at = NOW()
    WHERE id = $7 AND organization_id = $8
  `, [title, description, url, button_text, sort_order, is_active, id, organizationId], function(err) {
    if (err) {
      console.error('Error updating CTA:', err);
      return res.status(500).json({ success: false, error: 'Failed to update CTA' });
    }
    
    res.json({ success: true });
  });
});

// Delete CTA
router.delete('/ctas/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  const organizationId = req.organizationId;
  
  dbQuery.run(`
    DELETE FROM ct_organization_cta 
    WHERE id = $1 AND organization_id = $2
  `, [id, organizationId], function(err) {
    if (err) {
      console.error('Error deleting CTA:', err);
      return res.status(500).json({ success: false, error: 'Failed to delete CTA' });
    }
    
    res.json({ success: true });
  });
});

// Generate recurring event instances (useful for maintenance/testing)
router.post('/events/generate-instances', requireOrgAuth, async (req, res) => {
  try {
    const RecurringEventService = require('../services/recurringEventService');
    const generatedCount = await RecurringEventService.generateUpcomingInstances(90);
    res.json({ 
      success: true, 
      message: `Generated ${generatedCount} recurring event instances`,
      generated: generatedCount 
    });
  } catch (err) {
    console.error('Error generating recurring instances:', err);
    res.status(500).json({ success: false, error: 'Failed to generate instances' });
  }
});

module.exports = router;