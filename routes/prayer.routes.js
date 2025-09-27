const express = require('express');
const { dbQuery, db } = require('../config/database');
const { validateInput } = require('../middleware/validation');

const router = express.Router();

// Submit prayer request
router.post('/', validateInput.communityContent, validateInput.sanitizeHtml, (req, res) => {
  const { content, user_token, date } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  const today = date || new Date().toISOString().split('T')[0];
  const orgId = req.organizationId || 1;
  
  // Get session attribution from cookies
  const taggedSessionId = req.cookies?.taggedSession;
  const originatingTagId = req.cookies?.originatingTag;
  
  console.log(`Prayer request - org: ${req.query.org}, orgId: ${orgId}, taggedSession: ${taggedSessionId}, originatingTag: ${originatingTagId}`);
  
  if (!content || content.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Prayer request content is required' });
  }
  
  if (content.length > 500) {
    return res.status(400).json({ success: false, error: 'Prayer request too long (max 500 characters)' });
  }
  
  dbQuery.run(`INSERT INTO ct_prayer_requests 
    (date, content, user_token, ip_address, organization_id, is_approved, tagged_session_id, originating_tag_id) 
    VALUES (?, ?, ?, ?, ?, TRUE, ?, ?)`,
    [today, content.trim(), user_token, ip, orgId, taggedSessionId, originatingTagId], function(err) {
      if (err) {
        console.error('Error submitting prayer request:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      // Update session activity timestamp if we have a tagged session
      if (taggedSessionId) {
        dbQuery.run(`UPDATE anonymous_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE tagged_session_id = ?`, [taggedSessionId]);
        console.log(`🙏 Prayer request linked to tag session: ${originatingTagId}`);
      }
      
      res.json({ success: true, prayer_request_id: this.lastID });
    });
});

// Pray for prayer request
router.post('/pray', (req, res) => {
  const { prayer_request_id, user_token } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  
  // Get session attribution from cookies
  const taggedSessionId = req.cookies?.taggedSession;
  const originatingTagId = req.cookies?.originatingTag;
  
  console.log(`Prayer interaction - prayerRequestId: ${prayer_request_id}, taggedSession: ${taggedSessionId}, originatingTag: ${originatingTagId}`);
  
  if (!prayer_request_id || !user_token) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }
  
  // Check if user already prayed for this request
  dbQuery.get(`SELECT id FROM ct_prayer_interactions WHERE prayer_request_id = $1 AND user_token = $2`,
    [prayer_request_id, user_token], (err, row) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      if (row) {
        return res.status(400).json({ success: false, error: 'You already prayed for this request' });
      }
      
      // Add prayer interaction with session attribution
      dbQuery.run(`INSERT INTO ct_prayer_interactions 
        (prayer_request_id, user_token, ip_address, tagged_session_id, originating_tag_id) 
        VALUES (?, ?, ?, ?, ?)`,
        [prayer_request_id, user_token, ip, taggedSessionId, originatingTagId], function(err) {
          if (err) {
            return res.status(500).json({ success: false, error: 'Database error' });
          }
          
          // Update session activity timestamp if we have a tagged session
          if (taggedSessionId) {
            dbQuery.run(`UPDATE anonymous_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE tagged_session_id = ?`, [taggedSessionId]);
            console.log(`🙏 Prayer interaction linked to tag session: ${originatingTagId}`);
          }
          
          // Update prayer count
          dbQuery.run(`UPDATE ct_prayer_requests SET prayer_count = prayer_count + 1 WHERE id = $1`,
            [prayer_request_id], (err) => {
              if (err) {
                return res.status(500).json({ success: false, error: 'Database error' });
              }
              
              // Get updated count
              dbQuery.get(`SELECT prayer_count FROM ct_prayer_requests WHERE id = $1`, 
                [prayer_request_id], (err, row) => {
                  if (err) {
                    return res.status(500).json({ success: false, error: 'Database error' });
                  }
                  
                  res.json({ success: true, prayer_count: row ? row.prayer_count : 0 });
                });
            });
        });
    });
});

module.exports = router;