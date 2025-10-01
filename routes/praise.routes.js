const express = require('express');
const { dbQuery, db } = require('../config/database');
const { validateInput } = require('../middleware/validation');

const router = express.Router();

// Submit praise report
router.post('/', validateInput.communityContent, validateInput.sanitizeHtml, (req, res) => {
  const { content, user_token, date } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  const today = date || new Date().toISOString().split('T')[0];
  let orgId = req.organization?.id || null;
  
  // Get session attribution from cookies
  const taggedSessionId = req.cookies?.taggedSession;
  const originatingTagId = req.cookies?.originatingTag;
  const sessionId = req.cookies?.trackingSession;
  
  // If no org from middleware, try to resolve from tag cookie
  const resolveOrgFromTag = (cb) => {
    if (orgId) return cb();
    if (!originatingTagId) {
      orgId = 1; // Default fallback
      return cb();
    }
    
    db.query(`SELECT organization_id FROM ct_nfc_tags WHERE custom_id = $1`, [originatingTagId], (err, result) => {
      if (!err && result.rows.length > 0) {
        orgId = result.rows[0].organization_id;
        console.log(`🎉 ✅ Resolved org ${orgId} from tag ${originatingTagId}`);
      } else {
        orgId = 1; // Default fallback
      }
      cb();
    });
  };
  
  resolveOrgFromTag(() => {
  console.log(`Praise report - org: ${req.organization?.subdomain}, orgId: ${orgId}, taggedSession: ${taggedSessionId}, originatingTag: ${originatingTagId}`);
  
  if (!content || content.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Praise report content is required' });
  }
  
  if (content.length > 500) {
    return res.status(400).json({ success: false, error: 'Praise report too long (max 500 characters)' });
  }
  
  dbQuery.run(`INSERT INTO ct_praise_reports
    (date, content, user_token, ip_address, organization_id, is_approved, tagged_session_id, originating_tag_id)
    VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7)`,
    [today, content.trim(), user_token, ip, orgId, taggedSessionId, originatingTagId], function(err) {
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
});

// Celebrate praise report
router.post('/celebrate', (req, res) => {
  const { praise_report_id, user_token } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  
  // Get session attribution from cookies
  const taggedSessionId = req.cookies?.taggedSession;
  const originatingTagId = req.cookies?.originatingTag;
  const sessionId = req.cookies?.trackingSession;
  
  console.log(`Celebration interaction - praiseReportId: ${praise_report_id}, taggedSession: ${taggedSessionId}, originatingTag: ${originatingTagId}`);
  
  if (!praise_report_id || !user_token) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }
  
  // Check if user already celebrated this report
  db.query(`SELECT id FROM ct_celebration_interactions WHERE praise_report_id = $1 AND user_token = $2`,
    [praise_report_id, user_token], (err, result) => {
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
        [praise_report_id, user_token, ip, taggedSessionId, originatingTagId], function(err) {
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