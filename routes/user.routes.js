const express = require('express');
const { db } = require('../config/database');

const router = express.Router();

// User Authentication Middleware (same as in auth.routes.js)
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/constants');

const authenticateUser = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '') || req.cookies?.authToken;
  
  if (!token) {
    return res.status(401).json({ success: false, error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Invalid token.' });
  }
};

// Link a bracelet to the current user's account
router.post('/link-bracelet', authenticateUser, (req, res) => {
  try {
    const { bracelet_uid, is_primary, nickname } = req.body;
    const userId = req.user.id;

    if (!bracelet_uid) {
      return res.status(400).json({ success: false, error: 'Bracelet UID is required' });
    }

    // First, verify the bracelet exists
    db.query(`
      SELECT id, custom_id, organization_id FROM ct_nfc_tags 
      WHERE custom_id = $1
    `, [bracelet_uid], (err, braceletResult) => {
      if (err) {
        console.error('Error looking up bracelet:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }

      if (braceletResult.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Bracelet not found' });
      }

      // Check if this bracelet is already linked to this user
      db.query(`
        SELECT id FROM ct_user_bracelets 
        WHERE user_id = $1 AND bracelet_uid = $2
      `, [userId, bracelet_uid], (linkErr, linkResult) => {
        if (linkErr) {
          console.error('Error checking existing link:', linkErr);
          return res.status(500).json({ success: false, error: 'Database error' });
        }

        if (linkResult.rows.length > 0) {
          return res.status(400).json({ success: false, error: 'Bracelet already linked to your account' });
        }

        // If setting as primary, clear any existing primary bracelets for this user
        if (is_primary) {
          db.query(`
            UPDATE ct_user_bracelets 
            SET is_primary = FALSE 
            WHERE user_id = $1 AND is_primary = TRUE
          `, [userId], (updateErr) => {
            if (updateErr) {
              console.error('Error updating primary bracelets:', updateErr);
              return res.status(500).json({ success: false, error: 'Database error' });
            }

            // Now link the bracelet
            linkBracelet(userId, bracelet_uid, is_primary, nickname, res);
          });
        } else {
          // Link the bracelet without primary changes
          linkBracelet(userId, bracelet_uid, is_primary, nickname, res);
        }
      });
    });
  } catch (error) {
    console.error('Error in link-bracelet:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Helper function to link bracelet
function linkBracelet(userId, braceletUid, isPrimary, nickname, res) {
  db.query(`
    INSERT INTO ct_user_bracelets (user_id, bracelet_uid, is_primary, nickname)
    VALUES ($1, $2, $3, $4)
    RETURNING id
  `, [userId, braceletUid, isPrimary || false, nickname || null], (err, result) => {
    if (err) {
      console.error('Error linking bracelet:', err);
      return res.status(500).json({ success: false, error: 'Failed to link bracelet' });
    }

    console.log(`✅ Bracelet ${braceletUid} linked to user ${userId}`);
    res.json({ 
      success: true, 
      message: 'Bracelet linked successfully',
      link_id: result.rows[0].id
    });
  });
}

// Get user's linked bracelets
router.get('/bracelets', authenticateUser, (req, res) => {
  try {
    const userId = req.user.id;

    db.query(`
      SELECT 
        ub.id,
        ub.bracelet_uid,
        ub.is_primary,
        ub.nickname,
        ub.registered_at,
        nt.organization_id,
        nt.status as bracelet_status,
        nt.last_scanned_at,
        nt.scan_count,
        o.name as organization_name,
        o.subdomain as organization_subdomain
      FROM ct_user_bracelets ub
      LEFT JOIN ct_nfc_tags nt ON ub.bracelet_uid = nt.custom_id
      LEFT JOIN CT_organizations o ON nt.organization_id = o.id
      WHERE ub.user_id = $1
      ORDER BY ub.is_primary DESC, ub.registered_at DESC
    `, [userId], (err, result) => {
      if (err) {
        console.error('Error fetching user bracelets:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }

      res.json({
        success: true,
        bracelets: result.rows
      });
    });
  } catch (error) {
    console.error('Error in get bracelets:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Check if a bracelet is linked to the current user
router.get('/bracelet/:uid/linked', authenticateUser, (req, res) => {
  try {
    const { uid } = req.params;
    const userId = req.user.id;

    db.query(`
      SELECT id, is_primary, nickname FROM ct_user_bracelets 
      WHERE user_id = $1 AND bracelet_uid = $2
    `, [userId, uid], (err, result) => {
      if (err) {
        console.error('Error checking bracelet link:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }

      res.json({
        success: true,
        linked: result.rows.length > 0,
        link_info: result.rows[0] || null
      });
    });
  } catch (error) {
    console.error('Error in bracelet linked check:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Unlink a bracelet from the user's account
router.delete('/bracelet/:uid/unlink', authenticateUser, (req, res) => {
  try {
    const { uid } = req.params;
    const userId = req.user.id;

    db.query(`
      DELETE FROM ct_user_bracelets 
      WHERE user_id = $1 AND bracelet_uid = $2
      RETURNING id
    `, [userId, uid], (err, result) => {
      if (err) {
        console.error('Error unlinking bracelet:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }

      if (result.rowCount === 0) {
        return res.status(404).json({ success: false, error: 'Bracelet link not found' });
      }

      console.log(`🔓 Bracelet ${uid} unlinked from user ${userId}`);
      res.json({
        success: true,
        message: 'Bracelet unlinked successfully'
      });
    });
  } catch (error) {
    console.error('Error in unlink bracelet:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Update bracelet settings (nickname, primary status)
router.put('/bracelet/:uid', authenticateUser, (req, res) => {
  try {
    const { uid } = req.params;
    const { nickname, is_primary } = req.body;
    const userId = req.user.id;

    // If setting as primary, clear other primary bracelets first
    if (is_primary) {
      db.query(`
        UPDATE ct_user_bracelets 
        SET is_primary = FALSE 
        WHERE user_id = $1 AND is_primary = TRUE AND bracelet_uid != $2
      `, [userId, uid], (updateErr) => {
        if (updateErr) {
          console.error('Error updating other primary bracelets:', updateErr);
          return res.status(500).json({ success: false, error: 'Database error' });
        }

        // Now update this bracelet
        updateBraceletSettings(userId, uid, nickname, is_primary, res);
      });
    } else {
      // Update without primary changes
      updateBraceletSettings(userId, uid, nickname, is_primary, res);
    }
  } catch (error) {
    console.error('Error in update bracelet:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Helper function to update bracelet settings
function updateBraceletSettings(userId, uid, nickname, isPrimary, res) {
  db.query(`
    UPDATE ct_user_bracelets 
    SET nickname = $1, is_primary = $2, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = $3 AND bracelet_uid = $4
    RETURNING id
  `, [nickname || null, isPrimary || false, userId, uid], (err, result) => {
    if (err) {
      console.error('Error updating bracelet settings:', err);
      return res.status(500).json({ success: false, error: 'Failed to update bracelet' });
    }

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Bracelet link not found' });
    }

    res.json({
      success: true,
      message: 'Bracelet settings updated successfully'
    });
  });
}

module.exports = router;
