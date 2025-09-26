const express = require('express');
const { db, dbQuery } = require('../config/database');
const { requireMasterAuth } = require('../config/middleware');

const router = express.Router();

// Get all NFC tags (with optional filters)
router.get('/', requireMasterAuth, (req, res) => {
  const { status, organization_id, batch_name } = req.query;
  
  let sql = `
    SELECT nt.*, o.name as organization_name, o.subdomain, au.username as assigned_by_username
    FROM ct_nfc_tags nt
    LEFT JOIN ct_organizations o ON nt.organization_id = o.id
    LEFT JOIN ct_admin_users au ON nt.assigned_by = au.id
    WHERE 1=1
  `;
  const params = [];
  let paramIndex = 1;
  
  if (status) {
    sql += ` AND nt.status = $${paramIndex++}`;
    params.push(status);
  }
  
  if (organization_id) {
    sql += ` AND nt.organization_id = $${paramIndex++}`;
    params.push(organization_id);
  }
  
  if (batch_name) {
    sql += ` AND nt.batch_name = $${paramIndex++}`;
    params.push(batch_name);
  }
  
  sql += ` ORDER BY nt.created_at DESC`;
  
  db.query(sql, params, (err, result) => {
    if (err) {
      console.error('Error fetching NFC tags:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    res.json({ success: true, tags: result.rows || [] });
  });
});

// Create new NFC tag
router.post('/', requireMasterAuth, (req, res) => {
  const { custom_id, batch_name, notes } = req.body;
  
  if (!custom_id) {
    return res.status(400).json({ success: false, error: 'Custom ID is required' });
  }
  
  db.query(`
    INSERT INTO ct_nfc_tags (custom_id, batch_name, notes, assigned_by, status)
    VALUES ($1, $2, $3, $4, 'available')
    RETURNING id
  `, [custom_id, batch_name || null, notes || null, req.session.masterAdminId], 
  (err, result) => {
    if (err) {
      if (err.code === '23505') { // Unique constraint in PostgreSQL
        return res.status(400).json({ success: false, error: 'Custom ID already exists' });
      }
      console.error('Create NFC tag error:', err);
      return res.status(500).json({ success: false, error: 'Failed to create NFC tag' });
    }
    
    res.json({ success: true, tag_id: result.rows[0].id });
  });
});

// Bulk create NFC tags
router.post('/bulk', requireMasterAuth, (req, res) => {
  const { batch_name, count, prefix, notes } = req.body;
  
  if (!batch_name || !count || count <= 0 || count > 1000) {
    return res.status(400).json({ success: false, error: 'Valid batch name and count (1-1000) are required' });
  }
  
  // Create the VALUES clause for bulk insert
  const values = [];
  const params = [];
  let paramIndex = 1;
  
  for (let i = 1; i <= count; i++) {
    const paddedNum = i.toString().padStart(3, '0');
    const custom_id = `${prefix || batch_name}-${paddedNum}`;
    
    values.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, 'available')`);
    params.push(custom_id, batch_name, notes || null, req.session.masterAdminId);
  }
  
  db.query(`
    INSERT INTO ct_nfc_tags (custom_id, batch_name, notes, assigned_by, status)
    VALUES ${values.join(', ')}
  `, params, (err, result) => {
    if (err) {
      console.error('Bulk insert error:', err);
      return res.status(500).json({ success: false, error: 'Failed to create NFC tags' });
    }
    
    res.json({ success: true, created_count: count });
  });
});

// Assign NFC tag to organization
router.put('/:id/assign', requireMasterAuth, (req, res) => {
  const { id } = req.params;
  const { organization_id, nfc_id } = req.body;
  
  if (!organization_id) {
    return res.status(400).json({ success: false, error: 'Organization ID is required' });
  }
  
  // Verify organization exists and get subdomain and tag custom_id for URL generation
  db.query(`SELECT id, subdomain FROM ct_organizations WHERE id = $1`, [organization_id], (err, orgResult) => {
    if (err) {
      console.error('Organization check error:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    if (orgResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Organization not found' });
    }
    
    const organization = orgResult.rows[0];
    
    // Get the tag's custom_id for URL generation
    db.query(`SELECT custom_id FROM ct_nfc_tags WHERE id = $1`, [id], (err, tagResult) => {
      if (err) {
        console.error('Tag lookup error:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      if (tagResult.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'NFC tag not found' });
      }
      
      const tag = tagResult.rows[0];
      
      // Update the NFC tag
      db.query(`
        UPDATE ct_nfc_tags SET 
          organization_id = $1, 
          status = 'assigned',
          assigned_by = $2,
          assigned_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 AND status IN ('available', 'inactive')
    `, [organization_id, req.session.masterAdminId, id], 
    (err, result) => {
      if (err) {
        console.error('Assign NFC tag error:', err);
        return res.status(500).json({ success: false, error: 'Failed to assign NFC tag' });
      }
      
      if (result.rowCount === 0) {
        return res.status(404).json({ success: false, error: 'NFC tag not found or cannot be assigned' });
      }
      
      res.json({ success: true });
    });
    });
  });
});

// Update NFC tag status
router.put('/:id/status', requireMasterAuth, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  const validStatuses = ['available', 'assigned', 'active', 'inactive', 'lost'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid status' });
  }
  
  db.query(`
    UPDATE ct_nfc_tags SET 
      status = $1,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
  `, [status, id], 
  (err, result) => {
    if (err) {
      console.error('Update NFC tag status error:', err);
      return res.status(500).json({ success: false, error: 'Failed to update NFC tag status' });
    }
    
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'NFC tag not found' });
    }
    
    res.json({ success: true });
  });
});

// Delete NFC tag
router.delete('/:id', requireMasterAuth, (req, res) => {
  const { id } = req.params;
  
  db.query(`DELETE FROM ct_nfc_tags WHERE id = $1`, [id], (err, result) => {
    if (err) {
      console.error('Delete NFC tag error:', err);
      return res.status(500).json({ success: false, error: 'Failed to delete NFC tag' });
    }
    
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'NFC tag not found' });
    }
    
    res.json({ success: true });
  });
});

// Get NFC tag batches
router.get('/batches', requireMasterAuth, (req, res) => {
  db.query(`
    SELECT 
      batch_name,
      COUNT(*) as total_tags,
      SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available_tags,
      SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END) as assigned_tags,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_tags,
      MIN(created_at) as created_at
    FROM ct_nfc_tags 
    WHERE batch_name IS NOT NULL
    GROUP BY batch_name
    ORDER BY created_at DESC
  `, [], (err, result) => {
    if (err) {
      console.error('Error fetching NFC tag batches:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    res.json({ success: true, batches: result.rows || [] });
  });
});

// Record NFC tag scan
router.post('/scan/:custom_id', (req, res) => {
  const { custom_id } = req.params;
  
  db.query(`
    UPDATE ct_nfc_tags SET 
      last_scanned_at = CURRENT_TIMESTAMP,
      scan_count = scan_count + 1,
      updated_at = CURRENT_TIMESTAMP
    WHERE custom_id = $1
  `, [custom_id], 
  (err, result) => {
    if (err) {
      console.error('Error recording NFC scan:', err);
      return res.status(500).json({ success: false, error: 'Failed to record scan' });
    }
    
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'NFC tag not found' });
    }
    
    // Get tag info including organization details
    db.query(`
      SELECT nt.*, o.subdomain, o.custom_domain
      FROM ct_nfc_tags nt
      LEFT JOIN ct_organizations o ON nt.organization_id = o.id
      WHERE nt.custom_id = $1
    `, [custom_id], (err, tagResult) => {
      if (err || tagResult.rows.length === 0) {
        return res.json({ success: true }); // Still record the scan even if we can't get details
      }
      
      const tag = tagResult.rows[0];
      // Return redirect information if assigned to an organization
      if (tag.organization_id && tag.subdomain) {
        // For development, stay on the same host
        const protocol = req.secure ? 'https' : 'http';
        const host = req.get('host');
        let redirectUrl;
        
        if (host.includes('localhost') || host.includes('127.0.0.1')) {
          // Development environment - stay on localhost
          redirectUrl = `${protocol}://${host}/?org=${tag.subdomain}&tag_id=${custom_id}`;
        } else {
          // Production environment
          const baseUrl = tag.custom_domain || `${tag.subdomain}.churchtap.app`;
          redirectUrl = `https://${baseUrl}/?org=${tag.subdomain}&tag_id=${custom_id}`;
        }
        
        return res.json({ 
          success: true, 
          redirect_url: redirectUrl
        });
      }
      
      res.json({ success: true });
    });
  });
});

module.exports = router;