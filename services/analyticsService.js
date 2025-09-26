const { db } = require('../config/database');

/**
 * Track interaction middleware
 * This middleware tracks basic page/route interactions
 */
const trackInteraction = async (req, res, next) => {
  try {
    // Extract basic information from request
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent') || '';
    const path = req.path;
    const method = req.method;
    const organizationId = req.organization?.id || null;
    
    // Skip tracking for static assets and health checks
    if (path.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf)$/i) || 
        path === '/health' || 
        path === '/favicon.ico') {
      return next();
    }
    
    // Insert interaction tracking record (fire and forget)
    // Only track if we have a valid organization
    if (db && db.query && organizationId) {
      db.query(
        `INSERT INTO ct_analytics (
          organization_id, ip_address, user_agent, action, timestamp
        ) VALUES ($1, $2, $3, $4, NOW())`,
        [organizationId, ip, userAgent, `${method} ${path}`]
      ).catch(err => {
        // Log error but don't fail the request
        console.warn('Failed to track interaction:', err.message);
      });
    }
    
    next();
  } catch (error) {
    // Don't fail the request if tracking fails
    console.warn('Error in trackInteraction middleware:', error.message);
    next();
  }
};

/**
 * Track analytics for specific actions
 * This function can be called to track specific events
 */
const trackAnalytics = async (action, data = {}) => {
  try {
    if (!db || !db.query) {
      console.warn('Database not available for analytics tracking');
      return;
    }
    
    // Insert analytics record
    await db.query(
      `INSERT INTO ct_analytics (
        organization_id, action, timestamp
      ) VALUES ($1, $2, NOW())`,
      [data.organizationId || null, action]
    );
    
    console.log(`📊 Analytics tracked: ${action}`, data);
  } catch (error) {
    // Log error but don't throw
    console.warn('Failed to track analytics:', error.message);
  }
};

/**
 * Track analytics middleware
 * This middleware version of trackAnalytics for route-level tracking
 */
const trackAnalyticsMiddleware = (action) => {
  return async (req, res, next) => {
    try {
      const data = {
        organizationId: req.organization?.id,
        userId: req.user?.id,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        path: req.path,
        query: req.query,
        body: req.body
      };
      
      // Track the analytics (fire and forget)
      trackAnalytics(action, data).catch(err => {
        console.warn('Analytics tracking failed:', err.message);
      });
      
      next();
    } catch (error) {
      console.warn('Error in trackAnalyticsMiddleware:', error.message);
      next();
    }
  };
};

module.exports = {
  trackInteraction,
  trackAnalytics,
  trackAnalyticsMiddleware
};
