const express = require('express');
const { dbQuery, db } = require('../config/database');
const { validateInput } = require('../middleware/validation');

const router = express.Router();

// Submit praise report
router.post('/', validateInput.communityContent, validateInput.sanitizeHtml, (req, res) => {
  const { content, user_token, date } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  const today = date || new Date().toISOString().split('T')[0];
  const orgId = req.organizationId || 1;
  
  // Get session attribution from cookies
  const taggedSessionId = req.cookies?.taggedSession;
  const originatingTagId = req.cookies?.originatingTag;
  
  console.log(`Praise report - org: ${req.query.org}, orgId: ${orgId}, taggedSession: ${taggedSessionId}, originatingTag: ${originatingTagId}`);
  
  if (!content || content.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Praise report content is required' });
  }
  
  if (content.length > 500) {
    return res.status(400).json({ success: false, error: 'Praise report too long (max 500 characters)' });
  }
  
  dbQuery.run(`INSERT INTO ct_praise_reports 
    (date, content, user_token, ip_address, organization_id, is_approved, tagged_session_id, originating_tag_id) 
    VALUES (?, ?, ?, ?, ?, TRUE, ?, ?)`,
    [today, content.trim(), user_token, ip, orgId, taggedSessionId, originatingTagId], function(err) {
      if (err) {
        console.error('Error submitting praise report:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      // Update session activity timestamp if we have a tagged session
      if (taggedSessionId) {
        dbQuery.run(`UPDATE anonymous_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE tagged_session_id = ?`, [taggedSessionId]);
        console.log(`🎉 Praise report linked to tag session: ${originatingTagId}`);
      }
      
      res.json({ success: true, praise_report_id: this.lastID });
    });
});

// Celebrate praise report
router.post('/celebrate', (req, res) => {
  const { praise_report_id, user_token } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  
  // Get session attribution from cookies
  const taggedSessionId = req.cookies?.taggedSession;
  const originatingTagId = req.cookies?.originatingTag;
  
  console.log(`Celebration interaction - praiseReportId: ${praise_report_id}, taggedSession: ${taggedSessionId}, originatingTag: ${originatingTagId}`);
  
  if (!praise_report_id || !user_token) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }
  
  // Check if user already celebrated this report
  dbQuery.get(`SELECT id FROM ct_celebration_interactions WHERE praise_report_id = $1 AND user_token = $2`,
    [praise_report_id, user_token], (err, row) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      if (row) {
        return res.status(400).json({ success: false, error: 'You already celebrated this report' });
      }
      
      // Add celebration interaction with session attribution
      dbQuery.run(`INSERT INTO ct_celebration_interactions 
        (praise_report_id, user_token, ip_address, tagged_session_id, originating_tag_id) 
        VALUES (?, ?, ?, ?, ?)`,
        [praise_report_id, user_token, ip, taggedSessionId, originatingTagId], function(err) {
          if (err) {
            return res.status(500).json({ success: false, error: 'Database error' });
          }
          
          // Update session activity timestamp if we have a tagged session
          if (taggedSessionId) {
            dbQuery.run(`UPDATE anonymous_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE tagged_session_id = ?`, [taggedSessionId]);
            console.log(`🎉 Celebration interaction linked to tag session: ${originatingTagId}`);
          }
          
          // Update celebration count
          dbQuery.run(`UPDATE ct_praise_reports SET celebration_count = celebration_count + 1 WHERE id = $1`,
            [praise_report_id], (err) => {
              if (err) {
                return res.status(500).json({ success: false, error: 'Database error' });
              }
              
              // Get updated count
              dbQuery.get(`SELECT celebration_count FROM ct_praise_reports WHERE id = $1`, 
                [praise_report_id], (err, row) => {
                  if (err) {
                    return res.status(500).json({ success: false, error: 'Database error' });
                  }
                  
                  res.json({ success: true, celebration_count: row ? row.celebration_count : 0 });
                });
            });
        });
    });
});

module.exports = router;