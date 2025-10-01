const express = require('express');
const { dbQuery, db } = require('../config/database');

const router = express.Router();

// Get community content for a specific date
router.get('/:date', (req, res) => {
  const { date } = req.params;
  let orgId = req.organization?.id || null;
  
  // If no org from middleware, try to resolve from tag cookie
  const originatingTagId = req.cookies?.originatingTag;
  
  const resolveOrgFromTag = (cb) => {
    if (orgId) return cb();
    if (!originatingTagId) {
      orgId = 1; // Default fallback
      return cb();
    }
    
    db.query(`SELECT organization_id FROM ct_nfc_tags WHERE custom_id = $1`, [originatingTagId], (err, result) => {
      if (!err && result.rows.length > 0) {
        orgId = result.rows[0].organization_id;
        console.log(`📋 ✅ Resolved org ${orgId} from tag ${originatingTagId}`);
      } else {
        orgId = 1; // Default fallback
      }
      cb();
    });
  };
  
  resolveOrgFromTag(() => {
    console.log(`📋 Community wall request - date: ${date}, org: ${req.organization?.subdomain}, orgId: ${orgId}`);
  
  // Get prayer requests for the date
  const getPrayerRequests = new Promise((resolve, reject) => {
  db.query(`SELECT * FROM ct_prayer_requests WHERE date = $1 AND is_approved = TRUE AND is_hidden = FALSE AND organization_id = $2 ORDER BY created_at ASC`,
      [date, orgId], (err, result) => {
        if (err) reject(err);
        else resolve(result.rows || []);
      });
  });
  
  // Get praise reports for the date
  const getPraiseReports = new Promise((resolve, reject) => {
  db.query(`SELECT * FROM ct_praise_reports WHERE date = $1 AND is_approved = TRUE AND is_hidden = FALSE AND organization_id = $2 ORDER BY created_at ASC`,
      [date, orgId], (err, result) => {
        if (err) reject(err);
        else resolve(result.rows || []);
      });
  });
  
  // Get verse insights for the date
  const getVerseInsights = new Promise((resolve, reject) => {
  db.query(`SELECT * FROM ct_verse_community_posts WHERE date = $1 AND is_approved = TRUE AND is_hidden = FALSE AND organization_id = $2 ORDER BY created_at ASC`,
      [date, orgId], (err, result) => {
        if (err) reject(err);
        else resolve(result.rows || []);
      });
  });
  
  Promise.all([getPrayerRequests, getPraiseReports, getVerseInsights])
    .then(([prayerRequests, praiseReports, verseInsights]) => {
      res.json({
        success: true,
        community: {
          prayer_requests: prayerRequests,
          praise_reports: praiseReports,
          verse_insights: verseInsights
        }
      });
    })
    .catch(err => {
      console.error('Error fetching community content:', err);
      res.status(500).json({ success: false, error: 'Database error' });
    });
  });
});

module.exports = router;

