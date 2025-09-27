const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../config/database');
const { requireMasterAuth } = require('../config/middleware');

const router = express.Router();

// Master admin login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password required' });
  }
  
  db.query(`SELECT * FROM CT_master_admins WHERE username = $1`, [username], async (err, result) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    const user = result.rows[0];
    if (!user || !await bcrypt.compare(password, user.password_hash)) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    
    if (!user.is_active) {
      return res.status(401).json({ success: false, error: 'Account is disabled' });
    }
    
    req.session.master_admin = {
      id: user.id,
      username: user.username,
      role: user.role
    };
    req.session.masterAdminId = user.id;
    req.session.masterAdminUsername = user.username;
    
    // Update last login
    db.query(`UPDATE CT_master_admins SET last_login_at = CURRENT_TIMESTAMP, last_login_ip = $1 WHERE id = $2`, 
      [req.ip, user.id]);
    
    res.json({ success: true, admin: { id: user.id, username: user.username, role: user.role } });
  });
});

// Master admin logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Check master admin session status
router.get('/check-session', (req, res) => {
  if (req.session.master_admin) {
    res.json({
      success: true,
      authenticated: true,
      admin: req.session.master_admin
    });
  } else {
    res.json({ 
      success: true, 
      authenticated: false 
    });
  }
});

// Get master dashboard data
router.get('/dashboard', requireMasterAuth, (req, res) => {
  // Get organization stats
  const getOrgStats = new Promise((resolve, reject) => {
    db.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN is_active THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN plan_type = 'basic' THEN 29 WHEN plan_type = 'premium' THEN 79 WHEN plan_type = 'enterprise' THEN 199 ELSE 0 END) as revenue
      FROM CT_organizations
    `, (err, rows) => {
      if (err) reject(err);
      else resolve(rows[0] || {});
    });
  });
  
  // Get total users across all orgs
  const getUserStats = new Promise((resolve, reject) => {
    db.query(`SELECT COUNT(*) as total FROM CT_users`, (err, row) => {
      if (err) reject(err);
      else resolve(row || {});
    });
  });
  
  // Get recent organizations
  const getRecentOrgs = new Promise((resolve, reject) => {
    db.query(`SELECT name, subdomain, created_at FROM CT_organizations ORDER BY created_at DESC LIMIT 5`, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });

  Promise.all([getOrgStats, getUserStats, getRecentOrgs])
    .then(([orgStats, userStats, recentOrgs]) => {
      res.json({
        success: true,
        stats: {
          totalOrganizations: orgStats.total || 0,
          activeOrganizations: orgStats.active || 0,
          monthlyRevenue: orgStats.revenue || 0,
          totalUsers: userStats.total || 0
        },
        recentOrganizations: recentOrgs,
        systemAlerts: []
      });
    })
    .catch(error => {
      console.error('Dashboard data error:', error);
      res.status(500).json({ success: false, error: 'Failed to load dashboard data' });
    });
});

// Get all organizations
router.get('/organizations', requireMasterAuth, (req, res) => {
  try {
    console.log('📊 Querying organizations table...');
    db.query(`SELECT * FROM CT_organizations ORDER BY created_at DESC`, [], (err, result) => {
      if (err) {
        console.error('Master organizations query error:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      console.log(`📋 Found ${result.rows.length} organizations:`, result.rows.map(r => `ID:${r.id} Name:${r.name}`));
      res.json({ success: true, organizations: result.rows });
    });
  } catch (error) {
    console.error('Master organizations endpoint error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// List admins for a specific organization (master scope)
router.get('/organizations/:id/admins', requireMasterAuth, (req, res) => {
  const { id } = req.params;
  db.query(
    `SELECT id, username, email, role, is_active, created_at, last_login_at 
     FROM CT_admin_users 
     WHERE organization_id = $1 
     ORDER BY created_at DESC`,
    [id],
    (err, result) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      res.json({ success: true, admins: result.rows });
    }
  );
});

// Get single admin details
router.get('/organizations/:id/admins/:adminId', requireMasterAuth, (req, res) => {
  const { id, adminId } = req.params;
  
  db.query(
    `SELECT id, username, email, role, is_active, created_at, last_login_at, organization_id
     FROM CT_admin_users 
     WHERE id = $1 AND organization_id = $2`,
    [adminId, id],
    (err, result) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      const admin = result.rows[0];
      if (!admin) {
        return res.status(404).json({ success: false, error: 'Admin not found' });
      }
      
      res.json({ success: true, admin });
    }
  );
});

// Update admin (activate/deactivate, role changes) for an organization (master scope)
router.put('/organizations/:id/admins/:adminId', requireMasterAuth, (req, res) => {
  const { id, adminId } = req.params;
  const { is_active, role, username, email } = req.body;

  // Ensure admin belongs to the organization
  db.query(`SELECT id, organization_id FROM CT_admin_users WHERE id = $1`, [adminId], (err, result) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    const admin = result.rows[0];
    if (!admin || String(admin.organization_id) !== String(id)) {
      return res.status(404).json({ success: false, error: 'Admin not found in this organization' });
    }

    const fields = [];
    const params = [];
    let paramIndex = 1;
    
    if (typeof is_active === 'boolean') {
      fields.push(`is_active = $${paramIndex++}`);
      params.push(is_active);
    }
    if (role) {
      fields.push(`role = $${paramIndex++}`);
      params.push(role);
    }
    if (username) {
      fields.push(`username = $${paramIndex++}`);
      params.push(username);
    }
    if (email !== undefined) {
      fields.push(`email = $${paramIndex++}`);
      params.push(email || null);
    }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, error: 'No changes provided' });
    }

    params.push(adminId);
    db.query(`UPDATE CT_admin_users SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIndex}`, params, (updateErr, result) => {
      if (updateErr) {
        return res.status(500).json({ success: false, error: 'Failed to update admin' });
      }
      return res.json({ success: true });
    });
  });
});

// Delete admin for an organization (master scope)
router.delete('/organizations/:id/admins/:adminId', requireMasterAuth, (req, res) => {
  const { id, adminId } = req.params;
  
  // First verify the admin exists and belongs to the organization
  db.query(`SELECT id, username, organization_id, is_active FROM CT_admin_users WHERE id = $1`, [adminId], (err, result) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    const admin = result.rows[0];
    if (!admin || String(admin.organization_id) !== String(id)) {
      return res.status(404).json({ success: false, error: 'Admin not found in this organization' });
    }
    
    // Only allow deletion of inactive admins
    if (admin.is_active) {
      return res.status(400).json({ success: false, error: 'Cannot delete active admin. Deactivate first.' });
    }
    
    // Delete the admin
    db.query(`DELETE FROM CT_admin_users WHERE id = $1`, [adminId], (deleteErr, deleteResult) => {
      if (deleteErr) {
        return res.status(500).json({ success: false, error: 'Failed to delete admin' });
      }
      
      if (deleteResult.rowCount === 0) {
        return res.status(404).json({ success: false, error: 'Admin not found' });
      }
      
      res.json({ success: true, message: 'Admin deleted successfully' });
    });
  });
});

// Create new organization
router.post('/organizations', requireMasterAuth, (req, res) => {
  try {
    const { 
      name, subdomain, contact_email, plan_type, custom_domain,
      org_type, join_type, address, city, state, zip_code, country, latitude, longitude 
    } = req.body;
    
    // Convert empty strings to null for optional fields with constraints
    const cleanOrgType = org_type && org_type.trim() !== '' ? org_type : null;
    
    if (!name || !subdomain || !plan_type) {
      return res.status(400).json({ success: false, error: 'Name, subdomain, and plan are required' });
    }
    
    // Check if subdomain is already taken
    db.query(`SELECT id FROM CT_organizations WHERE subdomain = $1`, [subdomain], (err, existing) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    if (existing) {
      return res.status(400).json({ success: false, error: 'Subdomain is already taken' });
    }
    
    const settings = JSON.stringify({
      theme: 'default',
      features: { community: true, analytics: true, users: true }
    });
    
    const features = JSON.stringify(['verses', 'community', 'analytics', 'users']);
    
    db.query(`
      INSERT INTO CT_organizations (
        name, subdomain, contact_email, plan_type, custom_domain, settings, features,
        org_type, join_type, address, city, state, zip_code, country, latitude, longitude
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    `, [name, subdomain, contact_email, plan_type, custom_domain, settings, features,
        cleanOrgType, join_type, address, city, state, zip_code, country, latitude, longitude], 
    (err, result) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Failed to create organization' });
      }
      
      // Log activity
      db.query(`
        INSERT INTO CT_master_admin_activity (
          master_admin_id, action, resource_type, resource_id, details, ip_address
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        req.session.masterAdminId, 
        'create_organization', 
        'organization', 
        result.insertId || 'new',
        JSON.stringify({ name, subdomain, plan_type }),
        req.ip
      ]);
      
      res.json({ success: true, organization_id: result.insertId || 'created' });
    });
  });
  } catch (error) {
    console.error('Master create organization endpoint error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Update organization
router.put('/organizations/:id', requireMasterAuth, (req, res) => {
  const { id } = req.params;
  console.log('📝 Organization update request:', { id, body: req.body });
  
  const { 
    name, subdomain, contact_email, plan_type, custom_domain,
    org_type, join_type, address, city, state, zip_code, country, latitude, longitude 
  } = req.body;
  
  // Convert empty strings to null for optional fields with constraints
  const cleanOrgType = org_type && org_type.trim() !== '' ? org_type : null;
  
  if (!name || !subdomain || !plan_type) {
    return res.status(400).json({ success: false, error: 'Name, subdomain, and plan are required' });
  }
  
  // Check if subdomain is taken by another organization
  db.query(`SELECT id FROM CT_organizations WHERE subdomain = $1 AND id != $2`, [subdomain, id], (err, result) => {
    if (err) {
      console.error('❌ Subdomain check error:', err);
      return res.status(500).json({ success: false, error: 'Database error: ' + err.message });
    }
    
    if (result.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'Subdomain is already taken' });
    }
    
    db.query(`
      UPDATE CT_organizations SET 
        name = $1, subdomain = $2, contact_email = $3, plan_type = $4, 
        custom_domain = $5, org_type = $6, join_type = $7, address = $8,
        city = $9, state = $10, zip_code = $11, country = $12, 
        latitude = $13, longitude = $14, updated_at = CURRENT_TIMESTAMP
      WHERE id = $15
    `, [name, subdomain, contact_email, plan_type, custom_domain, cleanOrgType, join_type, 
        address, city, state, zip_code, country, latitude, longitude, id], 
    (err, result) => {
      if (err) {
        console.error('❌ Organization update error:', err);
        return res.status(500).json({ success: false, error: 'Failed to update organization: ' + err.message });
      }
      
      if (result.rowCount === 0) {
        return res.status(404).json({ success: false, error: 'Organization not found' });
      }
      
      // Log activity
      db.query(`
        INSERT INTO CT_master_admin_activity (
          master_admin_id, action, resource_type, resource_id, organization_id, details, ip_address
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        req.session.masterAdminId, 
        'update_organization', 
        'organization', 
        id,
        id,
        JSON.stringify({ name, subdomain, plan_type }),
        req.ip
      ]);
      
      res.json({ success: true });
    });
  });
});

// Delete organization
router.delete('/organizations/:id', requireMasterAuth, (req, res) => {
  const { id } = req.params;
  
  if (id === '1') {
    return res.status(400).json({ success: false, error: 'Cannot delete default organization' });
  }
  
  // Get organization info for logging
  db.query(`SELECT name, subdomain FROM ct_organizations WHERE id = $1`, [id], (err, result) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }

    const org = result.rows[0];
    if (!org) {
      return res.status(404).json({ success: false, error: 'Organization not found' });
    }

    // Delete organization (this will cascade delete related data)
    db.query(`DELETE FROM ct_organizations WHERE id = $1`, [id], (err, result) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Failed to delete organization' });
      }
      
      // Log activity  
      db.query(`
        INSERT INTO CT_master_admin_activity (
          master_admin_id, action, resource_type, resource_id, details, ip_address
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        req.session.masterAdminId, 
        'delete_organization', 
        'organization', 
        id,
        JSON.stringify({ name: org.name, subdomain: org.subdomain }),
        req.ip
      ]);
      
      res.json({ success: true });
    });
  });
});

// Master overview: global and per-organization usage metrics
router.get('/overview', requireMasterAuth, (req, res) => {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoISO = sevenDaysAgo.toISOString();

  const getTotals = new Promise((resolve, reject) => {
    db.query(`
      SELECT 
        (SELECT COUNT(*) FROM CT_organizations) AS total_orgs,
        (SELECT COUNT(*) FROM CT_organizations WHERE is_active = TRUE) AS active_orgs,
        (SELECT COUNT(*) FROM CT_users) AS total_users,
        (SELECT COUNT(*) FROM CT_verses) AS total_verses,
        (SELECT COUNT(*) FROM CT_analytics WHERE action = 'verse_view' AND timestamp >= $1) AS total_views_7d,
        (SELECT COUNT(DISTINCT ip_address) FROM CT_analytics WHERE action = 'verse_view' AND timestamp >= $2) AS unique_visitors_7d
    `, [sevenDaysAgoISO, sevenDaysAgoISO], (err, result) => {
      if (err) return reject(err);
      const row = result?.rows[0];
      const totals = {
        totalOrganizations: parseInt(row?.total_orgs || 0),
        activeOrganizations: parseInt(row?.active_orgs || 0),
        totalUsers: parseInt(row?.total_users || 0),
        totalVerses: parseInt(row?.total_verses || 0),
        totalViews7d: parseInt(row?.total_views_7d || 0),
        uniqueVisitors7d: parseInt(row?.unique_visitors_7d || 0)
      };
      resolve(totals);
    });
  });

  const getPerOrg = new Promise((resolve, reject) => {
    db.query(
      `SELECT 
         o.id,
         o.name,
         o.subdomain,
         o.plan_type,
         o.is_active,
         o.created_at,
         (SELECT COUNT(*) FROM CT_verses v WHERE v.organization_id = o.id) AS verse_count,
         (SELECT COUNT(*) FROM CT_admin_users au WHERE au.organization_id = o.id) AS admin_count,
         (SELECT COUNT(*) FROM CT_users u WHERE u.organization_id = o.id) AS user_count,
         (SELECT MAX(timestamp) FROM CT_analytics a WHERE a.organization_id = o.id) AS last_activity,
         (SELECT COUNT(*) FROM CT_analytics a WHERE a.organization_id = o.id AND a.timestamp >= $1) AS views_7d
       FROM CT_organizations o
       ORDER BY o.created_at DESC`,
      [sevenDaysAgoISO],
      (err, result) => {
        if (err) return reject(err);
        resolve(result?.rows || []);
      }
    );
  });

  Promise.all([getTotals, getPerOrg])
    .then(([totals, perOrg]) => {
      // Global 7-day timeseries
      db.query(
        `SELECT DATE(timestamp) as date, COUNT(*) as views, COUNT(DISTINCT ip_address) as unique_visitors
         FROM CT_analytics 
         WHERE action = 'verse_view' AND timestamp >= $1
         GROUP BY DATE(timestamp)
         ORDER BY DATE(timestamp) ASC`,
        [sevenDaysAgoISO],
        (tsErr, result) => {
          if (tsErr) {
            console.error('Overview timeseries error:', tsErr);
          }
          const globalDaily = (result?.rows || []).map(r => ({
            date: r.date,
            views: r.views,
            uniqueVisitors: r.unique_visitors
          }));

          const topActiveOrgs = [...perOrg]
            .sort((a, b) => (b.views_7d || 0) - (a.views_7d || 0))
            .slice(0, 5);

          res.json({ success: true, totals, perOrg, topActiveOrgs, globalDaily });
        }
      );
    })
    .catch((error) => {
      console.error('Master overview error:', error);
      res.status(500).json({ success: false, error: 'Failed to load overview' });
    });
});

// ========================================
// ORGANIZATION REQUEST MANAGEMENT
// ========================================

// Get all organization requests
router.get('/organization-requests', requireMasterAuth, (req, res) => {
  const { status } = req.query;
  
  let whereClause = '';
  const params = [];
  
  if (status && ['pending', 'approved', 'denied', 'under_review'].includes(status)) {
    whereClause = 'WHERE status = $1';
    params.push(status);
  }
  
  const sql = `
    SELECT 
      id, org_name, org_type, description, address, city, state, zip_code,
      contact_name, contact_email, contact_phone, contact_title,
      requested_subdomain, status, submitted_at, reviewed_at, review_notes,
      approval_email_sent, admin_account_created, organization_id
    FROM ct_organization_requests 
    ${whereClause}
    ORDER BY submitted_at DESC
  `;
  
  db.query(sql, params, (err, result) => {
    if (err) {
      console.error('Error fetching organization requests:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    res.json({ success: true, requests: result.rows || [] });
  });
});

// Get single organization request
router.get('/organization-requests/:id', requireMasterAuth, (req, res) => {
  const { id } = req.params;
  
  db.query(`
    SELECT * FROM ct_organization_requests WHERE id = $1
  `, [id], (err, result) => {
    if (err) {
      console.error('Error fetching organization request:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }
    
    res.json({ success: true, request: result.rows[0] });
  });
});

// Update organization request status
router.put('/organization-requests/:id/status', requireMasterAuth, (req, res) => {
  const { id } = req.params;
  const { status, review_notes } = req.body;
  
  if (!['pending', 'approved', 'denied', 'under_review'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid status' });
  }
  
  db.query(`
    UPDATE ct_organization_requests 
    SET status = $1, reviewed_at = NOW(), reviewed_by = $2, review_notes = $3
    WHERE id = $4
  `, [status, req.session.masterAdminId, review_notes || null, id], (err, result) => {
    if (err) {
      console.error('Error updating request status:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }
    
    // Log activity
    db.query(`
      INSERT INTO CT_master_admin_activity (
        master_admin_id, action, resource_type, resource_id, details, ip_address
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      req.session.masterAdminId,
      'update_org_request_status',
      'organization_request',
      id,
      JSON.stringify({ status, review_notes }),
      req.ip
    ], (logErr) => {
      if (logErr) console.error('Error logging activity:', logErr);
    });
    
    res.json({ success: true });
  });
});

// Approve organization request and create organization
router.post('/organization-requests/:id/approve', requireMasterAuth, async (req, res) => {
  const { id } = req.params;
  const { custom_plan_type, custom_subdomain } = req.body;
  
  try {
    // Get the request details
    db.query(`
      SELECT * FROM ct_organization_requests WHERE id = $1 AND status = 'pending'
    `, [id], async (err, result) => {
      if (err) {
        console.error('Error fetching request:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Request not found or already processed' });
      }
      
      const request = result.rows[0];
      const subdomain = custom_subdomain || request.requested_subdomain;
      const planType = custom_plan_type || 'standard';
      
      // Check subdomain availability one more time
      db.query(`
        SELECT id FROM CT_organizations WHERE subdomain = $1
      `, [subdomain], (checkErr, existingOrg) => {
        if (checkErr) {
          console.error('Error checking subdomain:', checkErr);
          return res.status(500).json({ success: false, error: 'Database error' });
        }
        
        if (existingOrg.rows.length > 0) {
          return res.status(400).json({ success: false, error: 'Subdomain is already taken' });
        }
        
        // Create the organization
        db.query(`
          INSERT INTO CT_organizations (
            name, subdomain, plan_type, contact_email, contact_phone, 
            address, org_type, city, state, zip_code, country, join_type
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING id
        `, [
          request.org_name,
          subdomain,
          planType,
          request.contact_email,
          request.contact_phone,
          request.address,
          request.org_type,
          request.city,
          request.state,
          request.zip_code,
          request.country || 'US',
          'open' // Default to open, can be changed later
        ], (createErr, orgResult) => {
          if (createErr) {
            console.error('Error creating organization:', createErr);
            return res.status(500).json({ success: false, error: 'Failed to create organization' });
          }
          
          const organizationId = orgResult.rows[0].id;
          
          // Generate setup token for admin account creation
          const setupToken = require('crypto').randomBytes(32).toString('hex');
          const tokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
          
          // Update the request status
          db.query(`
            UPDATE ct_organization_requests 
            SET status = 'approved', reviewed_at = NOW(), reviewed_by = $1,
                organization_id = $2, setup_token = $3, setup_token_expires_at = $4
            WHERE id = $5
          `, [req.session.masterAdminId, organizationId, setupToken, tokenExpires, id], (updateErr) => {
            if (updateErr) {
              console.error('Error updating request:', updateErr);
              return res.status(500).json({ success: false, error: 'Failed to update request' });
            }
            
            // Log activity
            db.query(`
              INSERT INTO CT_master_admin_activity (
                master_admin_id, action, resource_type, resource_id, details, ip_address
              ) VALUES ($1, $2, $3, $4, $5, $6)
            `, [
              req.session.masterAdminId,
              'approve_org_request',
              'organization_request',
              id,
              JSON.stringify({ organizationId, subdomain, planType }),
              req.ip
            ], (logErr) => {
              if (logErr) console.error('Error logging activity:', logErr);
            });
            
            // Return success with setup information
            res.json({ 
              success: true, 
              organization_id: organizationId,
              setup_token: setupToken,
              setup_url: `${req.protocol}://${req.get('host')}/setup/${setupToken}`,
              message: 'Organization created successfully. Setup email can now be sent.'
            });
          });
        });
      });
    });
  } catch (error) {
    console.error('Error in approval process:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Deny organization request
router.post('/organization-requests/:id/deny', requireMasterAuth, (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  
  db.query(`
    UPDATE ct_organization_requests 
    SET status = 'denied', reviewed_at = NOW(), reviewed_by = $1, review_notes = $2
    WHERE id = $3
  `, [req.session.masterAdminId, reason || 'Request denied', id], (err, result) => {
    if (err) {
      console.error('Error denying request:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }
    
    // Log activity
    db.query(`
      INSERT INTO CT_master_admin_activity (
        master_admin_id, action, resource_type, resource_id, details, ip_address
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      req.session.masterAdminId,
      'deny_org_request',
      'organization_request',
      id,
      JSON.stringify({ reason }),
      req.ip
    ], (logErr) => {
      if (logErr) console.error('Error logging activity:', logErr);
    });
    
    res.json({ success: true });
  });
});

module.exports = router;
