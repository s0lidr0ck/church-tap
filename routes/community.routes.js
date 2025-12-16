const express = require('express');
const { dbQuery, db } = require('../config/database');
const { authenticateUser } = require('../middleware/userAuth');
const { requireActiveGroupMembership } = require('../middleware/membershipGate');
const { getOrganizationFeatures } = require('../services/organizationFeaturesService');

const router = express.Router();

// Get community content for a specific date
router.get('/:date', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  const { date } = req.params;
  const orgId = req.activeOrganizationId;

  console.log(`📋 Community wall request - date: ${date}, activeOrgId: ${orgId}, userId: ${req.user?.userId}`);

  let features = null;
  try {
    features = await getOrganizationFeatures(orgId);
  } catch (e) {
    console.error('Error loading org features for community:', e);
    features = null; // fail-open
  }
  
  // Get prayer requests for the date
  const getPrayerRequests = (features && features.prayer_requests_enabled === false)
    ? Promise.resolve([])
    : new Promise((resolve, reject) => {
        db.query(`SELECT * FROM ct_prayer_requests WHERE date = $1 AND is_approved = TRUE AND is_hidden = FALSE AND organization_id = $2 ORDER BY created_at ASC`,
          [date, orgId], (err, result) => {
            if (err) reject(err);
            else resolve(result.rows || []);
          });
      });
  
  // Get praise reports for the date
  const getPraiseReports = (features && features.praise_reports_enabled === false)
    ? Promise.resolve([])
    : new Promise((resolve, reject) => {
        db.query(`SELECT * FROM ct_praise_reports WHERE date = $1 AND is_approved = TRUE AND is_hidden = FALSE AND organization_id = $2 ORDER BY created_at ASC`,
          [date, orgId], (err, result) => {
            if (err) reject(err);
            else resolve(result.rows || []);
          });
      });
  
  // Get verse insights for the date
  const getVerseInsights = (features && features.insights_enabled === false)
    ? Promise.resolve([])
    : new Promise((resolve, reject) => {
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

module.exports = router;

