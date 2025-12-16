const express = require('express');
const { dbQuery, db } = require('../config/database');
const { validateInput } = require('../middleware/validation');
const { authenticateUser } = require('../middleware/userAuth');
const { requireActiveGroupMembership } = require('../middleware/membershipGate');

const router = express.Router();

// Submit prayer request
router.post('/', authenticateUser, requireActiveGroupMembership, validateInput.communityContent, validateInput.sanitizeHtml, (req, res) => {
  const { content, date, is_anonymous } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  const today = date || new Date().toISOString().split('T')[0];
  const orgId = req.activeOrganizationId;
  const userId = req.user.userId;
  const userToken = `user_${userId}`;
  
  // Get session attribution from cookies
  const taggedSessionId = req.cookies?.taggedSession;
  const originatingTagId = req.cookies?.originatingTag;
  const sessionId = req.cookies?.trackingSession;

  console.log(`Prayer request - userId: ${userId}, orgId: ${orgId}, anonymous: ${!!is_anonymous}, taggedSession: ${taggedSessionId}, originatingTag: ${originatingTagId}`);
  
  if (!content || content.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Prayer request content is required' });
  }
  
  if (content.length > 500) {
    return res.status(400).json({ success: false, error: 'Prayer request too long (max 500 characters)' });
  }
  
  // Note: we keep user_token stable for anti-spam/uniqueness, even if the UI displays the post as anonymous.
  dbQuery.run(`INSERT INTO ct_prayer_requests
    (date, content, user_token, ip_address, organization_id, is_approved, tagged_session_id, originating_tag_id)
    VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7)`,
    [today, content.trim(), userToken, ip, orgId, taggedSessionId, originatingTagId], function(err) {
      if (err) {
        console.error('Error submitting prayer request:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      // Update session activity timestamp if we have a session
      if (sessionId) {
        db.query(`UPDATE anonymous_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE session_id = $1`, [sessionId], (err) => {
          if (err) console.error('Error updating session timestamp:', err);
        });
        console.log(`🙏 Prayer request linked to tag session: ${originatingTagId}`);
      }
      
      res.json({ success: true, prayer_request_id: this.lastID });
    });
});

// Pray for prayer request
router.post('/pray', authenticateUser, requireActiveGroupMembership, (req, res) => {
  const { prayer_request_id } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  const userId = req.user.userId;
  const userToken = `user_${userId}`;
  const orgId = req.activeOrganizationId;
  
  // Get session attribution from cookies
  const taggedSessionId = req.cookies?.taggedSession;
  const originatingTagId = req.cookies?.originatingTag;
  const sessionId = req.cookies?.trackingSession;
  
  console.log(`Prayer interaction - userId: ${userId}, orgId: ${orgId}, prayerRequestId: ${prayer_request_id}, taggedSession: ${taggedSessionId}, originatingTag: ${originatingTagId}`);
  
  if (!prayer_request_id) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }
  
  // Check if user already prayed for this request
  db.query(`SELECT id FROM ct_prayer_interactions WHERE prayer_request_id = $1 AND user_token = $2`,
    [prayer_request_id, userToken], (err, result) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }

      if (result.rows && result.rows.length > 0) {
        return res.status(400).json({ success: false, error: 'You already prayed for this request' });
      }
      
      // Add prayer interaction with session attribution
      dbQuery.run(`INSERT INTO ct_prayer_interactions
        (prayer_request_id, user_token, ip_address, tagged_session_id, originating_tag_id)
        VALUES ($1, $2, $3, $4, $5)`,
        [prayer_request_id, userToken, ip, taggedSessionId, originatingTagId], function(err) {
          if (err) {
            return res.status(500).json({ success: false, error: 'Database error' });
          }
          
          // Update session activity timestamp if we have a session
          if (sessionId) {
            db.query(`UPDATE anonymous_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE session_id = $1`, [sessionId], (err) => {
              if (err) console.error('Error updating session timestamp:', err);
            });
            console.log(`🙏 Prayer interaction linked to tag session: ${originatingTagId}`);
          }
          
          // Update prayer count
          dbQuery.run(`UPDATE ct_prayer_requests SET prayer_count = prayer_count + 1 WHERE id = $1`,
            [prayer_request_id], (err) => {
              if (err) {
                return res.status(500).json({ success: false, error: 'Database error' });
              }
              
              // Get updated count
              db.query(`SELECT prayer_count FROM ct_prayer_requests WHERE id = $1`,
                [prayer_request_id], (err, result) => {
                  if (err) {
                    return res.status(500).json({ success: false, error: 'Database error' });
                  }

                  res.json({ success: true, prayer_count: result.rows && result.rows.length > 0 ? result.rows[0].prayer_count : 0 });
                });
            });
        });
    });
});

module.exports = router;