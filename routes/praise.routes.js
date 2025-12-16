const express = require('express');
const { dbQuery, db } = require('../config/database');
const { validateInput } = require('../middleware/validation');
const { authenticateUser } = require('../middleware/userAuth');
const { requireActiveGroupMembership } = require('../middleware/membershipGate');

const router = express.Router();

// Submit praise report
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

  console.log(`Praise report - userId: ${userId}, orgId: ${orgId}, anonymous: ${!!is_anonymous}, taggedSession: ${taggedSessionId}, originatingTag: ${originatingTagId}`);
  
  if (!content || content.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Praise report content is required' });
  }
  
  if (content.length > 500) {
    return res.status(400).json({ success: false, error: 'Praise report too long (max 500 characters)' });
  }
  
  // Note: we keep user_token stable for anti-spam/uniqueness, even if the UI displays the post as anonymous.
  dbQuery.run(`INSERT INTO ct_praise_reports
    (date, content, user_token, ip_address, organization_id, is_approved, tagged_session_id, originating_tag_id)
    VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7)`,
    [today, content.trim(), userToken, ip, orgId, taggedSessionId, originatingTagId], function(err) {
      if (err) {
        console.error('Error submitting praise report:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      // Update session activity timestamp if we have a session
      if (sessionId) {
        db.query(`UPDATE anonymous_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE session_id = $1`, [sessionId], (err) => {
          if (err) console.error('Error updating session timestamp:', err);
        });
        console.log(`🎉 Praise report linked to tag session: ${originatingTagId}`);
      }
      
      res.json({ success: true, praise_report_id: this.lastID });
    });
});

// Celebrate praise report
router.post('/celebrate', authenticateUser, requireActiveGroupMembership, (req, res) => {
  const { praise_report_id } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  const userId = req.user.userId;
  const userToken = `user_${userId}`;
  const orgId = req.activeOrganizationId;
  
  // Get session attribution from cookies
  const taggedSessionId = req.cookies?.taggedSession;
  const originatingTagId = req.cookies?.originatingTag;
  const sessionId = req.cookies?.trackingSession;
  
  console.log(`Celebration interaction - userId: ${userId}, orgId: ${orgId}, praiseReportId: ${praise_report_id}, taggedSession: ${taggedSessionId}, originatingTag: ${originatingTagId}`);
  
  if (!praise_report_id) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }
  
  // Check if user already celebrated this report
  db.query(`SELECT id FROM ct_celebration_interactions WHERE praise_report_id = $1 AND user_token = $2`,
    [praise_report_id, userToken], (err, result) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }

      if (result.rows && result.rows.length > 0) {
        return res.status(400).json({ success: false, error: 'You already celebrated this report' });
      }
      
      // Add celebration interaction with session attribution
      dbQuery.run(`INSERT INTO ct_celebration_interactions
        (praise_report_id, user_token, ip_address, tagged_session_id, originating_tag_id)
        VALUES ($1, $2, $3, $4, $5)`,
        [praise_report_id, userToken, ip, taggedSessionId, originatingTagId], function(err) {
          if (err) {
            return res.status(500).json({ success: false, error: 'Database error' });
          }
          
          // Update session activity timestamp if we have a session
          if (sessionId) {
            db.query(`UPDATE anonymous_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE session_id = $1`, [sessionId], (err) => {
              if (err) console.error('Error updating session timestamp:', err);
            });
            console.log(`🎉 Celebration interaction linked to tag session: ${originatingTagId}`);
          }
          
          // Update celebration count
          dbQuery.run(`UPDATE ct_praise_reports SET celebration_count = celebration_count + 1 WHERE id = $1`,
            [praise_report_id], (err) => {
              if (err) {
                return res.status(500).json({ success: false, error: 'Database error' });
              }
              
              // Get updated count
              db.query(`SELECT celebration_count FROM ct_praise_reports WHERE id = $1`,
                [praise_report_id], (err, result) => {
                  if (err) {
                    return res.status(500).json({ success: false, error: 'Database error' });
                  }

                  res.json({ success: true, celebration_count: result.rows && result.rows.length > 0 ? result.rows[0].celebration_count : 0 });
                });
            });
        });
    });
});

module.exports = router;