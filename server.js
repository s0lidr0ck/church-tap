require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const compression = require('compression');

// Import configuration
const { PORT } = require('./config/constants');
const { securityHeaders, resolveOrganization } = require('./config/middleware');
const createRateLimiter = require('./middleware/rateLimit');
const { handleValidationError } = require('./middleware/validation');

// Import route modules
const staticRoutes = require('./routes/static.routes');
const verseRoutes = require('./routes/verse.routes');
const versesRoutes = require('./routes/verses.routes');
const adminRoutes = require('./routes/admin.routes');
const masterRoutes = require('./routes/master.routes');
const authRoutes = require('./routes/auth.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const communityRoutes = require('./routes/community.routes');
const prayerRoutes = require('./routes/prayer.routes');
const praiseRoutes = require('./routes/praise.routes');
const feedbackRoutes = require('./routes/feedback.routes');
const organizationRoutes = require('./routes/organization.routes');
const organizationAdminRoutes = require('./routes/organizationAdmin.routes');
const nfcRoutes = require('./routes/nfc.routes');
const setupRoutes = require('./routes/setup.routes');
const strongsRoutes = require('./routes/strongs.routes');
const verseCommunityRoutes = require('./routes/verseCommunity.routes');
const masterAnalyticsRoutes = require('./routes/masterAnalytics.routes');
const sessionRoutes = require('./routes/session.routes');
const tapRoutes = require('./routes/tap.routes');
const userRoutes = require('./routes/user.routes');
const braceletsRoutes = require('./routes/bracelets.routes');

// Initialize Express app
const app = express();
app.set('trust proxy', 1);

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(compression());

// Security headers
app.use(securityHeaders);

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false,
    sameSite: 'lax',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Organization resolution middleware (must come before routes)
app.use(resolveOrganization);

// Rate limiting setup
const rateLimiter = createRateLimiter({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '', 10) || undefined,
  max: parseInt(process.env.RATE_LIMIT_MAX || '', 10) || undefined
});

// Apply rate limiting to community submission endpoints
app.use('/api/prayer-request', rateLimiter('prayer_submit'));
app.use('/api/praise-report', rateLimiter('praise_submit'));
app.use('/api/prayer-request/pray', rateLimiter('pray_action'));
app.use('/api/praise-report/celebrate', rateLimiter('celebrate_action'));
app.use('/api/verse-community', rateLimiter('verse_community_submit'));
app.use('/api/verse-community/heart', rateLimiter('verse_community_heart'));

// Apply stricter rate limiting to authentication endpoints
const authRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 }); // 20 req / 15 min per IP/org
app.use('/api/auth/login', authRateLimiter('auth_login'));
app.use('/api/auth/register', authRateLimiter('auth_register'));

// Mount route modules
app.use('/api/verse', verseRoutes);
app.use('/api/verses', versesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/master', masterRoutes);
app.use('/api/auth', authRoutes.router);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/sync-analytics', analyticsRoutes); // Backward compatibility
app.use('/api/community', communityRoutes);
app.use('/api/prayer-request', prayerRoutes);
app.use('/api/praise-report', praiseRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/organization', organizationRoutes);
app.use('/api/admin/organization', organizationAdminRoutes);
app.use('/api/master/nfc-tags', nfcRoutes);
app.use('/api/nfc-tags', nfcRoutes); // For scan endpoint
app.use('/api/setup', setupRoutes);
app.use('/setup', setupRoutes); // Direct setup route for the token URLs
app.use('/api/strongs', strongsRoutes);
app.use('/api/verse-community', verseCommunityRoutes);
app.use('/api/master/analytics', masterAnalyticsRoutes);
app.use('/api/session', sessionRoutes);
app.use('/api/user', userRoutes);
app.use('/api/bracelets', braceletsRoutes);

// Tap routes - must come before static routes to handle /t/<uid>
app.use('/', tapRoutes);

// Static routes (homepage, admin pages, etc.)
app.use('/', staticRoutes);

// Static files - put at the end so dynamic routes take precedence
app.use(express.static('public'));

// Error handling middleware
app.use(handleValidationError);


// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Church Tap app running on http://0.0.0.0:${PORT}`);
  console.log('🚀 Multi-tenant system ready!');
  console.log('📖 Automatic verse import system enabled');
  console.log('🏗️ Modular architecture loaded');
});

module.exports = app;