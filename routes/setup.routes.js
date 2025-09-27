const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const { db, dbQuery } = require('../config/database');

const router = express.Router();

// Serve setup page
router.get('/:token', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'setup.html'));
});

// Validate setup token
router.get('/validate/:token', async (req, res) => {
  const { token } = req.params;

  try {
    db.query(`
      SELECT r.*, o.name as org_name
      FROM ct_organization_requests r
      LEFT JOIN ct_organizations o ON r.organization_id = o.id
      WHERE r.setup_token = $1
        AND r.status = 'approved'
        AND r.setup_token_expires_at > NOW()
        AND r.admin_account_created = FALSE
    `, [token], (err, result) => {
      if (err) {
        console.error('Error validating setup token:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Invalid or expired setup token' });
      }

      const request = result.rows[0];
      res.json({
        success: true,
        organization: {
          id: request.organization_id,
          org_name: request.org_name || request.org_name,
          contact_email: request.contact_email,
          first_name: request.first_name,
          last_name: request.last_name
        }
      });
    });
  } catch (error) {
    console.error('Error in token validation:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Complete organization setup
router.post('/complete', async (req, res) => {
  const { username, email, password, setup_token } = req.body;

  if (!username || !email || !password || !setup_token) {
    return res.status(400).json({
      success: false,
      error: 'Username, email, password, and setup token are required'
    });
  }

  try {
    // Validate setup token and get organization info
    db.query(`
      SELECT r.*, o.id as org_id, o.name as org_name
      FROM ct_organization_requests r
      LEFT JOIN ct_organizations o ON r.organization_id = o.id
      WHERE r.setup_token = $1
        AND r.status = 'approved'
        AND r.setup_token_expires_at > NOW()
        AND r.admin_account_created = FALSE
    `, [setup_token], async (err, result) => {
      if (err) {
        console.error('Error validating setup token:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Invalid or expired setup token'
        });
      }

      const request = result.rows[0];
      const organizationId = request.org_id;

      try {
        // Hash the password
        const passwordHash = await bcrypt.hash(password, 12);

        // Create the admin user
        db.query(`
          INSERT INTO ct_admin_users (
            organization_id, username, password_hash, email,
            first_name, last_name, role, is_active, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
          RETURNING id
        `, [
          organizationId,
          username,
          passwordHash,
          email,
          request.first_name,
          request.last_name,
          'admin',
          true
        ], (createErr, createResult) => {
          if (createErr) {
            console.error('Error creating admin user:', createErr);
            if (createErr.code === '23505') { // Unique constraint violation
              return res.status(400).json({
                success: false,
                error: 'Username already exists. Please choose a different username.'
              });
            }
            return res.status(500).json({
              success: false,
              error: 'Failed to create admin account'
            });
          }

          const adminId = createResult.rows[0].id;

          // Mark the setup as completed
          db.query(`
            UPDATE ct_organization_requests
            SET admin_account_created = TRUE, updated_at = NOW()
            WHERE setup_token = $1
          `, [setup_token], (updateErr) => {
            if (updateErr) {
              console.error('Error updating request status:', updateErr);
              // Don't fail the request since the admin was created successfully
            }

            console.log(`✅ Admin account created for organization ${organizationId}: ${username}`);

            res.json({
              success: true,
              message: 'Admin account created successfully',
              admin_id: adminId,
              organization_id: organizationId
            });
          });
        });

      } catch (hashErr) {
        console.error('Error hashing password:', hashErr);
        return res.status(500).json({
          success: false,
          error: 'Failed to process password'
        });
      }
    });

  } catch (error) {
    console.error('Error in setup completion:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Create default admin user (for setup)
router.post('/admin', async (req, res) => {
  const { username = 'admin', password = 'admin123', email = 'admin@localhost' } = req.body;
  
  // Check if any admin users exist
  dbQuery.get(`SELECT COUNT(*) as count FROM ct_admin_users`, [], async (err, result) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    if (result.count > 0) {
      return res.status(400).json({ success: false, error: 'Admin users already exist' });
    }
    
    try {
      const passwordHash = await bcrypt.hash(password, 12);
      dbQuery.run(
        `INSERT INTO ct_admin_users (username, password_hash, email, role, organization_id, is_active) VALUES ($1, $2, $3, $4, $5, $6)`,
        [username, passwordHash, email, 'admin', 1, true],
        function(insertErr) {
          if (insertErr) {
            console.error('Admin creation error:', insertErr);
            return res.status(500).json({ success: false, error: 'Failed to create admin user' });
          }
          res.json({ success: true, message: 'Default admin user created', username, password });
        }
      );
    } catch (hashErr) {
      return res.status(500).json({ success: false, error: 'Failed to process password' });
    }
  });
});

module.exports = router;

