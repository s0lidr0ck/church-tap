const { getOrganizationFeatures } = require('../services/organizationFeaturesService');

function featureKeyToColumn(featureKey) {
  const key = (featureKey || '').toString().trim();
  const map = {
    prayerRequests: 'prayer_requests_enabled',
    praiseReports: 'praise_reports_enabled',
    insights: 'insights_enabled',
    verseCommentary: 'verse_commentary_enabled',
    anonymousPosts: 'anonymous_posts_enabled',
    groupCalendar: 'group_calendar_enabled',
    groupLinks: 'group_links_enabled'
  };
  return map[key] || key;
}

function requireOrgFeature(featureKey, opts = {}) {
  const column = featureKeyToColumn(featureKey);
  const message = opts.message || 'This feature is disabled for your group';
  const code = opts.code || 'FEATURE_DISABLED';

  return async function orgFeatureGate(req, res, next) {
    try {
      const orgId = req.activeOrganizationId || req.session?.organizationId || req.organization?.id;
      if (!orgId) return next();

      const features = await getOrganizationFeatures(orgId);
      if (features[column] === false) {
        return res.status(403).json({ success: false, error: message, code, feature: column });
      }
      return next();
    } catch (e) {
      console.error('Feature gate error:', e);
      return next();
    }
  };
}

module.exports = { requireOrgFeature };


