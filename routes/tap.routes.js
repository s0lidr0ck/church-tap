const express = require('express');
const path = require('path');
const fs = require('fs');
const { db } = require('../config/database');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/constants');

const router = express.Router();

// Helper function to serve HTML with injected tap/org context
function serveHtmlWithTapContext(res, orgData, tagUid) {
  const htmlPath = path.join(__dirname, '../public', 'index.html');

  fs.readFile(htmlPath, 'utf8', (err, html) => {
    if (err) {
      console.error('Error reading HTML file:', err);
      return res.status(500).send('Internal server error');
    }

    const ctx = {
      orgParam: orgData?.subdomain || null,
      tagIdParam: tagUid || null,
      organization: orgData
        ? {
            id: orgData.id,
            name: orgData.name,
            subdomain: orgData.subdomain
          }
        : null
    };

    // Inject context script before closing head tag.
    // Escape "<" to avoid accidental HTML/script injection via JSON serialization.
    const serialized = JSON.stringify(ctx).replace(/</g, '\\u003c');
    const injected = `\n<script>window.nfcOrgContext=${serialized};</script>\n</head>`;
    const modifiedHtml = html.replace('</head>', injected);
    res.send(modifiedHtml);
  });
}

// Handle NFC bracelet tap: /t/<UID>
router.get('/t/:uid', async (req, res) => {
  const { uid } = req.params;
  
  console.log(`🏷️ Bracelet tap detected: ${uid}`);
  
  try {
    // Always set session tracking cookies for analytics
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const taggedSessionId = `tagged_${uid}_${Date.now()}`;

    const cookieOptions = {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      httpOnly: false, // allow frontend access for analytics attribution
      sameSite: 'lax',
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
      path: '/'
    };

    res.cookie('trackingSession', sessionId, cookieOptions);
    res.cookie('originatingTag', uid, cookieOptions);
    res.cookie('taggedSession', taggedSessionId, cookieOptions);

    // Pending bracelet link cookie (server-only): allows auto-link immediately after login on this device/session
    res.cookie('pendingBraceletUid', uid, {
      maxAge: 10 * 60 * 1000, // 10 minutes
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
      path: '/'
    });

    // If user is already logged in on this device, we can link immediately on tap.
    let currentUserId = null;
    const existingAuthToken = req.cookies?.authToken;
    if (existingAuthToken) {
      try {
        const decoded = jwt.verify(existingAuthToken, JWT_SECRET);
        currentUserId = decoded.userId ?? decoded.id ?? null;
      } catch (e) {
        currentUserId = null;
      }
    }

    // If bracelet is already linked to a user, auto-login that user
    db.query(
      `SELECT user_id FROM ct_user_bracelets WHERE bracelet_uid = $1`,
      [uid],
      (linkErr, linkResult) => {
        if (linkErr) {
          console.error('Error looking up user bracelet link:', linkErr);
          // Still allow app access
          return res.sendFile(path.join(__dirname, '../public', 'index.html'));
        }

        const linkedUserId = linkResult.rows[0]?.user_id;
        if (linkedUserId) {
          const token = jwt.sign(
            { userId: linkedUserId },
            JWT_SECRET,
            { expiresIn: '30d' }
          );

          res.cookie('authToken', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
          });

          // Clear pending link cookie when we successfully auto-login
          res.clearCookie('pendingBraceletUid');

          console.log(`🔐 Auto-login via bracelet ${uid} for user ${linkedUserId}`);
        } else {
          if (currentUserId) {
            // Link immediately for logged-in users (tap on this device)
            db.query(
              `INSERT INTO ct_user_bracelets (user_id, bracelet_uid, is_primary, nickname)
               VALUES ($1, $2, FALSE, NULL)
               ON CONFLICT (bracelet_uid) DO NOTHING`,
              [currentUserId, uid],
              (insertErr) => {
                if (insertErr) {
                  console.error('Error linking bracelet on tap:', insertErr);
                } else {
                  console.log(`🔗 Bracelet ${uid} linked to logged-in user ${currentUserId} on tap`);
                  res.clearCookie('pendingBraceletUid');
                }
              }
            );
          } else {
            console.log(`🆕 Bracelet ${uid} not linked to a user yet (pending link set)`);
          }
        }

        // Resolve org context from tag assignment (if any), then serve app shell with injected context.
        db.query(
          `SELECT o.id, o.name, o.subdomain
           FROM ct_nfc_tags nt
           JOIN ct_organizations o ON nt.organization_id = o.id
           WHERE nt.custom_id = $1
           LIMIT 1`,
          [uid],
          (orgErr, orgResult) => {
            if (orgErr) {
              console.error('Error resolving organization for tap:', orgErr);
              return serveHtmlWithTapContext(res, null, uid);
            }
            const orgData = orgResult.rows[0] || null;
            return serveHtmlWithTapContext(res, orgData, uid);
          }
        );
      }
    );
  } catch (error) {
    console.error('Unexpected error in tap handler:', error);
    return res.status(500).send('Internal server error');
  }
});

// Organization chooser page
router.get('/choose-organization', (req, res) => {
  // Serve the choose organization interface
  res.sendFile(require('path').join(__dirname, '../public', 'choose-organization.html'));
});

// Request new organization page
router.get('/request-organization', (req, res) => {
  const { uid } = req.query;
  
  if (!uid) {
    return res.redirect('/?error=missing_uid');
  }
  
  // Serve the request organization form
  res.sendFile(require('path').join(__dirname, '../public', 'request-organization.html'));
});

// API endpoint to get organizations for chooser
router.get('/api/organizations/search', async (req, res) => {
  try {
    const { q, lat, lng, radius, type } = req.query;
    
    let sql = `
      SELECT id, name, subdomain, org_type, city, state, latitude, longitude, join_type,
             CASE 
               WHEN latitude IS NOT NULL AND longitude IS NOT NULL AND $1::decimal IS NOT NULL AND $2::decimal IS NOT NULL
               THEN (
                 3959 * acos(
                   cos(radians($1)) * cos(radians(latitude)) *
                   cos(radians(longitude) - radians($2)) +
                   sin(radians($1)) * sin(radians(latitude))
                 )
               )
               ELSE NULL
             END as distance_miles
      FROM CT_organizations 
      WHERE is_active = TRUE
    `;
    
    const params = [];
    let paramIndex = 0;
    
    // Add latitude and longitude parameters for distance calculation
    params.push(lat ? parseFloat(lat) : null);
    params.push(lng ? parseFloat(lng) : null);
    paramIndex = 2;
    
    // Add search filter
    if (q && q.trim()) {
      sql += ` AND (name ILIKE $${++paramIndex} OR city ILIKE $${paramIndex} OR state ILIKE $${paramIndex})`;
      const searchTerm = `%${q.trim()}%`;
      params.push(searchTerm);
    }
    
    // Add type filter
    if (type && ['church', 'ministry', 'small_group', 'bible_study'].includes(type)) {
      sql += ` AND org_type = $${++paramIndex}`;
      params.push(type);
    }
    
    // Add radius filter for location-based search
    if (lat && lng && radius) {
      sql += ` AND latitude IS NOT NULL AND longitude IS NOT NULL`;
    }
    
    // Order by distance if location provided, otherwise by name
    if (lat && lng) {
      sql += ` ORDER BY distance_miles ASC NULLS LAST, name ASC`;
      
      // Apply radius filter in HAVING clause if specified
      if (radius) {
        sql = sql.replace('ORDER BY', `HAVING distance_miles <= ${parseFloat(radius)} ORDER BY`);
      }
    } else {
      sql += ` ORDER BY name ASC`;
    }
    
    sql += ` LIMIT 50`; // Reasonable limit
    
    db.query(sql, params, (err, result) => {
      if (err) {
        console.error('Error searching organizations:', err);
        return res.status(500).json({ success: false, error: 'Search failed' });
      }
      
      const organizations = result.rows.map(org => ({
        id: org.id,
        name: org.name,
        subdomain: org.subdomain,
        type: org.org_type,
        location: org.city && org.state ? `${org.city}, ${org.state}` : null,
        joinType: org.join_type,
        distance: org.distance_miles ? Math.round(org.distance_miles * 10) / 10 : null
      }));
      
      res.json({ success: true, organizations });
    });
  } catch (error) {
    console.error('Error in organization search:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// API endpoint to claim bracelet to organization
router.post('/api/bracelet/claim', async (req, res) => {
  // Deprecated: org membership is now account-driven via /api/memberships/join.
  return res.status(410).json({
    success: false,
    error: 'Deprecated. Join groups from your account instead of claiming bracelets to organizations.',
    code: 'ENDPOINT_DEPRECATED'
  });
});

// Subdomain validation function
function validateSubdomain(subdomain) {
  if (!subdomain || typeof subdomain !== 'string') return false;
  
  // URL-safe characters only: lowercase letters, numbers, hyphens
  const validPattern = /^[a-z0-9-]+$/;
  
  // Reserved subdomains to block
  const RESERVED_SUBDOMAINS = [
    'www', 'api', 'admin', 'master', 'app', 'mail', 'ftp', 
    'blog', 'support', 'help', 'docs', 'cdn', 'static',
    'assets', 'images', 'js', 'css', 'public', 'private',
    'test', 'staging', 'dev', 'demo'
  ];
  
  // Validation rules
  const rules = [
    subdomain.length >= 3,                           // Minimum length
    subdomain.length <= 63,                          // Maximum length  
    validPattern.test(subdomain),                    // Only valid chars
    !subdomain.startsWith('-'),                      // Can't start with hyphen
    !subdomain.endsWith('-'),                        // Can't end with hyphen
    !subdomain.includes('--'),                       // No consecutive hyphens
    !RESERVED_SUBDOMAINS.includes(subdomain.toLowerCase()) // Not reserved
  ];
  
  return rules.every(rule => rule);
}

// API endpoint to check subdomain availability
router.get('/api/subdomain/check/:subdomain', async (req, res) => {
  try {
    const { subdomain } = req.params;
    
    // Validate format
    if (!validateSubdomain(subdomain)) {
      return res.json({ 
        available: false, 
        reason: 'Invalid format. Use only letters, numbers, and hyphens (3-63 characters).' 
      });
    }
    
    // Check if already taken
    db.query(`
      SELECT id FROM ct_organizations WHERE subdomain = $1
      UNION
      SELECT id FROM ct_organization_requests WHERE requested_subdomain = $1 AND status = 'pending'
    `, [subdomain.toLowerCase()], (err, result) => {
      if (err) {
        console.error('Error checking subdomain availability:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      const available = result.rows.length === 0;
      
      res.json({ 
        available,
        reason: available ? 'Available' : 'This subdomain is already taken or requested.'
      });
    });
  } catch (error) {
    console.error('Error in subdomain check:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// API endpoint to submit organization request
router.post('/api/organization-request', async (req, res) => {
  try {
    const {
      org_name,
      org_type,
      description,
      address,
      city,
      state,
      zip_code,
      contact_name,
      contact_email,
      contact_phone,
      contact_title,
      requested_subdomain
    } = req.body;
    
    // Validate required fields
    const required = [
      'org_name', 'org_type', 'address', 'city', 'state',
      'contact_name', 'contact_email', 'requested_subdomain'
    ];
    
    for (const field of required) {
      if (!req.body[field] || req.body[field].trim() === '') {
        return res.status(400).json({ 
          success: false, 
          error: `${field.replace('_', ' ')} is required` 
        });
      }
    }
    
    // Validate organization type
    const validTypes = ['church', 'ministry', 'small_group', 'bible_study'];
    if (!validTypes.includes(org_type)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid organization type' 
      });
    }
    
    // Validate subdomain
    if (!validateSubdomain(requested_subdomain)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid subdomain format' 
      });
    }
    
    // Check subdomain availability one more time
    db.query(`
      SELECT id FROM ct_organizations WHERE subdomain = $1
      UNION
      SELECT id FROM ct_organization_requests WHERE requested_subdomain = $1 AND status IN ('pending', 'under_review')
    `, [requested_subdomain.toLowerCase()], (err, existingResult) => {
      if (err) {
        console.error('Error checking subdomain:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      if (existingResult.rows.length > 0) {
        return res.status(400).json({ 
          success: false, 
          error: 'Subdomain is already taken or requested' 
        });
      }
      
      // TODO: Add geocoding for lat/lng if we have an API
      // For now, we'll leave lat/lng as null and add them later via admin interface
      
      // Insert the request
      db.query(`
        INSERT INTO ct_organization_requests (
          org_name, org_type, description, address, city, state, zip_code,
          contact_name, contact_email, contact_phone, contact_title, requested_subdomain
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id
      `, [
        org_name.trim(),
        org_type,
        description ? description.trim() : null,
        address.trim(),
        city.trim(),
        state.trim(),
        zip_code ? zip_code.trim() : null,
        contact_name.trim(),
        contact_email.toLowerCase().trim(),
        contact_phone ? contact_phone.trim() : null,
        contact_title ? contact_title.trim() : null,
        requested_subdomain.toLowerCase().trim()
      ], (insertErr, insertResult) => {
        if (insertErr) {
          console.error('Error creating organization request:', insertErr);
          return res.status(500).json({ success: false, error: 'Failed to submit request' });
        }
        
        console.log(`✅ Organization request submitted: ${org_name} (${requested_subdomain})`);
        
        res.json({ 
          success: true, 
          request_id: insertResult.rows[0].id,
          message: 'Your organization request has been submitted for review. You will receive an email when it is approved.'
        });
      });
    });
  } catch (error) {
    console.error('Error in organization request submission:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// API endpoint to get bracelet information for profile
router.get('/api/bracelet/info/:uid', async (req, res) => {
  try {
    const { uid } = req.params;
    
    // Look up the bracelet and organization information
    db.query(`
      SELECT 
        nt.id, nt.custom_id, nt.status, nt.last_scanned_at, nt.scan_count, nt.assigned_at,
        o.id as org_id, o.name as org_name, o.subdomain, o.org_type, o.join_type
      FROM ct_nfc_tags nt
      LEFT JOIN CT_organizations o ON nt.organization_id = o.id
      WHERE nt.custom_id = $1
    `, [uid], (err, result) => {
      if (err) {
        console.error('Error fetching bracelet info:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      if (result.rows.length === 0) {
        return res.json({ success: false, error: 'Bracelet not found' });
      }
      
      const bracelet = result.rows[0];
      
      // Format the response
      const response = {
        success: true,
        bracelet: {
          id: bracelet.id,
          custom_id: bracelet.custom_id,
          status: bracelet.status,
          last_scanned_at: bracelet.last_scanned_at,
          scan_count: bracelet.scan_count,
          assigned_at: bracelet.assigned_at,
          organization: bracelet.org_id ? {
            id: bracelet.org_id,
            name: bracelet.org_name,
            subdomain: bracelet.subdomain,
            org_type: bracelet.org_type,
            join_type: bracelet.join_type
          } : null
        }
      };
      
      res.json(response);
    });
  } catch (error) {
    console.error('Error in bracelet info endpoint:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Helper function to handle organization assignment
function proceedWithClaim(bracelet, organization_id, uid, res) {
  // Get organization details
  db.query(`
    SELECT id, name, subdomain, custom_domain, join_type 
    FROM CT_organizations 
    WHERE id = $1 AND is_active = TRUE
  `, [organization_id], (orgErr, orgResult) => {
    if (orgErr) {
      console.error('Error looking up organization:', orgErr);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    if (orgResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Organization not found' });
    }
    
    const organization = orgResult.rows[0];
    
    if (organization.join_type === 'open') {
      // Immediate claim for open organizations
      db.query(`
        UPDATE ct_nfc_tags 
        SET organization_id = $1, assigned_at = NOW(), status = 'assigned'
        WHERE custom_id = $2
      `, [organization_id, uid], (updateErr) => {
        if (updateErr) {
          console.error('Error claiming bracelet:', updateErr);
          return res.status(500).json({ success: false, error: 'Failed to claim bracelet' });
        }
        
        console.log(`✅ Bracelet ${uid} claimed to ${organization.name}`);
        
        // Use legacy format: https://churchtap.app/?org=subdomain&tag_id=uid
        // For development, stay on the same host
        const protocol = req.secure ? 'https' : 'http';
        const host = req.get('host');
        let redirectUrl;
        
        if (host.includes('localhost') || host.includes('127.0.0.1')) {
          // Development environment - stay on localhost
          redirectUrl = `${protocol}://${host}/?org=${organization.subdomain}&tag_id=${uid}`;
        } else {
          // Production environment
          redirectUrl = `https://churchtap.app/?org=${organization.subdomain}&tag_id=${uid}`;
        }
        
        res.json({ 
          success: true, 
          status: 'claimed',
          redirect_url: redirectUrl
        });
      });
    } else if (organization.join_type === 'approval_required') {
      // Create pending membership request
      db.query(`
        INSERT INTO ct_bracelet_memberships (bracelet_uid, organization_id, status)
        VALUES ($1, $2, 'pending')
        ON CONFLICT DO NOTHING
      `, [uid, organization_id], (membershipErr) => {
        if (membershipErr) {
          console.error('Error creating membership request:', membershipErr);
          return res.status(500).json({ success: false, error: 'Failed to create membership request' });
        }
        
        // Still assign the bracelet so future taps work, but mark status as pending
        db.query(`
          UPDATE ct_nfc_tags 
          SET organization_id = $1, assigned_at = NOW(), status = 'pending'
          WHERE custom_id = $2
        `, [organization_id, uid], (updateErr) => {
          if (updateErr) {
            console.error('Error updating bracelet status:', updateErr);
            return res.status(500).json({ success: false, error: 'Failed to update bracelet' });
          }
          
          console.log(`⏳ Bracelet ${uid} pending approval for ${organization.name}`);
          
          // Use legacy format: https://churchtap.app/?org=subdomain&status=pending_approval&tag_id=uid
          // For development, stay on the same host
          const protocol = req.secure ? 'https' : 'http';
          const host = req.get('host');
          let redirectUrl;
          
          if (host.includes('localhost') || host.includes('127.0.0.1')) {
            // Development environment - stay on localhost
            redirectUrl = `${protocol}://${host}/?org=${organization.subdomain}&status=pending_approval&tag_id=${uid}`;
          } else {
            // Production environment
            redirectUrl = `https://churchtap.app/?org=${organization.subdomain}&status=pending_approval&tag_id=${uid}`;
          }
          
          res.json({ 
            success: true, 
            status: 'pending',
            message: 'Your request has been submitted for approval',
            redirect_url: redirectUrl
          });
        });
      });
    } else {
      return res.status(400).json({ success: false, error: 'Invalid organization join type' });
    }
  });
}

module.exports = router;
