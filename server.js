require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const sharp = require('sharp');
const cron = require('node-cron');
const fs = require('fs');
const QRCode = require('qrcode');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const createRateLimiter = require('./middleware/rateLimit');
const s3Service = require('./services/s3Service');
const xml2js = require('xml2js');

// Trust reverse proxy (required for secure cookies behind App Runner/ELB)
// Ensures req.secure reflects the original HTTPS and session cookies can be set with secure: true
// See: https://expressjs.com/en/guide/behind-proxies.html
const app = express();
app.set('trust proxy', 1);

// JWT secret (in production, use environment variable)
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this';
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(compression());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // Set to false for App Runner compatibility - sessions work over HTTP/HTTPS
    sameSite: 'lax',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Database setup (Postgres via adapter)
// Direct PostgreSQL connection
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Set it to your PostgreSQL connection string.');
}

const db = new Pool({ 
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Helper function to convert ? placeholders to $1, $2, etc. and handle queries
function convertQueryParams(sql, params) {
  let paramIndex = 1;
  const convertedSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
  return { sql: convertedSql, params };
}

const dbQuery = {
  get: (sql, params, callback) => {
    const { sql: convertedSql, params: convertedParams } = convertQueryParams(sql, params);
    db.query(convertedSql, convertedParams, (err, result) => {
      if (err) return callback(err);
      callback(null, result.rows[0] || null);
    });
  },
  all: (sql, params, callback) => {
    const { sql: convertedSql, params: convertedParams } = convertQueryParams(sql, params);
    db.query(convertedSql, convertedParams, (err, result) => {
      if (err) return callback(err);
      callback(null, result.rows || []);
    });
  },
  run: (sql, params, callback) => {
    const { sql: convertedSql, params: convertedParams } = convertQueryParams(sql, params);
    db.query(convertedSql, convertedParams, (err, result) => {
      if (err) {
        if (callback) return callback(err);
        console.error('Database error (no callback):', err);
        return;
      }
      // Simulate SQLite's this.lastID and this.changes
      const context = { 
        lastID: result.rows[0]?.id || result.insertId,
        changes: result.rowCount || 0
      };
      if (callback) {
        callback.call(context, null);
      }
    });
  }
};

// Note: Postgres schema (CT_* tables) should be created separately.

// Resolve organization context for each request based on host, custom domain, or override hints
const resolveOrganization = (req, res, next) => {
  // Prefer explicit hint via query/header for local/dev use
  const orgHint = req.query.org || req.headers['x-org-subdomain'];
  const hostHeader = (req.headers['x-forwarded-host'] || req.headers.host || '').toString();
  const host = hostHeader.split(':')[0].toLowerCase();

  // Attempt to extract subdomain from host (e.g., subdomain.example.com)
  let subdomainCandidate = null;
  if (orgHint && typeof orgHint === 'string') {
    subdomainCandidate = orgHint.toLowerCase();
  } else if (host && host.includes('.')) {
    const parts = host.split('.');
    const first = parts[0];
    if (first && first !== 'www') {
      subdomainCandidate = first;
    }
  }

  // Fast-path for localhost/dev: default to organization 1
  if (!subdomainCandidate && (host === 'localhost' || host === '127.0.0.1' || host === '::1')) {
    req.organizationId = 1;
    return next();
  }

  // Try to match by custom_domain or subdomain
  dbQuery.get(
    `SELECT id, subdomain FROM ct_organizations WHERE custom_domain = $1 OR subdomain = $2`,
    [host, subdomainCandidate],
    (err, org) => {
      if (err) {
        // On error, default to org 1 to avoid blocking requests
        req.organizationId = 1;
        return next();
      }
      if (org && org.id) {
        req.organizationId = org.id;
      } else {
        req.organizationId = 1;
      }
      next();
    }
  );
};

// Configure multer for image uploads (using memory storage for S3)
const upload = multer({ 
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Auto-publish verses at midnight Central Time
cron.schedule('0 0 * * *', () => {
  const today = new Date().toISOString().split('T')[0];
  dbQuery.run(`UPDATE ct_verses SET published = TRUE WHERE date = $1 AND published = FALSE`, [today], (err) => {
    if (err) {
      console.error('Error auto-publishing verse:', err);
    } else {
      console.log(`Auto-published verse for ${today}`);
    }
  });
}, {
  timezone: "America/Chicago"
});

// Middleware to track analytics
const trackAnalytics = (action) => {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');
    const verseId = req.params.id || req.body.verse_id;
    const orgId = req.organizationId || 1;

    dbQuery.run(
      `INSERT INTO ct_analytics (verse_id, action, ip_address, user_agent, organization_id) VALUES (?, ?, ?, ?, ?)`,
      [verseId, action, ip, userAgent, orgId],
      () => {} // Empty callback
    );
    
    next();
  };
};

// Geolocation service using ip-api.com (free tier)
async function getLocationFromIP(ip) {
  try {
    // Skip localhost and private IPs
    if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
      return {
        country: 'Local',
        region: 'Local',
        city: 'Local',
        latitude: null,
        longitude: null
      };
    }

    const fetch = (await import('node-fetch')).default;
    const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,regionName,city,lat,lon`);
    const data = await response.json();
    
    if (data.status === 'success') {
      return {
        country: data.country,
        region: data.regionName,
        city: data.city,
        latitude: data.lat,
        longitude: data.lon
      };
    }
  } catch (error) {
    console.error('Geolocation error:', error);
  }
  
  return {
    country: 'Unknown',
    region: 'Unknown', 
    city: 'Unknown',
    latitude: null,
    longitude: null
  };
}

// Enhanced tracking middleware for anonymous sessions and interactions
async function trackInteraction(req, res, next) {
  let ip = req.ip || req.connection.remoteAddress;
  
  // For testing: Replace localhost IPs with a test IP for realistic geolocation
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
    ip = '158.120.66.99';
  }
  
  const userAgent = req.get('User-Agent');
  const tagId = req.query.tag_id;
  const org = req.query.org;
  
  console.log('🏷️ TrackInteraction called:', { ip, tagId, org, url: req.originalUrl });

  try {
    // Generate or get session ID (could use cookie or generate based on IP+UserAgent)
    let sessionId = req.cookies?.trackingSession;
    if (!sessionId) {
      sessionId = `${ip}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      res.cookie('trackingSession', sessionId, { 
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production'
      });
    }

    // Get geolocation data
    const location = await getLocationFromIP(ip);

    // Look up organization ID if we have the org subdomain
    let orgId = req.organizationId || null;
    if (!orgId && org) {
      try {
        const orgResult = await db.query('SELECT id FROM ct_organizations WHERE subdomain = $1 AND is_active = TRUE', [org]);
        if (orgResult.rows.length > 0) {
          orgId = orgResult.rows[0].id;
        }
      } catch (error) {
        console.error('Error looking up organization for tracking:', error);
      }
    }

    // Create or update anonymous session
    const { sql: sessionSql, params: sessionParams } = convertQueryParams(`
      INSERT INTO anonymous_sessions (
        session_id, ip_address, user_agent, country, region, city, 
        latitude, longitude, organization_id, first_seen_at, last_seen_at, total_interactions
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)
      ON CONFLICT (session_id) DO UPDATE SET
        last_seen_at = CURRENT_TIMESTAMP,
        total_interactions = anonymous_sessions.total_interactions + 1,
        organization_id = COALESCE(anonymous_sessions.organization_id, ?)
    `, [sessionId, ip, userAgent, location.country, location.region, location.city, 
        location.latitude, location.longitude, orgId, orgId]);

    await db.query(sessionSql, sessionParams);

    // Record tag interaction if this is a tag scan
    if (tagId) {
      const interactionData = {
        url: req.originalUrl,
        method: req.method,
        referrer: req.get('Referrer'),
        timestamp: new Date().toISOString()
      };

      const { sql: interactionSql, params: interactionParams } = convertQueryParams(`
        INSERT INTO tag_interactions (
          session_id, tag_id, interaction_type, page_url, referrer,
          user_agent, ip_address, organization_id, interaction_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [sessionId, tagId, 'scan', req.originalUrl, req.get('Referrer'), 
          userAgent, ip, orgId, JSON.stringify(interactionData)]);

      await db.query(interactionSql, interactionParams);
    }

    // Store session info in request for use by other middleware
    req.trackingSession = {
      sessionId,
      location,
      ip,
      userAgent,
      organizationId: orgId
    };

  } catch (error) {
    console.error('Tracking error:', error);
  }

  next();
}

// Optional authentication middleware (doesn't fail if no token)
const optionalAuth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '') || req.cookies?.authToken;
  
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
    } catch (error) {
      // Invalid token, but continue without authentication
      req.user = null;
    }
  }
  next();
};

// Routes
// Resolve organization for all requests before handling routes
app.use(resolveOrganization);
app.get('/', trackInteraction, (req, res) => {
  const hostHeader = req.headers['x-forwarded-host'] || req.headers.host || '';
  const host = hostHeader.split(':')[0].toLowerCase();
  const { org, tag_id } = req.query;
  
  console.log(`🏠 Homepage request - Host: ${host}, org: ${org}, tag_id: ${tag_id}`);
  
  // Handle NFC tag scan requests
  if (org && tag_id) {
    console.log(`🏷️ NFC tag scan detected: org=${org}, tag_id=${tag_id}`);
    
    // Record the tag scan
    db.query(`
      UPDATE ct_nfc_tags SET 
        last_scanned_at = CURRENT_TIMESTAMP,
        scan_count = scan_count + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE custom_id = $1
    `, [tag_id], (err, result) => {
      if (err) {
        console.error('Error recording NFC scan:', err);
      } else {
        console.log(`📊 Tag scan recorded for: ${tag_id}`);
      }
    });
    
    // Try to find organization by subdomain
    db.query(`
      SELECT id, subdomain, custom_domain, name
      FROM ct_organizations 
      WHERE subdomain = $1 AND is_active = TRUE
    `, [org], (err, orgResult) => {
      if (err) {
        console.error('Error finding organization:', err);
        return res.status(500).send('Internal server error');
      }
      
      if (orgResult.rows.length === 0) {
        console.log(`❌ Organization not found: ${org}`);
        // Organization not found - serve default interface
        return res.sendFile(path.join(__dirname, 'public', 'index.html'));
      }
      
      const organization = orgResult.rows[0];
      console.log(`✅ Organization found: ${organization.name}`);
      
      // For local development, serve the interface directly
      if (host.includes('localhost') || host.includes('127.0.0.1')) {
        console.log(`🔧 Local development - serving interface directly`);
        return res.sendFile(path.join(__dirname, 'public', 'index.html'));
      }
      
      // Check if organization has a custom domain
      if (organization.custom_domain) {
        console.log(`🔄 Redirecting to custom domain: ${organization.custom_domain}`);
        return res.redirect(`https://${organization.custom_domain}?tag_id=${tag_id}`);
      } else {
        // Redirect to subdomain
        const domain = process.env.DOMAIN || 'churchtap.app';
        console.log(`🔄 Redirecting to subdomain: ${organization.subdomain}.${domain}`);
        return res.redirect(`https://${organization.subdomain}.${domain}?tag_id=${tag_id}`);
      }
    });
  } else {
    // Regular homepage request
    // If it's the root domain (no subdomain), serve marketing homepage
    if (host === 'churchtap.app' || host === 'www.churchtap.app') {
      console.log(`📄 Serving marketing homepage for: ${host}`);
      res.sendFile(path.join(__dirname, 'public', 'homepage.html'));
    } else {
      // Subdomain or localhost - serve church interface
      console.log(`⛪ Serving church interface for: ${host}`);
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
  }
});

app.get('/verse', trackAnalytics('view'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/verse/:date', trackAnalytics('view'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/master', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'master.html'));
});

// API Routes

// Get random verse from bolls.life API (must come BEFORE /api/verse/:date)
app.get('/api/verse/random', async (req, res) => {
  console.log('🎲 Random verse endpoint called - URL:', req.url);
  console.log('🎲 Query params:', req.query);
  try {
    // Use NASB translation by default, could be made configurable per user/org
    const translation = 'NASB';
    console.log('🌐 Fetching from bolls.life API...');
    const bollsResponse = await fetch(`https://bolls.life/get-random-verse/${translation}/`);
    
    if (!bollsResponse.ok) {
      throw new Error(`Bolls.life API error: ${bollsResponse.status}`);
    }
    
    const bollsData = await bollsResponse.json();
    console.log('📖 Received data from bolls.life:', bollsData);
    
    // Convert bolls.life format to our app's format
    const bookName = getBookName(bollsData.book);
    const reference = `${bookName} ${bollsData.chapter}:${bollsData.verse}`;
    
    const verse = {
      id: `bolls_${bollsData.pk}`, // Unique ID for this external verse
      date: new Date().toISOString().split('T')[0], // Today's date
      content_type: 'text',
      verse_text: bollsData.text,
      bible_reference: reference,
      context: `Random verse from ${translation} translation via bolls.life`,
      tags: 'random,external',
      published: true,
      hearts: 0,
      source: 'bolls.life',
      translation: bollsData.translation,
      external_id: bollsData.pk
    };
    
    console.log('✅ Sending verse response');
    res.json({ success: true, verse });
    
  } catch (error) {
    console.error('Error fetching random verse from bolls.life:', error);
    console.error('Error details:', error.message);
    
    // Fallback to local database if bolls.life is unavailable
    console.log('🔄 Falling back to local database...');
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const twoWeeksAgoStr = twoWeeksAgo.toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    const orgId = req.organizationId || 1;
    
    console.log(`📅 Looking for verses between ${twoWeeksAgoStr} and ${today} for org ${orgId}`);
    
    dbQuery.get(`SELECT * FROM ct_verses WHERE date BETWEEN $1 AND $2 AND published = TRUE AND organization_id = $3 ORDER BY RANDOM() LIMIT 1`, 
      [twoWeeksAgoStr, today, orgId], (err, row) => {
      console.log('📊 Database query result - err:', err, 'row:', row);
      if (err) {
        console.error('Database error in fallback:', err);
        return res.status(500).json({ success: false, error: 'Database error in fallback' });
      }
      if (!row) {
        console.log('No verses found in fallback');
        return res.status(404).json({ success: false, error: 'No verses found for this organization' });
      }
      
      console.log('✅ Sending fallback verse');
      res.json({ success: true, verse: row });
    });
  }
});

// Get verse by date (with personalization support)
app.get('/api/verse/:date', trackAnalytics('api_verse'), optionalAuth, async (req, res) => {
  const { date } = req.params;
  const orgId = req.organizationId || 1;
  
  try {
    // Check if there's a scheduled verse for this date first
    dbQuery.get(`SELECT * FROM ct_verses WHERE date = $1 AND published = TRUE AND organization_id = $2`, [date, orgId], async (err, scheduledVerse) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      // If no user is logged in or no scheduled verse, return what we have
      if (!req.user || !scheduledVerse) {
        if (scheduledVerse) {
          return res.json({ success: true, verse: scheduledVerse });
        } else {
          return res.json({ success: false, message: 'No verse found for this date' });
        }
      }

      // For logged-in users, try to find a personalized verse
      try {
        // Get user preferences
        dbQuery.get(`SELECT * FROM ct_user_preferences WHERE user_id = $1`, [req.user.userId], (err, prefs) => {
          if (err || !prefs) {
            // If no preferences, return the scheduled verse
            return res.json({ success: true, verse: scheduledVerse });
          }

          // Parse preferences
          const interests = prefs.interests ? JSON.parse(prefs.interests) : [];
          const struggles = prefs.struggles ? JSON.parse(prefs.struggles) : [];
          const allTopics = [...interests, ...struggles];
          
          // If no topics selected, return scheduled verse
          if (allTopics.length === 0) {
            return res.json({ success: true, verse: scheduledVerse });
          }

          // Build personalization query to find relevant verses
          let conditions = allTopics.map(() => 'tags LIKE ? OR context LIKE ?').join(' OR ');
          let searchParams = [];
          allTopics.forEach(topic => {
            searchParams.push(`%${topic}%`, `%${topic}%`);
          });

          let personalizedQuery = `
            SELECT *, 
            (
              CASE 
                ${allTopics.map((topic, i) => 
                  `WHEN (tags LIKE '%${topic}%' OR context LIKE '%${topic}%') THEN ${struggles.includes(topic) ? 4 : 2}`
                ).join(' ')}
                ELSE 1
              END
            ) as relevance_score
            FROM ct_verses 
            WHERE published = TRUE 
            AND date <= $1 
            AND (${conditions})
            AND organization_id = $2
            ORDER BY relevance_score DESC, ABS((date - $3::date)) ASC
            LIMIT 1
          `;

          dbQuery.get(personalizedQuery, [...searchParams, date, orgId, date], (err, personalizedVerse) => {
            if (err) {
              console.error('Personalization query error:', err);
              return res.json({ success: true, verse: scheduledVerse });
            }

            // If we found a personalized verse with good relevance, use it
            if (personalizedVerse && personalizedVerse.relevance_score > 2) {
              // Add personalization flag to response
              personalizedVerse.personalized = true;
              personalizedVerse.reason = 'Selected based on your interests and preferences';
              return res.json({ success: true, verse: personalizedVerse });
            }

            // Otherwise, return the scheduled verse
            return res.json({ success: true, verse: scheduledVerse });
          });
        });
      } catch (error) {
        console.error('Personalization error:', error);
        return res.json({ success: true, verse: scheduledVerse });
      }
    });
  } catch (error) {
    console.error('Verse fetch error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Helper function to map book numbers to book names (bolls.life uses numbers)
const getBookName = (bookNumber) => {
  const books = [
    '', // 0 - not used
    'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth',
    '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra', 'Nehemiah',
    'Esther', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah',
    'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah',
    'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
    'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians', '2 Corinthians',
    'Galatians', 'Ephesians', 'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians',
    '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James', '1 Peter', '2 Peter',
    '1 John', '2 John', '3 John', 'Jude', 'Revelation'
  ];
  return books[bookNumber] || `Book ${bookNumber}`;
};

// Heart a verse
app.post('/api/verse/heart', (req, res) => {
  const { verse_id, user_token } = req.body;
  
  if (!verse_id || !user_token) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }
  
  dbQuery.run(`UPDATE ct_verses SET hearts = hearts + 1 WHERE id = $1`, [verse_id], function(err) {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    // Get updated heart count
    dbQuery.get(`SELECT hearts FROM ct_verses WHERE id = $1`, [verse_id], (err, row) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      res.json({ success: true, hearts: row ? row.hearts : 0 });
    });
  });
});

// Generate QR code for verse
app.get('/api/verse/qr/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const url = `${req.protocol}://${req.get('host')}/verse/${id}`;
    
    const qrCodeDataURL = await QRCode.toDataURL(url, {
      width: 200,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    
    res.json({ success: true, qr_code: qrCodeDataURL });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to generate QR code' });
  }
});

// Track analytics
app.post('/api/analytics', (req, res) => {
  const { action, verse_id, user_token, timestamp } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent');
  const orgId = req.organizationId || 1;
  
  dbQuery.run(`INSERT INTO ct_analytics (verse_id, action, ip_address, user_agent, organization_id) VALUES (?, ?, ?, ?, ?)`,
    [verse_id, action, ip, userAgent, orgId], (err) => {
    if (err) {
      console.error('Analytics error:', err);
      return res.status(500).json({ success: false });
    }
    
    res.json({ success: true });
  });
});

// Background sync endpoint used by service worker to flush queued analytics
app.post('/api/sync-analytics', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent');
  const orgId = req.organizationId || 1;

  // Optionally accept a batch payload of events; if none provided, log a heartbeat
  const { events } = req.body || {};

  if (Array.isArray(events) && events.length > 0) {
    // Process events sequentially for PostgreSQL compatibility
    let processed = 0;
    let errors = [];
    
    const processEvent = (index) => {
      if (index >= events.length) {
        if (errors.length > 0) {
          console.error('Background sync batch errors:', errors);
          return res.status(500).json({ success: false });
        }
        return res.json({ success: true, processed });
      }
      
      const ev = events[index];
      dbQuery.run(`INSERT INTO ct_analytics (verse_id, action, ip_address, user_agent, organization_id) VALUES (?, ?, ?, ?, ?)`,
        [ev.verse_id || null, ev.action || 'bg_event', ip, userAgent, orgId],
        (err) => {
          if (err) {
            errors.push(`Event ${index}: ${err.message}`);
          } else {
            processed++;
          }
          processEvent(index + 1);
        }
      );
    };
    
    processEvent(0);
  } else {
    dbQuery.run(
      `INSERT INTO ct_analytics (verse_id, action, ip_address, user_agent, organization_id) VALUES (?, ?, ?, ?, ?)`,
      [null, 'background-sync', ip, userAgent, orgId],
      (err) => {
        if (err) {
          console.error('Background sync error:', err);
          return res.status(500).json({ success: false });
        }
        return res.json({ success: true });
      }
    );
  }
});

// Search verses
app.get('/api/verses/search', optionalAuth, (req, res) => {
  const { q: query, limit = 10, offset = 0 } = req.query;
  const orgId = req.organizationId || 1;
  
  if (!query || query.trim().length < 2) {
    return res.status(400).json({ success: false, error: 'Search query must be at least 2 characters' });
  }
  
  const searchTerm = `%${query.trim()}%`;
  
  // Search in verse text, bible reference, context, and tags
  dbQuery.all(`
    SELECT id, date, content_type, verse_text, image_path, bible_reference, context, tags, published
    FROM ct_verses 
    WHERE published = TRUE 
    AND organization_id = ?
    AND (
      verse_text LIKE ? OR 
      bible_reference LIKE ? OR 
      context LIKE ? OR 
      tags LIKE ?
    )
    ORDER BY date DESC 
    LIMIT ? OFFSET ?
  `, [orgId, searchTerm, searchTerm, searchTerm, searchTerm, parseInt(limit), parseInt(offset)], (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    // Get total count for pagination
    dbQuery.get(`
      SELECT COUNT(*) as total
      FROM ct_verses 
      WHERE published = TRUE 
      AND organization_id = ?
      AND (
        verse_text LIKE ? OR 
        bible_reference LIKE ? OR 
        context LIKE ? OR 
        tags LIKE ?
      )
    `, [orgId, searchTerm, searchTerm, searchTerm, searchTerm], (err, countRow) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      res.json({ 
        success: true, 
        verses: rows || [],
        total: countRow ? countRow.total : 0,
        query: query.trim(),
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: (countRow?.total || 0) > (parseInt(offset) + parseInt(limit))
        }
      });
    });
  });
});

// POST endpoint for verse search (for frontend compatibility)
app.post('/api/verses/search', optionalAuth, (req, res) => {
  const { query, limit = 20, offset = 0 } = req.body;
  const orgId = req.organizationId || 1;
  
  if (!query || query.trim().length < 2) {
    return res.status(400).json({ success: false, error: 'Search query must be at least 2 characters' });
  }
  
  const searchTerm = `%${query.trim()}%`;
  
  // Search in verse text, bible reference, context, and tags
  dbQuery.all(`
    SELECT id, date, content_type, verse_text, image_path, bible_reference, context, tags, published
    FROM ct_verses 
    WHERE published = TRUE 
    AND organization_id = ?
    AND (
      verse_text LIKE ? OR 
      bible_reference LIKE ? OR 
      context LIKE ? OR 
      tags LIKE ?
    )
    ORDER BY date DESC 
    LIMIT ? OFFSET ?
  `, [orgId, searchTerm, searchTerm, searchTerm, searchTerm, parseInt(limit), parseInt(offset)], (err, rows) => {
    if (err) {
      console.error('Search verses error:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    // Get total count for pagination
    dbQuery.get(`
      SELECT COUNT(*) as total
      FROM ct_verses 
      WHERE published = TRUE 
      AND organization_id = ?
      AND (
        verse_text LIKE ? OR 
        bible_reference LIKE ? OR 
        context LIKE ? OR 
        tags LIKE ?
      )
    `, [orgId, searchTerm, searchTerm, searchTerm, searchTerm], (err, countRow) => {
      if (err) {
        console.error('Search count error:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      res.json({ 
        success: true, 
        verses: rows || [],
        total: countRow ? countRow.total : 0,
        query: query.trim(),
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: (countRow?.total || 0) > (parseInt(offset) + parseInt(limit))
        }
      });
    });
  });
});

// Get verse history for the last N days
app.get('/api/verses/history/:days', optionalAuth, (req, res) => {
  const days = parseInt(req.params.days) || 30;
  const orgId = req.organizationId || 1;
  
  // Calculate the date N days ago
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffDateStr = cutoffDate.toISOString().split('T')[0]; // YYYY-MM-DD format
  
  dbQuery.all(`
    SELECT id, date, content_type, verse_text, image_path, bible_reference, context, tags, published
    FROM ct_verses 
    WHERE published = TRUE 
    AND organization_id = ?
    AND date >= ?
    ORDER BY date DESC 
    LIMIT 100
  `, [orgId, cutoffDateStr], (err, rows) => {
    if (err) {
      console.error('History verses error:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    res.json({ 
      success: true, 
      verses: rows || [],
      days: days,
      cutoff_date: cutoffDateStr
    });
  });
});

// Submit feedback
app.post('/api/feedback', (req, res) => {
  const { feedback, user_token, url } = req.body;
  
  if (!feedback) {
    return res.status(400).json({ success: false, error: 'Feedback is required' });
  }
  
  // Store feedback in a simple way (you might want a separate table)
  dbQuery.run(`INSERT INTO ct_analytics (action, ip_address, user_agent) VALUES (?, ?, ?)`,
    [`feedback: ${feedback}`, req.ip, req.get('User-Agent')], (err) => {
    if (err) {
      console.error('Feedback error:', err);
      return res.status(500).json({ success: false });
    }
    
    res.json({ success: true });
  });
});

// Generate verse image
app.post('/api/verse/generate-image', async (req, res) => {
  try {
    const { verse_text, bible_reference, template = 'default' } = req.body;
    
    if (!verse_text || !bible_reference) {
      return res.status(400).json({ success: false, error: 'Verse text and reference are required' });
    }

    // Create canvas-like image using Sharp
    const width = 720;
    const height = 1280;
    
    // Create a gradient background
    const gradientSvg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#bg)" />
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml" style="
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            height: 100%;
            padding: 60px;
            box-sizing: border-box;
            color: white;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            text-align: center;
          ">
            <div style="
              font-size: 32px;
              line-height: 1.4;
              margin-bottom: 40px;
              font-weight: 400;
              text-shadow: 0 2px 4px rgba(0,0,0,0.3);
            ">${verse_text}</div>
            <div style="
              font-size: 20px;
              font-weight: 600;
              opacity: 0.9;
              text-shadow: 0 1px 2px rgba(0,0,0,0.3);
            ">${bible_reference}</div>
          </div>
        </foreignObject>
      </svg>
    `;

    // Generate image using Sharp
    const imageBuffer = await sharp(Buffer.from(gradientSvg))
      .png()
      .toBuffer();

    // Upload to S3
    const timestamp = Date.now();
    const filename = `generated-verse-${timestamp}.png`;
    const s3Result = await s3Service.uploadGeneratedImage(imageBuffer, filename);
    
    res.json({ 
      success: true, 
      image_path: s3Result.path,
      image_url: s3Result.url
    });
  } catch (error) {
    console.error('Image generation error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate image' });
  }
});

// VERSE IMPORT SERVICE
const BIBLE_VERSIONS = {
  'NASB1995': { id: 275, name: 'New American Standard Bible 1995' },
  'KJV': { id: 9, name: 'King James Version' },
  'NIV': { id: 31, name: 'New International Version' },
  'NLT': { id: 51, name: 'New Living Translation' },
  'NKJV': { id: 50, name: 'New King James Version' }
};

class VerseImportService {
  constructor() {
    this.isRunning = false;
  }

  async fetchVerseFromBibleGateway(versionKey = 'NIV') {
    const version = BIBLE_VERSIONS[versionKey];
    if (!version) {
      throw new Error(`Unknown Bible version: ${versionKey}`);
    }

    const rssUrl = `https://www.biblegateway.com/usage/votd/rss/votd.rdf?$${version.id}`;
    
    try {
      const response = await fetch(rssUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const xmlData = await response.text();
      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(xmlData);
      
      // Extract verse data from RSS - handle both RDF and RSS formats
      let item, title, description;
      
      if (result.rss && result.rss.channel && result.rss.channel[0].item) {
        // Standard RSS format
        item = result.rss.channel[0].item[0];
        title = item.title[0];
        description = item['content:encoded'] ? item['content:encoded'][0] : item.description[0];
      } else if (result.rdf && result.rdf.item) {
        // RDF format
        item = result.rdf.item[0];
        title = item.title[0];
        description = item.description[0];
      } else {
        throw new Error('Unexpected RSS format');
      }
      
      // Parse title for reference (e.g., "Psalm 16:8")
      const reference = title.trim();
      
      // Clean up verse text (remove CDATA and extra formatting)
      let verseText = description.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
      verseText = verseText.replace(/<[^>]*>/g, '').trim(); // Remove HTML tags
      
      // Remove Bible Gateway copyright text
      verseText = verseText.replace(/Brought to you by BibleGateway\.com\. Copyright \(C\)[^.]*\. All Rights Reserved\./gi, '').trim();
      verseText = verseText.replace(/Copyright.*All Rights Reserved\.?/gi, '').trim();
      
      // Remove HTML entities for quotes
      verseText = verseText.replace(/&ldquo;/g, '"').replace(/&rdquo;/g, '"').trim();
      
      // Generate smart tags
      const tags = this.generateVerseTags(reference, verseText);
      
      return {
        reference,
        text: verseText,
        version: versionKey,
        source: 'Bible Gateway',
        tags
      };
      
    } catch (error) {
      console.error('Error fetching verse from Bible Gateway:', error);
      throw error;
    }
  }

  generateVerseTags(reference, verseText) {
    const tags = [];
    
    // Extract book name from reference (e.g., "Psalm 16:8" -> "Psalm")
    const bookMatch = reference.match(/^([A-Za-z0-9\s]+)\s+\d+:/);
    if (bookMatch) {
      const bookName = bookMatch[1].trim().toLowerCase();
      tags.push(bookName);
    }
    
    // Common spiritual keywords to look for in the verse
    const keywords = {
      'faith': /\b(faith|believe|trust|hope)\b/i,
      'love': /\b(love|beloved|mercy|compassion|kindness)\b/i,
      'peace': /\b(peace|rest|calm|still)\b/i,
      'strength': /\b(strength|power|mighty|strong)\b/i,
      'joy': /\b(joy|joyful|rejoice|glad|happiness)\b/i,
      'prayer': /\b(pray|prayer|ask|seek)\b/i,
      'wisdom': /\b(wisdom|wise|understanding|knowledge)\b/i,
      'grace': /\b(grace|mercy|forgiveness|forgive)\b/i,
      'salvation': /\b(salvation|save|saved|savior|redeemer)\b/i,
      'praise': /\b(praise|glory|worship|honor|blessed)\b/i,
      'guidance': /\b(guide|lead|path|way|direction)\b/i,
      'comfort': /\b(comfort|console|refuge|shelter|help)\b/i,
      'eternal': /\b(eternal|everlasting|forever|heaven)\b/i,
      'righteousness': /\b(righteous|holy|pure|blameless)\b/i,
      'provision': /\b(provide|supply|need|gave|blessing)\b/i
    };
    
    // Check verse text for keywords
    for (const [tag, pattern] of Object.entries(keywords)) {
      if (pattern.test(verseText)) {
        tags.push(tag);
      }
    }
    
    // Limit to 5 tags maximum to keep it manageable
    return tags.slice(0, 5).join(',');
  }

  async importVerseForDate(organizationId, date, versionKey = 'NIV') {
    try {
      console.log(`📖 Importing verse for ${date} (${versionKey}) for org ${organizationId}`);
      
      const verseData = await this.fetchVerseFromBibleGateway(versionKey);
      
      // Insert verse into database
      return new Promise((resolve, reject) => {
        dbQuery.run(
          `INSERT INTO CT_verses (organization_id, date, content_type, verse_text, bible_reference, published, tags, created_at)
           VALUES (?, ?, 'text', ?, ?, true, ?, NOW())`,
          [organizationId, date, verseData.text, verseData.reference, verseData.tags],
          function(err) {
            if (err) {
              console.error('Error saving imported verse:', err);
              return reject(err);
            }
            
            console.log(`✅ Successfully imported verse for ${date}: ${verseData.reference}`);
            resolve({
              id: this.lastID,
              ...verseData,
              date,
              organizationId
            });
          }
        );
      });
      
    } catch (error) {
      console.error(`❌ Failed to import verse for ${date}:`, error);
      throw error;
    }
  }

  async checkAndImportMissingVerse(organizationId, date, versionKey = null) {
    if (this.isRunning) {
      console.log('Import already running, skipping...');
      return null;
    }

    this.isRunning = true;
    
    try {
      // Check if verse already exists for this date
      const existingVerse = await new Promise((resolve, reject) => {
        dbQuery.get(
          `SELECT id FROM CT_verses WHERE organization_id = $1 AND date = $2`,
          [organizationId, date],
          (err, row) => {
            if (err) return reject(err);
            resolve(row);
          }
        );
      });

      if (existingVerse) {
        console.log(`📋 Verse already exists for ${date}, skipping import`);
        return null;
      }

      // Get Bible version from settings if not provided
      if (!versionKey) {
        const settings = await new Promise((resolve, reject) => {
          dbQuery.get(
            `SELECT bible_version, enabled FROM CT_verse_import_settings WHERE organization_id = $1`,
            [organizationId],
            (err, row) => {
              if (err) return reject(err);
              resolve(row);
            }
          );
        });
        
        versionKey = (settings && settings.bible_version) || 'NIV';
        
        // Check if import is enabled
        if (settings && settings.enabled === false) {
          console.log(`📋 Verse import disabled for org ${organizationId}, skipping import`);
          return null;
        }
      }

      // Import verse if none exists
      return await this.importVerseForDate(organizationId, date, versionKey);
      
    } finally {
      this.isRunning = false;
    }
  }
}

const verseImportService = new VerseImportService();

// Admin Authentication Middleware
const requireAuth = (req, res, next) => {
  if (!req.session.adminId) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  next();
};

// Organization-aware middleware that adds organization context to requests
const requireOrgAuth = (req, res, next) => {
  if (!req.session.adminId) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  
  // Get admin with organization context
  dbQuery.get(`SELECT au.*, o.id as organization_id 
          FROM ct_admin_users au 
          LEFT JOIN ct_organizations o ON au.organization_id = o.id 
          WHERE au.id = $1 AND au.is_active = TRUE`, [req.session.adminId], (err, admin) => {
    if (err) {
      console.error('Error getting admin organization context:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    if (!admin) {
      return res.status(401).json({ success: false, error: 'Invalid admin session' });
    }
    
    // Add organization context to request
    req.admin = admin;
    req.organizationId = admin.organization_id;
    next();
  });
};

// Master Admin Authentication Middleware
const requireMasterAuth = (req, res, next) => {
  if (!req.session.masterAdminId) {
    console.error('Master auth failed - Session:', req.session ? 'exists' : 'missing', 'MasterAdminId:', req.session?.masterAdminId);
    return res.status(401).json({ success: false, error: 'Master authentication required' });
  }
  next();
};

// Admin login
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password required' });
  }
  
  dbQuery.get(`SELECT au.*, o.name as organization_name, o.subdomain as organization_subdomain 
           FROM ct_admin_users au 
           LEFT JOIN ct_organizations o ON au.organization_id = o.id 
           WHERE au.username = $1 AND au.is_active = TRUE`, [username], async (err, user) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    if (!user || !await bcrypt.compare(password, user.password_hash)) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    
    if (!user.organization_id) {
      return res.status(401).json({ success: false, error: 'No organization assigned' });
    }
    
    req.session.adminId = user.id;
    req.session.adminUsername = user.username;
    req.session.organizationId = user.organization_id;
    req.session.organizationName = user.organization_name;
    
    res.json({ success: true, admin: { 
      id: user.id, 
      username: user.username, 
      role: user.role,
      organization_id: user.organization_id,
      organization_name: user.organization_name
    }});
  });
});

// Create default admin user (for setup)
app.post('/api/setup/admin', async (req, res) => {
  const { username = 'admin', password = 'admin123', email = 'admin@localhost' } = req.body;
  
  // Check if any admin users exist
  dbQuery.get(`SELECT COUNT(*) as count FROM ct_admin_users`, [], async (err, result) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    if (result.count > 0) {
      return res.status(400).json({ success: false, error: 'Admin users already exist' });
    }
    
    try {
      const passwordHash = await bcrypt.hash(password, 12);
      dbQuery.run(
        `INSERT INTO ct_admin_users (username, password_hash, email, role, organization_id, is_active) VALUES (?, ?, ?, ?, ?, ?)`,
        [username, passwordHash, email, 'admin', 1, true],
        function(insertErr) {
          if (insertErr) {
            console.error('Admin creation error:', insertErr);
            return res.status(500).json({ success: false, error: 'Failed to create admin user' });
          }
          res.json({ success: true, message: 'Default admin user created', username, password });
        }
      );
    } catch (hashErr) {
      return res.status(500).json({ success: false, error: 'Failed to process password' });
    }
  });
});

// Admin logout
app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Check admin session status
app.get('/api/admin/check-session', (req, res) => {
  if (req.session.adminId) {
    // Get admin details with organization context
  dbQuery.get(`SELECT au.*, o.name as organization_name, o.subdomain as organization_subdomain 
            FROM ct_admin_users au 
            LEFT JOIN ct_organizations o ON au.organization_id = o.id 
            WHERE au.id = $1 AND au.is_active = TRUE`, [req.session.adminId], (err, admin) => {
      if (err) {
        console.error('Error checking admin session:', err);
        return res.json({ success: false, authenticated: false });
      }
      
      if (admin) {
        res.json({ 
          success: true, 
          authenticated: true, 
          admin: {
            id: admin.id,
            username: admin.username,
            role: admin.role,
            organization_id: admin.organization_id,
            organization_name: admin.organization_name,
            organization_subdomain: admin.organization_subdomain
          }
        });
      } else {
        res.json({ success: true, authenticated: false });
      }
    });
  } else {
    res.json({ 
      success: true, 
      authenticated: false 
    });
  }
});

// Get all verses (admin)
app.get('/api/admin/verses', requireOrgAuth, (req, res) => {
  dbQuery.all(`SELECT * FROM ct_verses WHERE organization_id = $1 ORDER BY date DESC`, [req.organizationId], (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    // Format dates for display
    const verses = rows.map(verse => ({
      ...verse,
      date: verse.date ? new Date(verse.date).toISOString().split('T')[0] : null,
      created_at: verse.created_at ? new Date(verse.created_at).toLocaleString() : null,
      updated_at: verse.updated_at ? new Date(verse.updated_at).toLocaleString() : null
    }));
    
    res.json({ success: true, verses });
  });
});

// Create verse (admin)
app.post('/api/admin/verses', requireOrgAuth, upload.single('image'), async (req, res) => {
  try {
    const { date, content_type, verse_text, bible_reference, context, tags, published } = req.body;
    let image_path = null;
    
    if (!date || !content_type) {
      return res.status(400).json({ success: false, error: 'Date and content type are required' });
    }
    
    if (content_type === 'text' && !verse_text) {
      return res.status(400).json({ success: false, error: 'Verse text is required for text verses' });
    }
    
    if (content_type === 'image' && req.file) {
      // Resize image to 9:16 aspect ratio and upload to S3
      const processedImageBuffer = await sharp(req.file.buffer)
        .resize(720, 1280, { 
          fit: 'cover',
          position: 'center'
        })
        .jpeg({ quality: 85 })
        .toBuffer();
      
      // Upload to S3
      const s3Result = await s3Service.uploadImage(processedImageBuffer, req.file.originalname);
      image_path = s3Result.path;
    }
    
    dbQuery.run(`INSERT INTO ct_verses (date, content_type, verse_text, image_path, bible_reference, context, tags, published, organization_id) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [date, content_type, verse_text, image_path, bible_reference, context, tags, published || 0, req.organizationId],
      function(err) {
        if (err) {
          return res.status(500).json({ success: false, error: 'Database error' });
        }
        
        res.json({ success: true, verse_id: this.lastID });
      });
  } catch (error) {
    console.error('Error creating verse:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Update verse (admin)
app.put('/api/admin/verses/:id', requireOrgAuth, upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    const { date, content_type, verse_text, bible_reference, context, tags, published } = req.body;
    let image_path = req.body.image_path; // Keep existing image if no new one
    
    if (content_type === 'image' && req.file) {
      // Delete old image from S3 if it exists
      if (req.body.image_path) {
        await s3Service.deleteFile(req.body.image_path);
      }
      
      // Resize image to 9:16 aspect ratio and upload to S3
      const processedImageBuffer = await sharp(req.file.buffer)
        .resize(720, 1280, { 
          fit: 'cover',
          position: 'center'
        })
        .jpeg({ quality: 85 })
        .toBuffer();
      
      // Upload to S3
      const s3Result = await s3Service.uploadImage(processedImageBuffer, req.file.originalname);
      image_path = s3Result.path;
    }
    
    dbQuery.run(`UPDATE ct_verses SET date = $1, content_type = $2, verse_text = $3, image_path = $4, 
            bible_reference = $5, context = $6, tags = $7, published = $8 WHERE id = $9 AND organization_id = $10`,
      [date, content_type, verse_text, image_path, bible_reference, context, tags, published, id, req.organizationId],
      function(err) {
        if (err) {
          return res.status(500).json({ success: false, error: 'Database error' });
        }
        
        res.json({ success: true });
      });
  } catch (error) {
    console.error('Error updating verse:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Delete verse (admin)
app.delete('/api/admin/verses/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  
  // Get verse to delete image file if exists (only from this organization)
  dbQuery.get(`SELECT image_path FROM ct_verses WHERE id = $1 AND organization_id = $2`, [id, req.organizationId], (err, verse) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    dbQuery.run(`DELETE FROM ct_verses WHERE id = $1 AND organization_id = $2`, [id, req.organizationId], function(err) {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      // Delete image file from S3 if exists
      if (verse && verse.image_path) {
        s3Service.deleteFile(verse.image_path);
      }
      
      res.json({ success: true });
    });
  });
});

// Bulk operations (admin)
app.post('/api/admin/verses/bulk', requireOrgAuth, (req, res) => {
  const { operation, verse_ids, data } = req.body;
  
  if (!operation || !verse_ids || !Array.isArray(verse_ids)) {
    return res.status(400).json({ success: false, error: 'Invalid bulk operation data' });
  }
  
  const placeholders = verse_ids.map(() => '?').join(',');
  const params = [...verse_ids, req.organizationId];
  
  switch (operation) {
    case 'delete':
      dbQuery.run(`DELETE FROM ct_verses WHERE id IN (${placeholders}) AND organization_id = $${params.length}`, params, function(err) {
        if (err) {
          return res.status(500).json({ success: false, error: 'Database error' });
        }
        res.json({ success: true, affected: this.changes });
      });
      break;
      
    case 'publish':
      dbQuery.run(`UPDATE ct_verses SET published = TRUE WHERE id IN (${placeholders}) AND organization_id = $${params.length}`, params, function(err) {
        if (err) {
          return res.status(500).json({ success: false, error: 'Database error' });
        }
        res.json({ success: true, affected: this.changes });
      });
      break;
      
    case 'unpublish':
      dbQuery.run(`UPDATE ct_verses SET published = FALSE WHERE id IN (${placeholders}) AND organization_id = $${params.length}`, params, function(err) {
        if (err) {
          return res.status(500).json({ success: false, error: 'Database error' });
        }
        res.json({ success: true, affected: this.changes });
      });
      break;
      
    case 'update_tags':
      if (!data.tags) {
        return res.status(400).json({ success: false, error: 'Tags required for tag update' });
      }
      dbQuery.run(`UPDATE ct_verses SET tags = $1 WHERE id IN (${placeholders}) AND organization_id = $${verse_ids.length + 2}`, [data.tags, ...verse_ids, req.organizationId], function(err) {
        if (err) {
          return res.status(500).json({ success: false, error: 'Database error' });
        }
        res.json({ success: true, affected: this.changes });
      });
      break;
      
    default:
      res.status(400).json({ success: false, error: 'Unknown bulk operation' });
  }
});

// Templates management (admin)
app.get('/api/admin/templates', requireOrgAuth, (req, res) => {
  // For now, return predefined templates
  const templates = [
    {
      id: 1,
      name: 'Hope & Encouragement',
      bible_reference: '[Reference]',
      context: 'This verse reminds us that even in difficult times, we can find hope and encouragement in God\'s promises.',
      tags: 'hope, encouragement, comfort, faith'
    },
    {
      id: 2,
      name: 'Strength & Perseverance',
      bible_reference: '[Reference]',
      context: 'When we feel weak or overwhelmed, this verse reminds us that our strength comes from the Lord.',
      tags: 'strength, perseverance, courage, endurance'
    },
    {
      id: 3,
      name: 'Peace & Rest',
      bible_reference: '[Reference]',
      context: 'In our busy and anxious world, God offers us true peace and rest for our souls.',
      tags: 'peace, rest, calm, tranquility'
    },
    {
      id: 4,
      name: 'Love & Grace',
      bible_reference: '[Reference]',
      context: 'This verse showcases the incredible depth of God\'s love and the amazing grace He extends to us.',
      tags: 'love, grace, mercy, forgiveness'
    },
    {
      id: 5,
      name: 'Wisdom & Guidance',
      bible_reference: '[Reference]',
      context: 'When facing decisions or uncertainty, we can trust in God\'s wisdom to guide our paths.',
      tags: 'wisdom, guidance, direction, trust'
    }
  ];
  
  res.json({ success: true, templates });
});

// CSV import/export (admin)
app.post('/api/admin/verses/import', requireOrgAuth, upload.single('csv'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'CSV file required' });
  }
  
  const csv = require('csv-parser');
  const fs = require('fs');
  const results = [];
  
  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', () => {
      // Validate and import CSV data
      let imported = 0;
      let errors = [];
      
      results.forEach((row, index) => {
        const { date, content_type, verse_text, bible_reference, context, tags, published } = row;
        
        if (!date || !content_type) {
          errors.push(`Row ${index + 1}: Date and content type are required`);
          return;
        }
        
        dbQuery.run(`INSERT INTO ct_verses (date, content_type, verse_text, bible_reference, context, tags, published, organization_id) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [date, content_type, verse_text || '', bible_reference || '', context || '', tags || '', published === 'true' ? 1 : 0, req.organizationId],
          function(err) {
            if (err) {
              errors.push(`Row ${index + 1}: ${err.message}`);
            } else {
              imported++;
            }
          });
      });
      
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
      
      setTimeout(() => {
        res.json({ 
          success: true, 
          imported, 
          errors: errors.length > 0 ? errors : null 
        });
      }, 1000); // Wait for database operations
    })
    .on('error', (err) => {
      fs.unlinkSync(req.file.path);
      res.status(500).json({ success: false, error: 'CSV parsing error' });
    });
});

app.get('/api/admin/verses/export', requireOrgAuth, (req, res) => {
  dbQuery.all(`SELECT date, content_type, verse_text, bible_reference, context, tags, published FROM ct_verses WHERE organization_id = $1 ORDER BY date DESC`, [req.organizationId], (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    // Convert to CSV
    const csvHeader = 'date,content_type,verse_text,bible_reference,context,tags,published\n';
    const csvRows = rows.map(row => {
      return [
        row.date,
        row.content_type,
        `"${(row.verse_text || '').replace(/"/g, '""')}"`,
        `"${(row.bible_reference || '').replace(/"/g, '""')}"`,
        `"${(row.context || '').replace(/"/g, '""')}"`,
        `"${(row.tags || '').replace(/"/g, '""')}"`,
        row.published ? 'true' : 'false'
      ].join(',');
    }).join('\n');
    
    const csv = csvHeader + csvRows;
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="verses-export.csv"');
    res.send(csv);
  });
});

// ORGANIZATION LINKS ROUTES

// Get organization links (public endpoint)
app.get('/api/organization/links', (req, res) => {
  const orgId = req.organizationId || 1; // Default to organization 1 if no org context
  
  dbQuery.all(
    `SELECT id, title, url, icon, sort_order 
     FROM ct_organization_links 
     WHERE organization_id = $1 AND is_active = true 
     ORDER BY sort_order ASC, title ASC`,
    [orgId],
    (err, rows) => {
      if (err) {
        console.error('Error fetching organization links:', err);
        return res.status(500).json({ success: false, error: 'Failed to fetch links' });
      }
      res.json(rows);
    }
  );
});

// Admin: Get all organization links
app.get('/api/admin/organization/links', requireOrgAuth, (req, res) => {
  dbQuery.all(
    `SELECT * FROM ct_organization_links 
     WHERE organization_id = $1 
     ORDER BY sort_order ASC, title ASC`,
    [req.organizationId],
    (err, rows) => {
      if (err) {
        console.error('Error fetching organization links:', err);
        return res.status(500).json({ success: false, error: 'Failed to fetch links' });
      }
      res.json(rows);
    }
  );
});

// Admin: Create organization link
app.post('/api/admin/organization/links', requireOrgAuth, (req, res) => {
  const { title, url, icon, sort_order } = req.body;
  
  if (!title || !url) {
    return res.status(400).json({ success: false, error: 'Title and URL are required' });
  }
  
  dbQuery.run(
    `INSERT INTO ct_organization_links (organization_id, title, url, icon, sort_order) 
     VALUES (?, ?, ?, ?, ?)`,
    [req.organizationId, title, url, icon || 'website', sort_order || 0],
    function(err) {
      if (err) {
        console.error('Error creating organization link:', err);
        return res.status(500).json({ success: false, error: 'Failed to create link' });
      }
      
      res.json({ 
        success: true, 
        link: {
          id: this.lastID,
          organization_id: req.organizationId,
          title,
          url,
          icon: icon || 'website',
          sort_order: sort_order || 0,
          is_active: true
        }
      });
    }
  );
});

// Admin: Update organization link
app.put('/api/admin/organization/links/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  const { title, url, icon, sort_order, is_active } = req.body;
  
  if (!title || !url) {
    return res.status(400).json({ success: false, error: 'Title and URL are required' });
  }
  
  dbQuery.run(
    `UPDATE ct_organization_links 
     SET title = $1, url = $2, icon = $3, sort_order = $4, is_active = $5
     WHERE id = $6 AND organization_id = $7`,
    [title, url, icon || 'website', sort_order || 0, is_active !== undefined ? is_active : true, id, req.organizationId],
    function(err) {
      if (err) {
        console.error('Error updating organization link:', err);
        return res.status(500).json({ success: false, error: 'Failed to update link' });
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ success: false, error: 'Link not found' });
      }
      
      res.json({ success: true });
    }
  );
});

// Admin: Delete organization link
app.delete('/api/admin/organization/links/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  
  dbQuery.run(
    `DELETE FROM ct_organization_links 
     WHERE id = $1 AND organization_id = $2`,
    [id, req.organizationId],
    function(err) {
      if (err) {
        console.error('Error deleting organization link:', err);
        return res.status(500).json({ success: false, error: 'Failed to delete link' });
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ success: false, error: 'Link not found' });
      }
      
      res.json({ success: true });
    }
  );
});

// VERSE IMPORT ROUTES

// Get verse import settings
app.get('/api/admin/verse-import/settings', requireOrgAuth, (req, res) => {
  const organizationId = req.organizationId;
  
  dbQuery.get(
    `SELECT enabled, bible_version, import_time, fallback_versions 
     FROM CT_verse_import_settings 
     WHERE organization_id = $1`,
    [organizationId],
    (err, row) => {
      if (err) {
        console.error('Error fetching verse import settings:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      // If no settings exist, return defaults and create them
      if (!row) {
        const defaultSettings = {
          enabled: true,
          bibleVersion: 'NIV',
          importTime: '00:00',
          fallbackVersions: ['NIV', 'NLT', 'KJV']
        };
        
        // Create default settings in database
        dbQuery.run(
          `INSERT INTO CT_verse_import_settings (organization_id, enabled, bible_version, import_time, fallback_versions)
           VALUES (?, ?, ?, ?, ?)`,
          [organizationId, defaultSettings.enabled, defaultSettings.bibleVersion, 
           defaultSettings.importTime, JSON.stringify(defaultSettings.fallbackVersions)],
          (insertErr) => {
            if (insertErr) {
              console.error('Error creating default verse import settings:', insertErr);
            }
          }
        );
        
        return res.json({ success: true, settings: defaultSettings });
      }
      
      // Return existing settings
      let fallbackVersions;
      try {
        fallbackVersions = typeof row.fallback_versions === 'string' 
          ? JSON.parse(row.fallback_versions) 
          : row.fallback_versions || ['NIV', 'NLT', 'KJV'];
      } catch (e) {
        console.warn('Invalid fallback_versions JSON:', row.fallback_versions, 'using defaults');
        fallbackVersions = ['NIV', 'NLT', 'KJV'];
      }
      
      const settings = {
        enabled: row.enabled,
        bibleVersion: row.bible_version,
        importTime: row.import_time,
        fallbackVersions: fallbackVersions
      };
      
      res.json({ success: true, settings });
    }
  );
});

// Update verse import settings
app.put('/api/admin/verse-import/settings', requireOrgAuth, (req, res) => {
  const { enabled, bibleVersion, importTime, fallbackVersions } = req.body;
  const organizationId = req.organizationId;
  
  // Validate bible version
  if (bibleVersion && !BIBLE_VERSIONS[bibleVersion]) {
    return res.status(400).json({ success: false, error: 'Invalid Bible version' });
  }
  
  // Update settings in database (using UPSERT)
  dbQuery.run(
    `INSERT INTO CT_verse_import_settings (organization_id, enabled, bible_version, import_time, fallback_versions, updated_at)
     VALUES (?, ?, ?, ?, ?, NOW())
     ON CONFLICT (organization_id) 
     DO UPDATE SET 
       enabled = EXCLUDED.enabled,
       bible_version = EXCLUDED.bible_version,
       import_time = EXCLUDED.import_time,
       fallback_versions = EXCLUDED.fallback_versions,
       updated_at = NOW()`,
    [organizationId, enabled, bibleVersion, importTime, JSON.stringify(fallbackVersions || ['NIV', 'NLT', 'KJV'])],
    function(err) {
      if (err) {
        console.error('Error updating verse import settings:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      console.log(`✅ Updated verse import settings for org ${organizationId}: ${bibleVersion}`);
      res.json({ 
        success: true, 
        message: 'Verse import settings updated',
        settings: { enabled, bibleVersion, importTime, fallbackVersions }
      });
    }
  );
});

// Manual import verse for specific date
app.post('/api/admin/verse-import/manual', requireOrgAuth, async (req, res) => {
  const { date, bibleVersion = 'NIV' } = req.body;
  
  if (!date) {
    return res.status(400).json({ success: false, error: 'Date is required' });
  }

  if (!BIBLE_VERSIONS[bibleVersion]) {
    return res.status(400).json({ success: false, error: 'Invalid Bible version' });
  }

  try {
    const result = await verseImportService.importVerseForDate(req.organizationId, date, bibleVersion);
    res.json({ 
      success: true, 
      message: `Successfully imported verse for ${date}`,
      verse: result
    });
  } catch (error) {
    console.error('Manual import error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to import verse'
    });
  }
});

// Check and import missing verse for today
app.post('/api/admin/verse-import/check', requireOrgAuth, async (req, res) => {
  const { bibleVersion = 'NIV' } = req.body;
  const today = new Date().toISOString().split('T')[0];

  try {
    const result = await verseImportService.checkAndImportMissingVerse(req.organizationId, today, bibleVersion);
    
    if (result) {
      res.json({ 
        success: true, 
        imported: true,
        message: `Successfully imported today's verse`,
        verse: result
      });
    } else {
      res.json({ 
        success: true, 
        imported: false,
        message: `Verse already exists for today`
      });
    }
  } catch (error) {
    console.error('Check import error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to check/import verse'
    });
  }
});

// Get available Bible versions
app.get('/api/admin/verse-import/versions', (req, res) => {
  res.json({ success: true, versions: BIBLE_VERSIONS });
});

// MASTER ADMIN ROUTES

// Master admin login
app.post('/api/master/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password required' });
  }
  
  dbQuery.get(`SELECT * FROM ct_master_admins WHERE username = $1`, [username], async (err, user) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    if (!user || !await bcrypt.compare(password, user.password_hash)) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    
    if (!user.is_active) {
      return res.status(401).json({ success: false, error: 'Account is disabled' });
    }
    
    req.session.masterAdminId = user.id;
    req.session.masterAdminUsername = user.username;
    
    // Update last login
    dbQuery.run(`UPDATE ct_master_admins SET last_login_at = CURRENT_TIMESTAMP, last_login_ip = $1 WHERE id = $2`, 
      [req.ip, user.id]);
    
    res.json({ success: true, admin: { id: user.id, username: user.username, role: user.role } });
  });
});

// Master admin logout
app.post('/api/master/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Check master admin session status
app.get('/api/master/check-session', (req, res) => {
  if (req.session.masterAdminId) {
    res.json({ 
      success: true, 
      authenticated: true,
      admin: { 
        id: req.session.masterAdminId, 
        username: req.session.masterAdminUsername 
      }
    });
  } else {
    res.json({ 
      success: true, 
      authenticated: false 
    });
  }
});

// Get master dashboard data
app.get('/api/master/dashboard', requireMasterAuth, (req, res) => {
  // Get organization stats
  const getOrgStats = new Promise((resolve, reject) => {
    dbQuery.all(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN is_active THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN plan_type = 'basic' THEN 29 WHEN plan_type = 'premium' THEN 79 WHEN plan_type = 'enterprise' THEN 199 ELSE 0 END) as revenue
      FROM ct_organizations
    `, (err, rows) => {
      if (err) reject(err);
      else resolve(rows[0] || {});
    });
  });
  
  // Get total users across all orgs
  const getUserStats = new Promise((resolve, reject) => {
    dbQuery.get(`SELECT COUNT(*) as total FROM ct_users`, (err, row) => {
      if (err) reject(err);
      else resolve(row || {});
    });
  });
  
  // Get recent organizations
  const getRecentOrgs = new Promise((resolve, reject) => {
    dbQuery.all(`SELECT name, subdomain, created_at FROM ct_organizations ORDER BY created_at DESC LIMIT 5`, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });

  Promise.all([getOrgStats, getUserStats, getRecentOrgs])
    .then(([orgStats, userStats, recentOrgs]) => {
      res.json({
        success: true,
        stats: {
          totalOrganizations: orgStats.total || 0,
          activeOrganizations: orgStats.active || 0,
          monthlyRevenue: orgStats.revenue || 0,
          totalUsers: userStats.total || 0
        },
        recentOrganizations: recentOrgs,
        systemAlerts: [] // Add system alerts logic later
      });
    })
    .catch(error => {
      console.error('Dashboard data error:', error);
      res.status(500).json({ success: false, error: 'Failed to load dashboard data' });
    });
});

// Get all organizations
app.get('/api/master/organizations', requireMasterAuth, (req, res) => {
  try {
    console.log('📊 Querying organizations table...');
    dbQuery.all(`SELECT * FROM ct_organizations ORDER BY created_at DESC`, [], (err, rows) => {
      if (err) {
        console.error('Master organizations query error:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      console.log(`📋 Found ${rows.length} organizations:`, rows.map(r => `ID:${r.id} Name:${r.name}`));
      res.json({ success: true, organizations: rows });
    });
  } catch (error) {
    console.error('Master organizations endpoint error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// List admins for a specific organization (master scope)
app.get('/api/master/organizations/:id/admins', requireMasterAuth, (req, res) => {
  const { id } = req.params;
  dbQuery.all(
    `SELECT id, username, email, role, is_active, created_at, last_login_at 
     FROM ct_admin_users 
     WHERE organization_id = $1 
     ORDER BY created_at DESC`,
    [id],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      res.json({ success: true, admins: rows });
    }
  );
});

// Update admin (activate/deactivate, role changes) for an organization (master scope)
app.put('/api/master/organizations/:id/admins/:adminId', requireMasterAuth, (req, res) => {
  const { id, adminId } = req.params;
  const { is_active, role } = req.body;

  // Ensure admin belongs to the organization
  dbQuery.get(`SELECT id, organization_id FROM ct_admin_users WHERE id = $1`, [adminId], (err, admin) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    if (!admin || String(admin.organization_id) !== String(id)) {
      return res.status(404).json({ success: false, error: 'Admin not found in this organization' });
    }

    const fields = [];
    const params = [];
    let paramIndex = 1;
    
    if (typeof is_active === 'boolean') {
      fields.push(`is_active = $${paramIndex++}`);
      params.push(is_active ? 1 : 0);
    }
    if (role) {
      fields.push(`role = $${paramIndex++}`);
      params.push(role);
    }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, error: 'No changes provided' });
    }

    params.push(adminId);
    dbQuery.run(`UPDATE ct_admin_users SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIndex}`, params, function(updateErr) {
      if (updateErr) {
        return res.status(500).json({ success: false, error: 'Failed to update admin' });
      }
      return res.json({ success: true });
    });
  });
});

// Create new organization
app.post('/api/master/organizations', requireMasterAuth, (req, res) => {
  try {
    const { name, subdomain, contact_email, plan_type, custom_domain } = req.body;
    
    if (!name || !subdomain || !plan_type) {
      return res.status(400).json({ success: false, error: 'Name, subdomain, and plan are required' });
    }
    
    // Check if subdomain is already taken
    dbQuery.get(`SELECT id FROM ct_organizations WHERE subdomain = $1`, [subdomain], (err, existing) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    if (existing) {
      return res.status(400).json({ success: false, error: 'Subdomain is already taken' });
    }
    
    const settings = JSON.stringify({
      theme: 'default',
      features: { community: true, analytics: true, users: true }
    });
    
    const features = JSON.stringify(['verses', 'community', 'analytics', 'users']);
    
    dbQuery.run(`
      INSERT INTO ct_organizations (
        name, subdomain, contact_email, plan_type, custom_domain, settings, features
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [name, subdomain, contact_email, plan_type, custom_domain, settings, features], 
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, error: 'Failed to create organization' });
      }
      
      // Log activity
      dbQuery.run(`
        INSERT INTO ct_master_admin_activity (
          master_admin_id, action, resource_type, resource_id, details, ip_address
        ) VALUES (?, ?, ?, ?, ?, ?)
      `, [
        req.session.masterAdminId, 
        'create_organization', 
        'organization', 
        this.lastID,
        JSON.stringify({ name, subdomain, plan_type }),
        req.ip
      ]);
      
      res.json({ success: true, organization_id: this.lastID });
    });
  });
  } catch (error) {
    console.error('Master create organization endpoint error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Update organization
app.put('/api/master/organizations/:id', requireMasterAuth, (req, res) => {
  const { id } = req.params;
  const { name, subdomain, contact_email, plan_type, custom_domain } = req.body;
  
  if (!name || !subdomain || !plan_type) {
    return res.status(400).json({ success: false, error: 'Name, subdomain, and plan are required' });
  }
  
  // Check if subdomain is taken by another organization
  dbQuery.get(`SELECT id FROM ct_organizations WHERE subdomain = $1 AND id != $2`, [subdomain, id], (err, existing) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    if (existing) {
      return res.status(400).json({ success: false, error: 'Subdomain is already taken' });
    }
    
    dbQuery.run(`
      UPDATE ct_organizations SET 
        name = $1, subdomain = $2, contact_email = $3, plan_type = $4, 
        custom_domain = $5, updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
    `, [name, subdomain, contact_email, plan_type, custom_domain, id], 
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, error: 'Failed to update organization' });
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ success: false, error: 'Organization not found' });
      }
      
      // Log activity
      dbQuery.run(`
        INSERT INTO ct_master_admin_activity (
          master_admin_id, action, resource_type, resource_id, organization_id, details, ip_address
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        req.session.masterAdminId, 
        'update_organization', 
        'organization', 
        id,
        id,
        JSON.stringify({ name, subdomain, plan_type }),
        req.ip
      ]);
      
      res.json({ success: true });
    });
  });
});

// Master overview: global and per-organization usage metrics
app.get('/api/master/overview', requireMasterAuth, (req, res) => {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoISO = sevenDaysAgo.toISOString();

  const getTotals = new Promise((resolve, reject) => {
    // Get all totals in a single query for PostgreSQL compatibility
    dbQuery.get(`
      SELECT 
        (SELECT COUNT(*) FROM ct_organizations) AS total_orgs,
        (SELECT COUNT(*) FROM ct_organizations WHERE is_active = TRUE) AS active_orgs,
        (SELECT COUNT(*) FROM ct_users) AS total_users,
        (SELECT COUNT(*) FROM ct_verses) AS total_verses,
        (SELECT COUNT(*) FROM ct_analytics WHERE action = 'verse_view' AND timestamp >= $1) AS total_views_7d,
        (SELECT COUNT(DISTINCT ip_address) FROM ct_analytics WHERE action = 'verse_view' AND timestamp >= $2) AS unique_visitors_7d
    `, [sevenDaysAgoISO, sevenDaysAgoISO], (err, row) => {
      if (err) return reject(err);
      const totals = {
        totalOrganizations: parseInt(row?.total_orgs || 0),
        activeOrganizations: parseInt(row?.active_orgs || 0),
        totalUsers: parseInt(row?.total_users || 0),
        totalVerses: parseInt(row?.total_verses || 0),
        totalViews7d: parseInt(row?.total_views_7d || 0),
        uniqueVisitors7d: parseInt(row?.unique_visitors_7d || 0)
      };
      resolve(totals);
    });
  });

  const getPerOrg = new Promise((resolve, reject) => {
    dbQuery.all(
      `SELECT 
         o.id,
         o.name,
         o.subdomain,
         o.plan_type,
         o.is_active,
         o.created_at,
         (SELECT COUNT(*) FROM ct_verses v WHERE v.organization_id = o.id) AS verse_count,
         (SELECT COUNT(*) FROM ct_admin_users au WHERE au.organization_id = o.id) AS admin_count,
         (SELECT COUNT(*) FROM ct_users u WHERE u.organization_id = o.id) AS user_count,
         (SELECT MAX(timestamp) FROM ct_analytics a WHERE a.organization_id = o.id) AS last_activity,
         (SELECT COUNT(*) FROM ct_analytics a WHERE a.organization_id = o.id AND a.timestamp >= $1) AS views_7d
       FROM ct_organizations o
       ORDER BY o.created_at DESC`,
      [sevenDaysAgoISO],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      }
    );
  });

  Promise.all([getTotals, getPerOrg])
    .then(([totals, perOrg]) => {
      // Global 7-day timeseries
      dbQuery.all(
        `SELECT DATE(timestamp) as date, COUNT(*) as views, COUNT(DISTINCT ip_address) as unique_visitors
         FROM ct_analytics 
         WHERE action = 'verse_view' AND timestamp >= ?
         GROUP BY DATE(timestamp)
         ORDER BY DATE(timestamp) ASC`,
        [sevenDaysAgoISO],
        (tsErr, seriesRows) => {
          if (tsErr) {
            console.error('Overview timeseries error:', tsErr);
          }
          const globalDaily = (seriesRows || []).map(r => ({
            date: r.date,
            views: r.views,
            uniqueVisitors: r.unique_visitors
          }));

          // Top active orgs by 7d views
          const topActiveOrgs = [...perOrg]
            .sort((a, b) => (b.views_7d || 0) - (a.views_7d || 0))
            .slice(0, 5);

          res.json({ success: true, totals, perOrg, topActiveOrgs, globalDaily });
        }
      );
    })
    .catch((error) => {
      console.error('Master overview error:', error);
      res.status(500).json({ success: false, error: 'Failed to load overview' });
    });
});

// Delete organization
app.delete('/api/master/organizations/:id', requireMasterAuth, (req, res) => {
  const { id } = req.params;
  
  if (id === '1') {
    return res.status(400).json({ success: false, error: 'Cannot delete default organization' });
  }
  
  // Get organization info for logging
  dbQuery.get(`SELECT name, subdomain FROM ct_organizations WHERE id = $1`, [id], (err, org) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    if (!org) {
      return res.status(404).json({ success: false, error: 'Organization not found' });
    }
    
    // Delete organization (this will cascade delete related data)
    dbQuery.run(`DELETE FROM ct_organizations WHERE id = $1`, [id], function(err) {
      if (err) {
        return res.status(500).json({ success: false, error: 'Failed to delete organization' });
      }
      
      // Log activity
      dbQuery.run(`
        INSERT INTO ct_master_admin_activity (
          master_admin_id, action, resource_type, resource_id, details, ip_address
        ) VALUES (?, ?, ?, ?, ?, ?)
      `, [
        req.session.masterAdminId, 
        'delete_organization', 
        'organization', 
        id,
        JSON.stringify({ name: org.name, subdomain: org.subdomain }),
        req.ip
      ]);
      
      res.json({ success: true });
    });
  });
});

// Get community content for a specific date
app.get('/api/community/:date', trackAnalytics('community_view'), (req, res) => {
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

// Submit prayer request
app.post('/api/prayer-request', (req, res) => {
  const { content, user_token, date } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  const today = date || new Date().toISOString().split('T')[0];
  const orgId = req.organizationId || 1;
  
  console.log(`Prayer request - org parameter: ${req.query.org}, detected orgId: ${orgId}, host: ${req.get('host')}`);
  
  if (!content || content.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Prayer request content is required' });
  }
  
  if (content.length > 500) {
    return res.status(400).json({ success: false, error: 'Prayer request too long (max 500 characters)' });
  }
  
  dbQuery.run(`INSERT INTO ct_prayer_requests (date, content, user_token, ip_address, organization_id, is_approved) VALUES (?, ?, ?, ?, ?, TRUE)`,
    [today, content.trim(), user_token, ip, orgId], function(err) {
      if (err) {
        console.error('Error submitting prayer request:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      res.json({ success: true, prayer_request_id: this.lastID });
    });
});

// Submit praise report
app.post('/api/praise-report', (req, res) => {
  const { content, user_token, date } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  const today = date || new Date().toISOString().split('T')[0];
  const orgId = req.organizationId || 1;
  
  if (!content || content.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Praise report content is required' });
  }
  
  if (content.length > 500) {
    return res.status(400).json({ success: false, error: 'Praise report too long (max 500 characters)' });
  }
  
  dbQuery.run(`INSERT INTO ct_praise_reports (date, content, user_token, ip_address, organization_id, is_approved) VALUES (?, ?, ?, ?, ?, TRUE)`,
    [today, content.trim(), user_token, ip, orgId], function(err) {
      if (err) {
        console.error('Error submitting praise report:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      res.json({ success: true, praise_report_id: this.lastID });
    });
});

// Pray for prayer request
app.post('/api/prayer-request/pray', (req, res) => {
  const { prayer_request_id, user_token } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  
  if (!prayer_request_id || !user_token) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }
  
  // Check if user already prayed for this request
  dbQuery.get(`SELECT id FROM ct_prayer_interactions WHERE prayer_request_id = $1 AND user_token = $2`,
    [prayer_request_id, user_token], (err, row) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      if (row) {
        return res.status(400).json({ success: false, error: 'You already prayed for this request' });
      }
      
      // Add prayer interaction
      dbQuery.run(`INSERT INTO ct_prayer_interactions (prayer_request_id, user_token, ip_address) VALUES (?, ?, ?)`,
        [prayer_request_id, user_token, ip], function(err) {
          if (err) {
            return res.status(500).json({ success: false, error: 'Database error' });
          }
          
          // Update prayer count
          dbQuery.run(`UPDATE ct_prayer_requests SET prayer_count = prayer_count + 1 WHERE id = $1`,
            [prayer_request_id], (err) => {
              if (err) {
                return res.status(500).json({ success: false, error: 'Database error' });
              }
              
              // Get updated count
              dbQuery.get(`SELECT prayer_count FROM ct_prayer_requests WHERE id = $1`, 
                [prayer_request_id], (err, row) => {
                  if (err) {
                    return res.status(500).json({ success: false, error: 'Database error' });
                  }
                  
                  res.json({ success: true, prayer_count: row ? row.prayer_count : 0 });
                });
            });
        });
    });
});

// Celebrate praise report
app.post('/api/praise-report/celebrate', (req, res) => {
  const { praise_report_id, user_token } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  
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
      
      // Add celebration interaction
      dbQuery.run(`INSERT INTO ct_celebration_interactions (praise_report_id, user_token, ip_address) VALUES (?, ?, ?)`,
        [praise_report_id, user_token, ip], function(err) {
          if (err) {
            return res.status(500).json({ success: false, error: 'Database error' });
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

// Admin: Get all prayer requests, praise reports, and verse insights
app.get('/api/admin/community', requireOrgAuth, (req, res) => {
  const { days = 7 } = req.query;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];
  
  const getPrayerRequests = new Promise((resolve, reject) => {
    dbQuery.all(`SELECT * FROM ct_prayer_requests WHERE date >= $1 AND organization_id = $2 ORDER BY date DESC, created_at DESC`, 
      [startDateStr, req.organizationId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
  });
  
  const getPraiseReports = new Promise((resolve, reject) => {
    dbQuery.all(`SELECT * FROM ct_praise_reports WHERE date >= $1 AND organization_id = $2 ORDER BY date DESC, created_at DESC`, 
      [startDateStr, req.organizationId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
  });
  
  const getVerseInsights = new Promise((resolve, reject) => {
    dbQuery.all(`SELECT * FROM ct_verse_community_posts WHERE date >= $1 AND organization_id = $2 ORDER BY date DESC, created_at DESC`, 
      [startDateStr, req.organizationId], (err, rows) => {
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
      console.error('Error fetching admin community content:', err);
      res.status(500).json({ success: false, error: 'Database error' });
    });
});

// Admin: Moderate prayer request
app.put('/api/admin/prayer-request/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  const { is_approved, is_hidden } = req.body;
  
  dbQuery.run(`UPDATE ct_prayer_requests SET is_approved = $1, is_hidden = $2 WHERE id = $3 AND organization_id = $4`,
    [is_approved ? 1 : 0, is_hidden ? 1 : 0, id, req.organizationId], function(err) {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      res.json({ success: true });
    });
});

// Admin: Moderate praise report
app.put('/api/admin/praise-report/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  const { is_approved, is_hidden } = req.body;
  
  dbQuery.run(`UPDATE ct_praise_reports SET is_approved = $1, is_hidden = $2 WHERE id = $3 AND organization_id = $4`,
    [is_approved ? 1 : 0, is_hidden ? 1 : 0, id, req.organizationId], function(err) {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      res.json({ success: true });
    });
});

// Admin: Delete prayer request
app.delete('/api/admin/prayer-request/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  
  // Delete interactions first
  dbQuery.run(`DELETE FROM ct_prayer_interactions WHERE prayer_request_id = $1`, [id], (err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    // Delete prayer request (only from this organization)
    dbQuery.run(`DELETE FROM ct_prayer_requests WHERE id = $1 AND organization_id = $2`, [id, req.organizationId], function(err) {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      res.json({ success: true });
    });
  });
});

// Admin: Delete praise report
app.delete('/api/admin/praise-report/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  
  // Delete interactions first
  dbQuery.run(`DELETE FROM ct_celebration_interactions WHERE praise_report_id = $1`, [id], (err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    // Delete praise report (only from this organization)
    dbQuery.run(`DELETE FROM ct_praise_reports WHERE id = $1 AND organization_id = $2`, [id, req.organizationId], function(err) {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      res.json({ success: true });
    });
  });
});

// Admin: Moderate verse insight
app.put('/api/admin/verse-insight/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  const { is_approved, is_hidden } = req.body;
  
  dbQuery.run(`UPDATE ct_verse_community_posts SET is_approved = $1, is_hidden = $2 WHERE id = $3 AND organization_id = $4`,
    [is_approved ? 1 : 0, is_hidden ? 1 : 0, id, req.organizationId], function(err) {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      res.json({ success: true });
    });
});

// Admin: Delete verse insight
app.delete('/api/admin/verse-insight/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  
  // Delete verse insight (only from this organization)
  dbQuery.run(`DELETE FROM ct_verse_community_posts WHERE id = $1 AND organization_id = $2`, [id, req.organizationId], function(err) {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    res.json({ success: true });
  });
});

// VERSE COMMUNITY WALL ENDPOINTS

// Submit community post for today's verse
app.post('/api/verse-community', (req, res) => {
  const { content, verse_reference, user_token, date } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  const today = date || new Date().toISOString().split('T')[0];
  const orgId = req.organizationId || 1;
  
  if (!content || content.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Post content is required' });
  }
  
  if (content.length > 500) {
    return res.status(400).json({ success: false, error: 'Post too long (max 500 characters)' });
  }
  
  if (!verse_reference) {
    return res.status(400).json({ success: false, error: 'Verse reference is required' });
  }
  
  dbQuery.run(`
    INSERT INTO ct_verse_community_posts (verse_reference, date, content, author_name, user_token, ip_address, organization_id, is_approved) 
    VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)
  `, [verse_reference, today, content.trim(), 'Anonymous', user_token, ip, orgId], function(err) {
    if (err) {
      console.error('Error submitting verse community post:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    res.json({ success: true, post_id: this.lastID });
  });
});

// Heart/like a community post
app.post('/api/verse-community/heart', (req, res) => {
  const { post_id, user_token } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  const orgId = req.organizationId || 1;
  
  if (!post_id || !user_token) {
    return res.status(400).json({ success: false, error: 'Post ID and user token are required' });
  }
  
  // Check if user already hearted this post
  dbQuery.get(`
    SELECT id FROM ct_verse_community_interactions 
    WHERE post_id = $1 AND user_token = $2
  `, [post_id, user_token], (err, row) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    if (row) {
      return res.status(400).json({ success: false, error: 'You have already hearted this post' });
    }
    
    // Add interaction
    dbQuery.run(`
      INSERT INTO ct_verse_community_interactions (post_id, user_token, ip_address) 
      VALUES (?, ?, ?)
    `, [post_id, user_token, ip], function(err) {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      // Update heart count
      dbQuery.run(`
        UPDATE ct_verse_community_posts SET heart_count = heart_count + 1 WHERE id = ?
      `, [post_id], (err) => {
        if (err) {
          return res.status(500).json({ success: false, error: 'Database error' });
        }
        
        // Get updated count
        dbQuery.get(`
          SELECT heart_count FROM ct_verse_community_posts WHERE id = ?
        `, [post_id], (err, row) => {
          if (err) {
            return res.status(500).json({ success: false, error: 'Database error' });
          }
          
          res.json({ success: true, heart_count: row?.heart_count || 0 });
        });
      });
    });
  });
});

// Admin: Get verse community posts for moderation
app.get('/api/admin/verse-community', requireOrgAuth, (req, res) => {
  const { days = 7 } = req.query;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];
  
  dbQuery.all(`
    SELECT * FROM ct_verse_community_posts 
    WHERE date >= $1 AND organization_id = $2 
    ORDER BY date DESC, created_at DESC
  `, [startDateStr, req.organizationId], (err, rows) => {
    if (err) {
      console.error('Error fetching admin verse community posts:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    res.json({
      success: true,
      posts: rows || []
    });
  });
});

// Admin: Moderate verse community post
app.put('/api/admin/verse-community/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  const { is_approved, is_hidden } = req.body;
  
  dbQuery.run(`
    UPDATE ct_verse_community_posts SET is_approved = $1, is_hidden = $2 
    WHERE id = $3 AND organization_id = $4
  `, [is_approved ? 1 : 0, is_hidden ? 1 : 0, id, req.organizationId], function(err) {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    res.json({ success: true });
  });
});

// Admin: Delete verse community post
app.delete('/api/admin/verse-community/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  
  if (!id || isNaN(id)) {
    return res.status(400).json({ success: false, error: 'Invalid post ID' });
  }
  
  // Delete post (only from this organization)
  dbQuery.run(`
    DELETE FROM ct_verse_community_posts WHERE id = $1 AND organization_id = $2
  `, [id, req.organizationId], function(err) {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    res.json({ success: true });
  });
});

// STRONG'S NUMBERS ENDPOINTS

// Get verse with Strong's numbers (KJV only)
app.get('/api/strongs/:book/:chapter/:verse', trackAnalytics('strongs_view'), async (req, res) => {
  const { book, chapter, verse } = req.params;
  
  try {
    // Use bolls.life KJV API which includes Strong's numbers
    const apiUrl = `https://bolls.life/get-verse/KJV/${book}/${chapter}/${verse}/`;
    console.log('Fetching Strong\'s verse from bolls.life:', apiUrl);
    
    const response = await fetch(apiUrl);
    
    if (response.ok) {
      const data = await response.json();
      res.json({
        success: true,
        verse: data.text || data.verse_text,
        reference: `${data.book_name || ''} ${chapter}:${verse}`
      });
    } else {
      res.status(404).json({ success: false, error: 'Verse not found' });
    }
  } catch (error) {
    console.error('Error fetching Strong\'s verse:', error);
    res.status(500).json({ success: false, error: 'API error' });
  }
});

// Get Strong's number definition
app.get('/api/strongs/definition/:number', trackAnalytics('strongs_definition'), async (req, res) => {
  const { number } = req.params;
  
  // First check if we have it cached
  dbQuery.get(`
    SELECT * FROM ct_strongs_references WHERE strongs_number = ?
  `, [number], async (err, row) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    if (row) {
      // Return cached definition
      return res.json({
        success: true,
        definition: {
          number: row.strongs_number,
          language: row.language,
          transliteration: row.transliteration,
          phonetics: row.phonetics,
          definition: row.definition,
          short_definition: row.short_definition,
          outline: row.outline_of_biblical_usage,
          kjv_occurrences: row.total_kjv_occurrences
        }
      });
    }
    
    // If not cached, fetch from bolls.life dictionary API
    try {
      const dictApiUrl = `https://bolls.life/dictionary-definition/BDBT/${number}/`;
      console.log('Fetching Strong\'s definition from bolls.life:', dictApiUrl);
      
      const response = await fetch(dictApiUrl);
      
      if (response.ok) {
        const definitions = await response.json();
        
        if (definitions && definitions.length > 0) {
          // Take the first definition (usually the most relevant)
          const def = definitions[0];
          
          const definitionData = {
            number: def.topic || number,
            language: number.startsWith('H') ? 'Hebrew' : 'Greek',
            transliteration: def.transliteration || '',
            phonetics: def.pronunciation || '',
            definition: def.definition ? def.definition.replace(/<[^>]*>/g, '') : 'No definition available', // Strip HTML
            short_definition: def.short_definition || '',
            outline: def.lexeme || '',
            kjv_occurrences: 0
          };
          
          // Cache the definition for future use
          dbQuery.run(`
            INSERT INTO ct_strongs_references 
            (strongs_number, language, transliteration, phonetics, definition, short_definition, outline_of_biblical_usage, total_kjv_occurrences) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (strongs_number) DO UPDATE SET
            language = EXCLUDED.language,
            transliteration = EXCLUDED.transliteration,
            phonetics = EXCLUDED.phonetics,
            definition = EXCLUDED.definition,
            short_definition = EXCLUDED.short_definition,
            outline_of_biblical_usage = EXCLUDED.outline_of_biblical_usage,
            total_kjv_occurrences = EXCLUDED.total_kjv_occurrences,
            updated_at = NOW()
          `, [
            definitionData.number,
            definitionData.language,
            definitionData.transliteration,
            definitionData.phonetics,
            definitionData.definition,
            definitionData.short_definition,
            definitionData.outline,
            definitionData.kjv_occurrences
          ], (cacheErr) => {
            if (cacheErr) {
              console.log('Warning: Could not cache Strong\'s definition:', cacheErr);
            }
          });
          
          return res.json({
            success: true,
            definition: definitionData
          });
        }
      }
      
      // Fallback if API fails or no definitions found
      res.json({
        success: true,
        definition: {
          number: number,
          language: number.startsWith('H') ? 'Hebrew' : 'Greek',
          transliteration: 'Not available',
          definition: 'Definition not found in dictionary.',
          short_definition: 'No definition available',
          outline: '',
          kjv_occurrences: 0
        }
      });
      
    } catch (error) {
      console.error('Error fetching Strong\'s definition:', error);
      
      // Fallback response
      res.json({
        success: true,
        definition: {
          number: number,
          language: number.startsWith('H') ? 'Hebrew' : 'Greek',
          transliteration: 'Not available',
          definition: 'Error fetching definition. Please try again.',
          short_definition: 'Error loading definition',
          outline: '',
          kjv_occurrences: 0
        }
      });
    }
  });
});

// User Authentication Middleware
const authenticateUser = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '') || req.cookies?.authToken;
  
  if (!token) {
    return res.status(401).json({ success: false, error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Invalid token.' });
  }
};

// USER AUTHENTICATION ROUTES

// User registration
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName, displayName } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }

    // Check if user already exists
    dbQuery.get(`SELECT id FROM ct_users WHERE email = $1`, [email.toLowerCase()], async (err, existingUser) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }

      if (existingUser) {
        return res.status(400).json({ success: false, error: 'User already exists with this email' });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 12);
      const verificationToken = crypto.randomBytes(32).toString('hex');

      // Create user
      dbQuery.run(`INSERT INTO ct_users (email, password_hash, first_name, last_name, display_name, verification_token) 
              VALUES (?, ?, ?, ?, ?, ?)`,
        [email.toLowerCase(), passwordHash, firstName, lastName, displayName, verificationToken],
        function(err) {
          if (err) {
            return res.status(500).json({ success: false, error: 'Failed to create user' });
          }

          const userId = this.lastID;

          // Create default user preferences
          dbQuery.run(`INSERT INTO ct_user_preferences (user_id) VALUES (?)`, [userId], (err) => {
            if (err) {
              console.error('Error creating user preferences:', err);
            }
          });

          // Generate JWT token
          const token = jwt.sign(
            { userId: userId, email: email.toLowerCase() },
            JWT_SECRET,
            { expiresIn: '30d' }
          );

          // Set cookie
          res.cookie('authToken', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
          });

          res.json({
            success: true,
            user: {
              id: userId,
              email: email.toLowerCase(),
              firstName,
              lastName,
              displayName,
              isVerified: false
            },
            token,
            requiresOnboarding: true
          });
        });
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// User login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    // Find user
    dbQuery.get(`SELECT * FROM ct_users WHERE email = $1`, [email.toLowerCase()], async (err, user) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }

      if (!user) {
        return res.status(401).json({ success: false, error: 'Invalid email or password' });
      }

      // Check password
      const isMatch = await bcrypt.compare(password, user.password_hash);
      if (!isMatch) {
        return res.status(401).json({ success: false, error: 'Invalid email or password' });
      }

      // Update last login
      dbQuery.run(`UPDATE ct_users SET last_login = CURRENT_TIMESTAMP WHERE id = $1`, [user.id]);

      // Generate JWT token
      const token = jwt.sign(
        { userId: user.id, email: user.email },
        JWT_SECRET,
        { expiresIn: '30d' }
      );

      // Set cookie
      res.cookie('authToken', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
      });

      // Check if user has completed onboarding
      dbQuery.get(`SELECT * FROM ct_user_preferences WHERE user_id = $1`, [user.id], (err, prefs) => {
        const requiresOnboarding = !prefs || (!prefs.interests && !prefs.life_stage);

        res.json({
          success: true,
          user: {
            id: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            displayName: user.display_name,
            isVerified: user.is_verified
          },
          token,
          requiresOnboarding
        });
      });
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// User logout
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('authToken');
  res.json({ success: true, message: 'Logged out successfully' });
});

// Get current user
app.get('/api/auth/me', authenticateUser, (req, res) => {
  dbQuery.get(`SELECT u.*, p.* FROM ct_users u 
          LEFT JOIN ct_user_preferences p ON u.id = p.user_id 
          WHERE u.id = $1`, [req.user.userId], (err, user) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        displayName: user.display_name,
        isVerified: user.is_verified,
        preferences: {
          lifeStage: user.life_stage,
          interests: user.interests ? JSON.parse(user.interests) : [],
          struggles: user.struggles ? JSON.parse(user.struggles) : [],
          prayerFrequency: user.prayer_frequency,
          preferredTranslation: user.preferred_translation,
          notificationEnabled: user.notification_enabled,
          notificationTime: user.notification_time,
          timezone: user.timezone
        }
      }
    });
  });
});

// User onboarding - save preferences
app.post('/api/auth/onboarding', authenticateUser, (req, res) => {
  const { lifeStage, interests, struggles, prayerFrequency, preferredTranslation } = req.body;

  const interestsJson = JSON.stringify(interests || []);
  const strugglesJson = JSON.stringify(struggles || []);

  dbQuery.run(`UPDATE ct_user_preferences SET 
          life_stage = $1, interests = $2, struggles = $3, prayer_frequency = $4, preferred_translation = $5, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = $6`,
    [lifeStage, interestsJson, strugglesJson, prayerFrequency, preferredTranslation, req.user.userId],
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, error: 'Failed to save preferences' });
      }

      res.json({ success: true, message: 'Onboarding completed successfully' });
    });
});

// Update user profile
app.put('/api/auth/profile', authenticateUser, (req, res) => {
  const { firstName, lastName, displayName, phone, dateOfBirth } = req.body;

  dbQuery.run(`UPDATE ct_users SET 
          first_name = $1, last_name = $2, display_name = $3, phone = $4, date_of_birth = $5, updated_at = CURRENT_TIMESTAMP
          WHERE id = $6`,
    [firstName, lastName, displayName, phone, dateOfBirth, req.user.userId],
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, error: 'Failed to update profile' });
      }

      res.json({ success: true, message: 'Profile updated successfully' });
    });
});

// Update user preferences
app.put('/api/auth/preferences', authenticateUser, (req, res) => {
  const { 
    lifeStage, interests, struggles, prayerFrequency, preferredTranslation,
    notificationEnabled, notificationTime, timezone 
  } = req.body;

  const interestsJson = JSON.stringify(interests || []);
  const strugglesJson = JSON.stringify(struggles || []);

  dbQuery.run(`UPDATE ct_user_preferences SET 
          life_stage = $1, interests = $2, struggles = $3, prayer_frequency = $4, preferred_translation = $5,
          notification_enabled = $6, notification_time = $7, timezone = $8, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = $9`,
    [lifeStage, interestsJson, strugglesJson, prayerFrequency, preferredTranslation,
     notificationEnabled, notificationTime, timezone, req.user.userId],
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, error: 'Failed to update preferences' });
      }

      res.json({ success: true, message: 'Preferences updated successfully' });
    });
});

// Get analytics data (admin)
app.get('/api/admin/analytics', requireOrgAuth, (req, res) => {
  const { days = 7 } = req.query;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  // Get daily view counts
  dbQuery.all(`
    SELECT 
      DATE(timestamp) as date,
      COUNT(*) as views,
      COUNT(DISTINCT ip_address) as unique_visitors
    FROM ct_analytics 
    WHERE action = 'verse_view' AND timestamp >= $1 AND organization_id = $2
    GROUP BY DATE(timestamp)
    ORDER BY date DESC
  `, [startDate.toISOString(), req.organizationId], (err, dailyStats) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    // Get most viewed verses
    dbQuery.all(`
      SELECT 
        v.id,
        v.date,
        v.bible_reference,
        v.verse_text,
        COUNT(a.id) as views
      FROM ct_verses v
      LEFT JOIN ct_analytics a ON v.id = a.verse_id AND a.action = 'verse_view'
      WHERE a.timestamp >= $1 AND v.organization_id = $2 AND a.organization_id = $3
      GROUP BY v.id
      ORDER BY views DESC
      LIMIT 10
    `, [startDate.toISOString(), req.organizationId, req.organizationId], (err, topVerses) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      res.json({ 
        success: true, 
        analytics: {
          daily_stats: dailyStats,
          top_verses: topVerses
        }
      });
    });
  });
});

// MASTER ADMIN: Create an admin user for an organization
app.post('/api/master/organizations/:id/admins', requireMasterAuth, async (req, res) => {
  const { id } = req.params;
  const { username, password, email, role = 'admin' } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required' });
  }

  // Ensure organization exists
  dbQuery.get(`SELECT id FROM ct_organizations WHERE id = $1`, [id], async (err, org) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    if (!org) {
      return res.status(404).json({ success: false, error: 'Organization not found' });
    }

    // Ensure username unique
    dbQuery.get(`SELECT id FROM ct_admin_users WHERE username = $1`, [username], async (err, existing) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      if (existing) {
        return res.status(400).json({ success: false, error: 'Username already exists' });
      }

      try {
        const passwordHash = await bcrypt.hash(password, 12);
        dbQuery.run(
          `INSERT INTO ct_admin_users (username, password_hash, email, role, organization_id, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [username, passwordHash, email || null, role, id, true],
          function(insertErr) {
            if (insertErr) {
              console.error('Admin creation error:', insertErr);
              return res.status(500).json({ success: false, error: 'Failed to create admin user' });
            }
            res.json({ success: true, admin_id: this.lastID });
          }
        );
      } catch (hashErr) {
        return res.status(500).json({ success: false, error: 'Failed to process password' });
      }
    });
  });
});

// =============================
// NFC TAG MANAGEMENT ENDPOINTS
// =============================

// Get all NFC tags (with optional filters)
app.get('/api/master/nfc-tags', requireMasterAuth, (req, res) => {
  const { status, organization_id, batch_name } = req.query;
  
  let sql = `
    SELECT nt.*, o.name as organization_name, o.subdomain, au.username as assigned_by_username
    FROM ct_nfc_tags nt
    LEFT JOIN ct_organizations o ON nt.organization_id = o.id
    LEFT JOIN ct_admin_users au ON nt.assigned_by = au.id
    WHERE 1=1
  `;
  const params = [];
  let paramIndex = 1;
  
  if (status) {
    sql += ` AND nt.status = $${paramIndex++}`;
    params.push(status);
  }
  
  if (organization_id) {
    sql += ` AND nt.organization_id = $${paramIndex++}`;
    params.push(organization_id);
  }
  
  if (batch_name) {
    sql += ` AND nt.batch_name = $${paramIndex++}`;
    params.push(batch_name);
  }
  
  sql += ` ORDER BY nt.created_at DESC`;
  
  db.query(sql, params, (err, result) => {
    if (err) {
      console.error('Error fetching NFC tags:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    res.json({ success: true, tags: result.rows || [] });
  });
});

// Create new NFC tag
app.post('/api/master/nfc-tags', requireMasterAuth, (req, res) => {
  const { custom_id, batch_name, notes } = req.body;
  
  if (!custom_id) {
    return res.status(400).json({ success: false, error: 'Custom ID is required' });
  }
  
  db.query(`
    INSERT INTO ct_nfc_tags (custom_id, batch_name, notes, assigned_by, status)
    VALUES ($1, $2, $3, $4, 'available')
    RETURNING id
  `, [custom_id, batch_name || null, notes || null, req.session.masterAdminId], 
  (err, result) => {
    if (err) {
      if (err.code === '23505') { // Unique constraint in PostgreSQL
        return res.status(400).json({ success: false, error: 'Custom ID already exists' });
      }
      console.error('Create NFC tag error:', err);
      return res.status(500).json({ success: false, error: 'Failed to create NFC tag' });
    }
    
    res.json({ success: true, tag_id: result.rows[0].id });
  });
});

// Bulk create NFC tags
app.post('/api/master/nfc-tags/bulk', requireMasterAuth, (req, res) => {
  const { batch_name, count, prefix, notes } = req.body;
  
  if (!batch_name || !count || count <= 0 || count > 1000) {
    return res.status(400).json({ success: false, error: 'Valid batch name and count (1-1000) are required' });
  }
  
  // Create the VALUES clause for bulk insert
  const values = [];
  const params = [];
  let paramIndex = 1;
  
  for (let i = 1; i <= count; i++) {
    const paddedNum = i.toString().padStart(3, '0');
    const custom_id = `${prefix || batch_name}-${paddedNum}`;
    
    values.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, 'available')`);
    params.push(custom_id, batch_name, notes || null, req.session.masterAdminId);
  }
  
  db.query(`
    INSERT INTO ct_nfc_tags (custom_id, batch_name, notes, assigned_by, status)
    VALUES ${values.join(', ')}
  `, params, (err, result) => {
    if (err) {
      console.error('Bulk insert error:', err);
      return res.status(500).json({ success: false, error: 'Failed to create NFC tags' });
    }
    
    res.json({ success: true, created_count: count });
  });
});

// Assign NFC tag to organization
app.put('/api/master/nfc-tags/:id/assign', requireMasterAuth, (req, res) => {
  const { id } = req.params;
  const { organization_id, nfc_id } = req.body;
  
  if (!organization_id) {
    return res.status(400).json({ success: false, error: 'Organization ID is required' });
  }
  
  // Verify organization exists and get subdomain and tag custom_id for URL generation
  db.query(`SELECT id, subdomain FROM ct_organizations WHERE id = $1`, [organization_id], (err, orgResult) => {
    if (err) {
      console.error('Organization check error:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    if (orgResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Organization not found' });
    }
    
    const organization = orgResult.rows[0];
    
    // Get the tag's custom_id for URL generation
    db.query(`SELECT custom_id FROM ct_nfc_tags WHERE id = $1`, [id], (err, tagResult) => {
      if (err) {
        console.error('Tag lookup error:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      if (tagResult.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'NFC tag not found' });
      }
      
      const tag = tagResult.rows[0];
      
      // Update the NFC tag
      db.query(`
        UPDATE ct_nfc_tags SET 
          organization_id = $1, 
          status = 'assigned',
          assigned_by = $2,
          assigned_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 AND status IN ('available', 'inactive')
    `, [organization_id, req.session.masterAdminId, id], 
    (err, result) => {
      if (err) {
        console.error('Assign NFC tag error:', err);
        return res.status(500).json({ success: false, error: 'Failed to assign NFC tag' });
      }
      
      if (result.rowCount === 0) {
        return res.status(404).json({ success: false, error: 'NFC tag not found or cannot be assigned' });
      }
      
      res.json({ success: true });
    });
    });
  });
});


// Update NFC tag status
app.put('/api/master/nfc-tags/:id/status', requireMasterAuth, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  const validStatuses = ['available', 'assigned', 'active', 'inactive', 'lost'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid status' });
  }
  
  db.query(`
    UPDATE ct_nfc_tags SET 
      status = $1,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
  `, [status, id], 
  (err, result) => {
    if (err) {
      console.error('Update NFC tag status error:', err);
      return res.status(500).json({ success: false, error: 'Failed to update NFC tag status' });
    }
    
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'NFC tag not found' });
    }
    
    res.json({ success: true });
  });
});

// Record NFC tag scan
app.post('/api/nfc-tags/scan/:custom_id', (req, res) => {
  const { custom_id } = req.params;
  
  db.query(`
    UPDATE ct_nfc_tags SET 
      last_scanned_at = CURRENT_TIMESTAMP,
      scan_count = scan_count + 1,
      updated_at = CURRENT_TIMESTAMP
    WHERE custom_id = $1
  `, [custom_id], 
  (err, result) => {
    if (err) {
      console.error('Error recording NFC scan:', err);
      return res.status(500).json({ success: false, error: 'Failed to record scan' });
    }
    
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'NFC tag not found' });
    }
    
    // Get tag info including organization details
    db.query(`
      SELECT nt.*, o.subdomain, o.custom_domain
      FROM ct_nfc_tags nt
      LEFT JOIN ct_organizations o ON nt.organization_id = o.id
      WHERE nt.custom_id = $1
    `, [custom_id], (err, tagResult) => {
      if (err || tagResult.rows.length === 0) {
        return res.json({ success: true }); // Still record the scan even if we can't get details
      }
      
      const tag = tagResult.rows[0];
      // Return redirect information if assigned to an organization
      if (tag.organization_id && tag.subdomain) {
        const baseUrl = tag.custom_domain || `${tag.subdomain}.churchtap.app`;
        return res.json({ 
          success: true, 
          redirect_url: `https://${baseUrl}`,
          organization: tag.subdomain
        });
      }
      
      res.json({ success: true });
    });
  });
});


// Delete NFC tag
app.delete('/api/master/nfc-tags/:id', requireMasterAuth, (req, res) => {
  const { id } = req.params;
  
  db.query(`DELETE FROM ct_nfc_tags WHERE id = $1`, [id], (err, result) => {
    if (err) {
      console.error('Delete NFC tag error:', err);
      return res.status(500).json({ success: false, error: 'Failed to delete NFC tag' });
    }
    
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'NFC tag not found' });
    }
    
    res.json({ success: true });
  });
});

// Get available batch names
app.get('/api/master/nfc-tags/batches', requireMasterAuth, (req, res) => {
  db.query(`
    SELECT batch_name, COUNT(*) as tag_count, 
           SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available_count
    FROM ct_nfc_tags 
    WHERE batch_name IS NOT NULL 
    GROUP BY batch_name 
    ORDER BY batch_name
  `, [], (err, result) => {
    if (err) {
      console.error('Get batch names error:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    res.json({ success: true, batches: result.rows || [] });
  });
});

// Analytics API endpoints
app.get('/api/master/analytics/map-data', requireMasterAuth, (req, res) => {
  const { timeframe = '7d', organization_id } = req.query;
  
  let timeFilter = '';
  switch(timeframe) {
    case '24h':
      timeFilter = "AND created_at >= NOW() - INTERVAL '24 hours'";
      break;
    case '7d':
      timeFilter = "AND created_at >= NOW() - INTERVAL '7 days'";
      break;
    case '30d':
      timeFilter = "AND created_at >= NOW() - INTERVAL '30 days'";
      break;
    case '90d':
      timeFilter = "AND created_at >= NOW() - INTERVAL '90 days'";
      break;
  }

  let orgFilter = organization_id ? 'AND organization_id = $1' : '';
  let params = organization_id ? [organization_id] : [];

  dbQuery.all(`
    SELECT 
      country,
      city,
      latitude,
      longitude,
      COUNT(*) as session_count,
      SUM(total_interactions) as total_interactions,
      COUNT(DISTINCT ip_address) as unique_ips
    FROM anonymous_sessions 
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    ${timeFilter} ${orgFilter}
    GROUP BY country, city, latitude, longitude
    ORDER BY session_count DESC
  `, params, (err, rows) => {
    if (err) {
      console.error('Map data error:', err);
      return res.status(500).json({ success: false, error: 'Failed to get map data' });
    }
    
    res.json({ success: true, locations: rows || [] });
  });
});

// Get global analytics stats for master dashboard
app.get('/api/master/analytics/stats', requireMasterAuth, (req, res) => {
  const { timeframe = '7d', organization_id } = req.query;
  
  let timeFilter = '';
  switch(timeframe) {
    case '24h':
      timeFilter = "AND created_at >= NOW() - INTERVAL '24 hours'";
      break;
    case '7d':
      timeFilter = "AND created_at >= NOW() - INTERVAL '7 days'";
      break;
    case '30d':
      timeFilter = "AND created_at >= NOW() - INTERVAL '30 days'";
      break;
    case '90d':
      timeFilter = "AND created_at >= NOW() - INTERVAL '90 days'";
      break;
  }
  
  let orgFilter = '';
  let params = [];
  if (organization_id) {
    orgFilter = 'AND organization_id = $1';
    params = [organization_id];
  }

  Promise.all([
    // Total scans
    new Promise((resolve, reject) => {
      const { sql: totalScansSql, params: totalScansParams } = convertQueryParams(
        `SELECT COUNT(*) as count FROM tag_interactions WHERE 1=1 ${timeFilter.replace('created_at', 'tag_interactions.created_at')} ${orgFilter}`, params
      );
      db.query(totalScansSql, totalScansParams, (err, result) => {
        if (err) reject(err);
        else resolve(result.rows[0]?.count || 0);
      });
    }),
    
    // Unique tags
    new Promise((resolve, reject) => {
      const { sql: uniqueTagsSql, params: uniqueTagsParams } = convertQueryParams(
        `SELECT COUNT(DISTINCT tag_id) as count FROM tag_interactions WHERE 1=1 ${timeFilter.replace('created_at', 'tag_interactions.created_at')} ${orgFilter}`, params
      );
      db.query(uniqueTagsSql, uniqueTagsParams, (err, result) => {
        if (err) reject(err);
        else resolve(result.rows[0]?.count || 0);
      });
    }),
    
    // Active sessions
    new Promise((resolve, reject) => {
      const { sql: sessionsSql, params: sessionsParams } = convertQueryParams(
        `SELECT COUNT(DISTINCT session_id) as count FROM tag_interactions WHERE 1=1 ${timeFilter.replace('created_at', 'tag_interactions.created_at')} ${orgFilter}`, params
      );
      db.query(sessionsSql, sessionsParams, (err, result) => {
        if (err) reject(err);
        else resolve(result.rows[0]?.count || 0);
      });
    }),
    
    // Unique countries
    new Promise((resolve, reject) => {
      const { sql: countriesSql, params: countriesParams } = convertQueryParams(
        `SELECT COUNT(DISTINCT s.country) as count FROM anonymous_sessions s 
         INNER JOIN tag_interactions t ON s.session_id = t.session_id 
         WHERE s.country IS NOT NULL AND s.country != 'Local' ${timeFilter.replace('created_at', 't.created_at')} ${orgFilter.replace('organization_id', 't.organization_id')}`, params
      );
      db.query(countriesSql, countriesParams, (err, result) => {
        if (err) reject(err);
        else resolve(result.rows[0]?.count || 0);
      });
    })
  ]).then(([totalScans, uniqueTags, activeSessions, uniqueCountries]) => {
    res.json({
      success: true,
      stats: {
        totalScans,
        uniqueTags,
        activeSessions,
        uniqueCountries
      }
    });
  }).catch(error => {
    console.error('Analytics stats error:', error);
    res.status(500).json({ success: false, error: 'Failed to get analytics stats' });
  });
});

// Get tag activities for master dashboard
app.get('/api/master/analytics/tag-activities', requireMasterAuth, (req, res) => {
  const { timeframe = '7d', organization_id, tag_id, limit = 50, offset = 0 } = req.query;
  
  let timeFilter = '';
  switch(timeframe) {
    case '24h':
      timeFilter = "AND t.created_at >= NOW() - INTERVAL '24 hours'";
      break;
    case '7d':
      timeFilter = "AND t.created_at >= NOW() - INTERVAL '7 days'";
      break;
    case '30d':
      timeFilter = "AND t.created_at >= NOW() - INTERVAL '30 days'";
      break;
    case '90d':
      timeFilter = "AND t.created_at >= NOW() - INTERVAL '90 days'";
      break;
  }

  let orgFilter = organization_id ? 'AND t.organization_id = ?' : '';
  let tagFilter = tag_id ? 'AND t.tag_id LIKE ?' : '';
  
  let params = [];
  if (organization_id) params.push(organization_id);
  if (tag_id) params.push(`%${tag_id}%`);
  params.push(parseInt(limit));
  params.push(parseInt(offset));

  dbQuery.all(`
    SELECT 
      t.id,
      t.session_id,
      t.tag_id,
      t.interaction_type,
      t.page_url,
      t.referrer,
      t.created_at,
      s.ip_address,
      s.country,
      s.city,
      s.latitude,
      s.longitude,
      o.name as organization_name,
      o.subdomain,
      -- Count follow-up activities (simplified for now)
      0 as prayer_count,
      0 as praise_count,
      0 as insight_count
    FROM tag_interactions t
    LEFT JOIN anonymous_sessions s ON t.session_id = s.session_id
    LEFT JOIN ct_organizations o ON t.organization_id = o.id
    WHERE 1=1 ${timeFilter} ${orgFilter} ${tagFilter}
    ORDER BY t.created_at DESC
    LIMIT ? OFFSET ?
  `, params, (err, rows) => {
    if (err) {
      console.error('Tag activities error:', err);
      return res.status(500).json({ success: false, error: 'Failed to get tag activities' });
    }
    
    // Get total count for pagination
    let countParams = [];
    if (organization_id) countParams.push(organization_id);
    if (tag_id) countParams.push(`%${tag_id}%`);
    
    dbQuery.get(`
      SELECT COUNT(*) as total
      FROM tag_interactions t
      WHERE 1=1 ${timeFilter} ${orgFilter} ${tagFilter}
    `, countParams, (countErr, countResult) => {
      if (countErr) {
        console.error('Tag activities count error:', countErr);
        return res.status(500).json({ success: false, error: 'Failed to get count' });
      }
      
      res.json({ 
        success: true, 
        activities: rows || [], 
        total: countResult?.total || 0,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: (parseInt(offset) + parseInt(limit)) < (countResult?.total || 0)
        }
      });
    });
  });
});

// Get tag activities statistics for master dashboard
app.get('/api/master/analytics/tag-activities/stats', requireMasterAuth, (req, res) => {
  const { timeframe = '7d', organization_id } = req.query;
  
  let timeFilter = '';
  switch(timeframe) {
    case '24h':
      timeFilter = "AND created_at >= NOW() - INTERVAL '24 hours'";
      break;
    case '7d':
      timeFilter = "AND created_at >= NOW() - INTERVAL '7 days'";
      break;
    case '30d':
      timeFilter = "AND created_at >= NOW() - INTERVAL '30 days'";
      break;
    case '90d':
      timeFilter = "AND created_at >= NOW() - INTERVAL '90 days'";
      break;
  }

  let orgFilter = organization_id ? 'AND organization_id = ?' : '';
  let params = organization_id ? [organization_id] : [];

  // Get multiple stats in parallel
  Promise.all([
    // Total scans
    new Promise((resolve, reject) => {
      dbQuery.get(`SELECT COUNT(*) as count FROM tag_interactions WHERE 1=1 ${timeFilter} ${orgFilter}`, params, (err, row) => {
        if (err) reject(err);
        else resolve(row?.count || 0);
      });
    }),
    
    // Unique tags
    new Promise((resolve, reject) => {
      dbQuery.get(`SELECT COUNT(DISTINCT tag_id) as count FROM tag_interactions WHERE 1=1 ${timeFilter} ${orgFilter}`, params, (err, row) => {
        if (err) reject(err);
        else resolve(row?.count || 0);
      });
    }),
    
    // Active sessions
    new Promise((resolve, reject) => {
      dbQuery.get(`SELECT COUNT(DISTINCT session_id) as count FROM tag_interactions WHERE 1=1 ${timeFilter} ${orgFilter}`, params, (err, row) => {
        if (err) reject(err);
        else resolve(row?.count || 0);
      });
    }),
    
    // Follow-up activities from actual tables
    new Promise((resolve, reject) => {
      const interval = timeframe === '24h' ? '24 hours' : timeframe === '7d' ? '7 days' : timeframe === '30d' ? '30 days' : '90 days';
      dbQuery.get(`
        SELECT 
          (SELECT COUNT(*) FROM ct_prayer_requests WHERE created_at >= NOW() - INTERVAL '${interval}') +
          (SELECT COUNT(*) FROM ct_praise_reports WHERE created_at >= NOW() - INTERVAL '${interval}') +
          (SELECT COUNT(*) FROM ct_verse_community_posts WHERE created_at >= NOW() - INTERVAL '${interval}') as count
      `, [], (err, row) => {
        if (err) reject(err);
        else resolve(row?.count || 0);
      });
    })
  ]).then(([totalScans, uniqueTags, activeSessions, followupActivities]) => {
    res.json({
      success: true,
      stats: {
        totalScans,
        uniqueTags,
        activeSessions,
        followupActivities
      }
    });
  }).catch(error => {
    console.error('Tag activities stats error:', error);
    res.status(500).json({ success: false, error: 'Failed to get stats' });
  });
});

// Get session details by session_id
app.get('/api/master/analytics/session-details/:sessionId', requireMasterAuth, (req, res) => {
  const { sessionId } = req.params;
  
  console.log('🔍 Getting session details for:', sessionId);
  
  // Get session data with all related information
  Promise.all([
    // Basic session info and tag interactions
    new Promise((resolve, reject) => {
      const { sql, params } = convertQueryParams(`
        SELECT 
          ti.tag_id,
          ti.organization_id,
          ti.ip_address,
          ti.user_agent,
          ti.created_at as scan_time,
          s.first_seen_at as session_start,
          s.last_seen_at as last_activity,
          s.total_interactions,
          s.country,
          s.region,
          s.city,
          s.latitude,
          s.longitude,
          o.name as organization_name
        FROM tag_interactions ti
        LEFT JOIN anonymous_sessions s ON s.session_id = ti.session_id
        LEFT JOIN ct_organizations o ON ti.organization_id = o.id
        WHERE ti.session_id = $1
        ORDER BY ti.created_at DESC
      `, [sessionId]);
      
      db.query(sql, params, (err, result) => {
        if (err) reject(err);
        else resolve(result.rows);
      });
    }),
    
    // Analytics data - simplified for now (no analytics table exists)
    new Promise((resolve, reject) => {
      resolve([]);
    }),
    
    // Prayer requests - simplified (no session_id tracking)
    new Promise((resolve, reject) => {
      resolve([]);
    }),
    
    // Praise reports - simplified (no session_id tracking)  
    new Promise((resolve, reject) => {
      resolve([]);
    }),
    
    // Community posts/insights - simplified (no session_id tracking)
    new Promise((resolve, reject) => {
      resolve([]);
    })
  ]).then(([sessionInfo, analytics, prayerRequests, praiseReports, insights]) => {
    
    // Parse geolocation if available
    let location = null;
    if (sessionInfo.length > 0 && sessionInfo[0].geolocation) {
      try {
        location = JSON.parse(sessionInfo[0].geolocation);
      } catch (e) {
        console.error('Error parsing geolocation:', e);
      }
    }
    
    // Parse user agent for device info
    let deviceInfo = {
      browser: 'Unknown',
      os: 'Unknown',
      device: 'Unknown'
    };
    
    if (sessionInfo.length > 0 && sessionInfo[0].user_agent) {
      const userAgent = sessionInfo[0].user_agent;
      // Basic user agent parsing
      if (userAgent.includes('Chrome')) deviceInfo.browser = 'Chrome';
      else if (userAgent.includes('Firefox')) deviceInfo.browser = 'Firefox';
      else if (userAgent.includes('Safari')) deviceInfo.browser = 'Safari';
      else if (userAgent.includes('Edge')) deviceInfo.browser = 'Edge';
      
      if (userAgent.includes('Windows')) deviceInfo.os = 'Windows';
      else if (userAgent.includes('Mac')) deviceInfo.os = 'macOS';
      else if (userAgent.includes('Linux')) deviceInfo.os = 'Linux';
      else if (userAgent.includes('Android')) deviceInfo.os = 'Android';
      else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) deviceInfo.os = 'iOS';
      
      if (userAgent.includes('Mobile')) deviceInfo.device = 'Mobile';
      else if (userAgent.includes('Tablet') || userAgent.includes('iPad')) deviceInfo.device = 'Tablet';
      else deviceInfo.device = 'Desktop';
    }
    
    // Process analytics data to create user journey
    const userJourney = analytics.map(item => ({
      action: item.action,
      page: item.page,
      timestamp: item.created_at,
      metadata: item.metadata ? JSON.parse(item.metadata) : null
    }));
    
    // Calculate time spent on different sections
    const sectionTime = {};
    let currentPage = null;
    let currentPageStart = null;
    
    analytics.forEach((item, index) => {
      if (item.action === 'view' || item.action === 'visit') {
        if (currentPage && currentPageStart) {
          const timeSpent = new Date(item.created_at) - new Date(currentPageStart);
          sectionTime[currentPage] = (sectionTime[currentPage] || 0) + timeSpent;
        }
        currentPage = item.page;
        currentPageStart = item.created_at;
      }
    });
    
    // Add final page time if available
    if (currentPage && currentPageStart && sessionInfo.length > 0) {
      const sessionEnd = sessionInfo[0].last_activity || sessionInfo[0].session_start;
      const timeSpent = new Date(sessionEnd) - new Date(currentPageStart);
      sectionTime[currentPage] = (sectionTime[currentPage] || 0) + timeSpent;
    }
    
    res.json({
      success: true,
      sessionDetails: {
        sessionId: sessionId,
        sessionInfo: sessionInfo.length > 0 ? {
          sessionStart: sessionInfo[0].session_start,
          lastActivity: sessionInfo[0].last_activity,
          totalPageViews: sessionInfo[0].page_views || 0,
          totalTimeSpent: sessionInfo[0].total_time_spent || 0,
          ipAddress: sessionInfo[0].ip_address,
          tagScans: sessionInfo.map(item => ({
            tagId: item.tag_id,
            organizationId: item.organization_id,
            scanTime: item.scan_time
          }))
        } : null,
        location: location,
        deviceInfo: deviceInfo,
        userJourney: userJourney,
        sectionTimeSpent: Object.entries(sectionTime).map(([page, time]) => ({
          page,
          timeMs: time,
          timeFormatted: Math.floor(time / 1000) + 's'
        })),
        activities: {
          prayerRequests: prayerRequests.map(pr => ({
            id: pr.id,
            content: pr.content,
            isAnonymous: pr.is_anonymous,
            createdAt: pr.created_at,
            organizationId: pr.organization_id
          })),
          praiseReports: praiseReports.map(pr => ({
            id: pr.id,
            content: pr.content,
            isAnonymous: pr.is_anonymous,
            createdAt: pr.created_at,
            organizationId: pr.organization_id
          })),
          insights: insights.map(insight => ({
            id: insight.id,
            verseReference: insight.verse_reference,
            insightText: insight.insight_text,
            isAnonymous: insight.is_anonymous,
            createdAt: insight.created_at,
            organizationId: insight.organization_id
          }))
        }
      }
    });
  }).catch(error => {
    console.error('Session details error:', error);
    res.status(500).json({ success: false, error: 'Failed to get session details' });
  });
});

// Get interaction details by IP
app.get('/api/master/analytics/ip-details/:ip', requireMasterAuth, (req, res) => {
  const { ip } = req.params;
  const { timeframe = '7d' } = req.query;
  
  let timeFilter = '';
  switch(timeframe) {
    case '24h':
      timeFilter = "AND s.created_at >= NOW() - INTERVAL '24 hours'";
      break;
    case '7d':
      timeFilter = "AND s.created_at >= NOW() - INTERVAL '7 days'";
      break;
    case '30d':
      timeFilter = "AND s.created_at >= NOW() - INTERVAL '30 days'";
      break;
  }

  dbQuery.all(`
    SELECT 
      s.session_id,
      s.country,
      s.city,
      s.first_seen_at,
      s.last_seen_at,
      s.total_interactions,
      o.name as organization_name,
      array_agg(
        json_build_object(
          'tag_id', t.tag_id,
          'interaction_type', t.interaction_type,
          'page_url', t.page_url,
          'created_at', t.created_at
        ) ORDER BY t.created_at DESC
      ) as interactions
    FROM anonymous_sessions s
    LEFT JOIN ct_organizations o ON s.organization_id = o.id
    LEFT JOIN tag_interactions t ON s.session_id = t.session_id
    WHERE s.ip_address = ? ${timeFilter}
    GROUP BY s.session_id, s.country, s.city, s.first_seen_at, s.last_seen_at, s.total_interactions, o.name
    ORDER BY s.last_seen_at DESC
  `, [ip], (err, rows) => {
    if (err) {
      console.error('IP details error:', err);
      return res.status(500).json({ success: false, error: 'Failed to get IP details' });
    }
    
    res.json({ success: true, sessions: rows || [] });
  });
});

// Get tag interaction details
app.get('/api/master/analytics/tag-details/:tagId', requireMasterAuth, (req, res) => {
  const { tagId } = req.params;
  const { timeframe = '7d' } = req.query;
  
  let timeFilter = '';
  switch(timeframe) {
    case '24h':
      timeFilter = "AND t.created_at >= NOW() - INTERVAL '24 hours'";
      break;
    case '7d':
      timeFilter = "AND t.created_at >= NOW() - INTERVAL '7 days'";
      break;
    case '30d':
      timeFilter = "AND t.created_at >= NOW() - INTERVAL '30 days'";
      break;
  }

  db.query(`
    SELECT 
      t.*,
      s.country,
      s.city,
      s.latitude,
      s.longitude,
      o.name as organization_name
    FROM tag_interactions t
    LEFT JOIN anonymous_sessions s ON t.session_id = s.session_id
    LEFT JOIN ct_organizations o ON t.organization_id = o.id
    WHERE t.tag_id = $1 ${timeFilter}
    ORDER BY t.created_at DESC
  `, [tagId], (err, result) => {
    if (err) {
      console.error('Tag details error:', err);
      return res.status(500).json({ success: false, error: 'Failed to get tag details' });
    }
    
    res.json({ success: true, interactions: result.rows || [] });
  });
});

// Basic rate limiting for community endpoints (IP + org scoped)
const rateLimiter = createRateLimiter({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '', 10) || undefined,
  max: parseInt(process.env.RATE_LIMIT_MAX || '', 10) || undefined
});

// Apply rate limiting to community submission and interaction endpoints
app.post('/api/prayer-request', rateLimiter('prayer_submit'));
app.post('/api/praise-report', rateLimiter('praise_submit'));
app.post('/api/prayer-request/pray', rateLimiter('pray_action'));
app.post('/api/praise-report/celebrate', rateLimiter('celebrate_action'));
app.post('/api/verse-community', rateLimiter('verse_community_submit'));
app.post('/api/verse-community/heart', rateLimiter('verse_community_heart'));

// AUTOMATIC VERSE IMPORT SCHEDULER
// Check for missing verses every day at 12:01 AM
cron.schedule('1 0 * * *', async () => {
  console.log('🕛 Running daily verse check...');
  
  try {
    // Get all organizations
    const orgs = await new Promise((resolve, reject) => {
      dbQuery.all('SELECT id FROM CT_organizations WHERE is_active = true', [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });

    const today = new Date().toISOString().split('T')[0];
    
    for (const org of orgs) {
      try {
        await verseImportService.checkAndImportMissingVerse(org.id, today);
        // Small delay between organizations to avoid overwhelming Bible Gateway
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Failed to import verse for org ${org.id}:`, error);
      }
    }
    
    console.log('✅ Daily verse check completed');
  } catch (error) {
    console.error('❌ Daily verse check failed:', error);
  }
});

// Also run a check on server startup for today (in case server was down)
setTimeout(async () => {
  console.log('🚀 Running startup verse check...');
  try {
    const today = new Date().toISOString().split('T')[0];
    await verseImportService.checkAndImportMissingVerse(1, today); // Default org
  } catch (error) {
    console.error('Startup verse check failed:', error);
  }
}, 5000); // Wait 5 seconds after server starts

// Static files - put at the end so dynamic routes take precedence
app.use(express.static('public'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Church Tap app running on http://0.0.0.0:${PORT}`);
  console.log('🚀 Multi-tenant system ready!');
  console.log('📖 Automatic verse import system enabled');
});