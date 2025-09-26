const express = require('express');
const { dbQuery } = require('../config/database');
const { trackAnalytics } = require('../services/analyticsService');

const router = express.Router();

// Get community content for a specific date
router.get('/:date', trackAnalytics('community_view'), (req, res) => {
  const { date } = req.params;
  const orgId = req.organizationId || 1;
  
  // Get prayer requests for the date
  const getPrayerRequests = new Promise((resolve, reject) => {
  dbQuery.all(`SELECT * FROM ct_prayer_requests WHERE date = $1 AND is_approved = TRUE AND is_hidden = FALSE AND organization_id = $2 ORDER BY created_at ASC`, 
      [date, orgId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
  });
  
  // Get praise reports for the date
  const getPraiseReports = new Promise((resolve, reject) => {
  dbQuery.all(`SELECT * FROM ct_praise_reports WHERE date = $1 AND is_approved = TRUE AND is_hidden = FALSE AND organization_id = $2 ORDER BY created_at ASC`, 
      [date, orgId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
  });
  
  // Get verse insights for the date
  const getVerseInsights = new Promise((resolve, reject) => {
  dbQuery.all(`SELECT * FROM ct_verse_community_posts WHERE date = $1 AND is_approved = TRUE AND is_hidden = FALSE AND organization_id = $2 ORDER BY created_at ASC`, 
      [date, orgId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
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

module.exports = router;

