require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const cron = require('node-cron');

// Import configuration
const { PORT } = require('./config/constants');
const { securityHeaders, resolveOrganization } = require('./config/middleware');
const { optionalUserJwt } = require('./middleware/optionalUserJwt');
const { resolveActiveOrganization } = require('./middleware/resolveActiveOrganization');
const createRateLimiter = require('./middleware/rateLimit');
const { handleValidationError } = require('./middleware/validation');
const { VerseImportService } = require('./services/verseService');
const CalendarSyncService = require('./services/calendarSyncService');
const { db } = require('./config/database');

// Lightweight schema guard for newly added, backwards-compatible columns.
// (Prevents runtime errors if migrations haven't been applied yet.)
db.query(`ALTER TABLE ct_organizations ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'approved'`)
  .catch((e) => console.warn('Schema guard: unable to add ct_organizations.review_status (continuing):', e.message));
db.query(`ALTER TABLE ct_organizations ADD COLUMN IF NOT EXISTS created_by_bracelet_uid TEXT`)
  .catch((e) => console.warn('Schema guard: unable to add ct_organizations.created_by_bracelet_uid (continuing):', e.message));
db.query(`ALTER TABLE ct_organizations ADD COLUMN IF NOT EXISTS created_via TEXT`)
  .catch((e) => console.warn('Schema guard: unable to add ct_organizations.created_via (continuing):', e.message));

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
const membershipsRoutes = require('./routes/memberships.routes');
const favoritesRoutes = require('./routes/favorites.routes');
const collectionsRoutes = require('./routes/collections.routes');
const personalPrayersRoutes = require('./routes/personalPrayers.routes');
const dictionaryRoutes = require('./routes/dictionary.routes');
const commentaryRoutes = require('./routes/commentary.routes');
const highlightsRoutes = require('./routes/highlights.routes');
const verseNotesRoutes = require('./routes/verseNotes.routes');
const meSearchRoutes = require('./routes/meSearch.routes');
const scriptureHighlightsRoutes = require('./routes/scriptureHighlights.routes');
const scriptureNotesRoutes = require('./routes/scriptureNotes.routes');

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
// Optional user auth + org context from active_organization_id (account-driven groups)
app.use(optionalUserJwt);
app.use(resolveActiveOrganization);

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
app.use('/api/memberships', membershipsRoutes);
app.use('/api/favorites', favoritesRoutes);
app.use('/api/collections', collectionsRoutes);
app.use('/api/personal-prayers', personalPrayersRoutes);
app.use('/api/dictionary', dictionaryRoutes);
app.use('/api/commentary', commentaryRoutes);
app.use('/api/highlights', highlightsRoutes);
app.use('/api/verse-notes', verseNotesRoutes);
app.use('/api/me', meSearchRoutes);
app.use('/api/scripture-highlights', scriptureHighlightsRoutes);
app.use('/api/scripture-notes', scriptureNotesRoutes);

// Tap routes - must come before static routes to handle /t/<uid>
app.use('/', tapRoutes);

// Static routes (homepage, admin pages, etc.)
app.use('/', staticRoutes);

// Static files - put at the end so dynamic routes take precedence
app.use(express.static('public', {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    const normalized = String(filePath).replace(/\\/g, '/').toLowerCase();

    // Critical: service workers must not be aggressively cached,
    // otherwise clients can get "stuck" on old app versions.
    if (normalized.endsWith('/public/sw.js')) {
      res.setHeader('Cache-Control', 'no-store');
      return;
    }

    // HTML should always be fresh (it points at JS/CSS + controls SW updates).
    if (normalized.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store');
      return;
    }

    // Manifests should revalidate frequently.
    if (normalized.endsWith('/manifest.json') || normalized.endsWith('/admin-manifest.json')) {
      res.setHeader('Cache-Control', 'no-cache');
      return;
    }

    // These are NOT fingerprinted, so don't let them be cached for a long time.
    if (normalized.endsWith('.js') || normalized.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// Error handling middleware
app.use(handleValidationError);


// Initialize verse import service
const verseImportService = new VerseImportService();

/**
 * Check and import missing verses for all organizations
 * This function is called both on startup and via cron job
 */
async function checkAndImportTodayVerses() {
  console.log('🕐 Running daily verse import check...');
  
  try {
    // Get all active organizations
    const result = await db.query('SELECT id, name FROM ct_organizations WHERE is_active = TRUE');
    const organizations = result.rows;
    
    const today = new Date().toISOString().split('T')[0];
    
    console.log(`📅 Checking verses for ${organizations.length} organizations on ${today}`);
    
    let importedCount = 0;
    let existingCount = 0;
    let errorCount = 0;
    
    // Check and import verses for each organization
    for (const org of organizations) {
      try {
        const importedVerse = await verseImportService.checkAndImportMissingVerse(org.id, today);
        
        if (importedVerse) {
          console.log(`✅ Auto-imported verse for ${org.name}: ${importedVerse.reference}`);
          importedCount++;
        } else {
          console.log(`✓ ${org.name} already has a verse for today`);
          existingCount++;
        }
      } catch (error) {
        console.error(`❌ Failed to import verse for ${org.name}:`, error.message);
        errorCount++;
      }
    }
    
    console.log(`✅ Daily verse import check completed: ${importedCount} imported, ${existingCount} existing, ${errorCount} errors`);
  } catch (error) {
    console.error('❌ Daily verse import check failed:', error);
  }
}

/**
 * Scheduled task to check and import missing verses for all organizations
 * Runs every day at midnight (00:00)
 */
cron.schedule('0 0 * * *', async () => {
  await checkAndImportTodayVerses();
});

/**
 * Scheduled task to sync enabled external calendar integrations
 * Runs every 30 minutes
 */
cron.schedule('*/30 * * * *', async () => {
  try {
    console.log('🗓️ Running external calendar sync...');
    const result = await CalendarSyncService.syncAllEnabledCalendarIntegrations(25);
    const okCount = (result.outcomes || []).filter(o => o.success === true).length;
    const errCount = (result.outcomes || []).filter(o => o.success === false).length;
    console.log(`🗓️ External calendar sync complete: ${okCount} ok, ${errCount} errors`);
  } catch (e) {
    console.error('🗓️ External calendar sync failed:', e);
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Church Tap app running on http://0.0.0.0:${PORT}`);
  console.log('🚀 Multi-tenant system ready!');
  console.log('📖 Automatic verse import system enabled');
  console.log('⏰ Daily verse import scheduler running (00:00 daily)');
  console.log('🗓️ External calendar sync scheduler running (every 30 min)');
  console.log('🏗️ Modular architecture loaded');
  
  // Run startup verse check (check if today's verses exist for all orgs)
  console.log('\n🔍 Running startup verse check...');
  checkAndImportTodayVerses()
    .then(() => {
      console.log('✅ Startup verse check complete\n');
    })
    .catch(err => {
      console.error('❌ Startup verse check failed:', err);
    });
});

module.exports = app;