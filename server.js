require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
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

// JWT secret (in production, use environment variable)
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
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
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Database setup
const db = new sqlite3.Database('./database.db');

// Migration system
const MigrationSystem = require('./migrations/migration-system');

// Run migrations on startup
async function runMigrationsOnStartup() {
  const migrationSystem = new MigrationSystem('./database.db');
  try {
    console.log('🔄 Checking for database migrations...');
    await migrationSystem.migrate();
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    migrationSystem.close();
  }
}

// Initialize database tables
db.serialize(() => {
  // Verses table
  db.run(`CREATE TABLE IF NOT EXISTS verses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL,
    content_type TEXT NOT NULL,
    verse_text TEXT,
    image_path TEXT,
    bible_reference TEXT,
    context TEXT,
    tags TEXT,
    hearts INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    published BOOLEAN DEFAULT 0
  )`);

  // Admin users table
  db.run(`CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Analytics table
  db.run(`CREATE TABLE IF NOT EXISTS analytics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    verse_id INTEGER,
    action TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (verse_id) REFERENCES verses (id)
  )`);

  // Favorites table (using localStorage IDs)
  db.run(`CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    verse_id INTEGER,
    user_token TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (verse_id) REFERENCES verses (id)
  )`);

  // Prayer requests table
  db.run(`CREATE TABLE IF NOT EXISTS prayer_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    content TEXT NOT NULL,
    prayer_count INTEGER DEFAULT 0,
    user_token TEXT,
    ip_address TEXT,
    is_approved BOOLEAN DEFAULT 1,
    is_hidden BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Praise reports table
  db.run(`CREATE TABLE IF NOT EXISTS praise_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    content TEXT NOT NULL,
    celebration_count INTEGER DEFAULT 0,
    user_token TEXT,
    ip_address TEXT,
    is_approved BOOLEAN DEFAULT 1,
    is_hidden BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Prayer interactions table (to track who prayed for what)
  db.run(`CREATE TABLE IF NOT EXISTS prayer_interactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prayer_request_id INTEGER,
    user_token TEXT NOT NULL,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (prayer_request_id) REFERENCES prayer_requests (id)
  )`);

  // Celebration interactions table (to track who celebrated what)
  db.run(`CREATE TABLE IF NOT EXISTS celebration_interactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    praise_report_id INTEGER,
    user_token TEXT NOT NULL,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (praise_report_id) REFERENCES praise_reports (id)
  )`);

  // Users table for Phase 3
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    display_name TEXT,
    phone TEXT,
    date_of_birth DATE,
    profile_image TEXT,
    is_verified BOOLEAN DEFAULT 0,
    verification_token TEXT,
    reset_token TEXT,
    reset_token_expires DATETIME,
    last_login DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // User preferences and personalization
  db.run(`CREATE TABLE IF NOT EXISTS user_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    life_stage TEXT, -- young_adult, married, parent, senior, etc.
    interests TEXT, -- JSON array: ["faith_growth", "relationships", "anxiety", "hope"]
    struggles TEXT, -- JSON array: ["depression", "addiction", "loss", "finances"]
    prayer_frequency TEXT, -- daily, weekly, as_needed
    preferred_translation TEXT, -- NIV, ESV, NLT, etc.
    notification_enabled BOOLEAN DEFAULT 1,
    notification_time TIME DEFAULT '08:00:00',
    timezone TEXT DEFAULT 'America/Chicago',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  )`);

  // User verse collections
  db.run(`CREATE TABLE IF NOT EXISTS user_collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    is_private BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  )`);

  // Collection verses (many-to-many)
  db.run(`CREATE TABLE IF NOT EXISTS collection_verses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id INTEGER NOT NULL,
    verse_id INTEGER NOT NULL,
    notes TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (collection_id) REFERENCES user_collections (id) ON DELETE CASCADE,
    FOREIGN KEY (verse_id) REFERENCES verses (id) ON DELETE CASCADE,
    UNIQUE(collection_id, verse_id)
  )`);

  // User verse history and interactions
  db.run(`CREATE TABLE IF NOT EXISTS user_verse_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    verse_id INTEGER NOT NULL,
    viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    time_spent INTEGER,
    shared BOOLEAN DEFAULT 0,
    favorited BOOLEAN DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (verse_id) REFERENCES verses (id) ON DELETE CASCADE
  )`);

  // Prayer partnerships and connections
  db.run(`CREATE TABLE IF NOT EXISTS prayer_partnerships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER NOT NULL,
    partner_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (requester_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (partner_id) REFERENCES users (id) ON DELETE CASCADE,
    UNIQUE(requester_id, partner_id)
  )`);

  // Personal prayer requests (different from anonymous community ones)
  db.run(`CREATE TABLE IF NOT EXISTS personal_prayer_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT,
    is_private BOOLEAN DEFAULT 1,
    is_answered BOOLEAN DEFAULT 0,
    answered_at DATETIME,
    answer_description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  )`);

  // Prayer request sharing (who can see personal prayer requests)
  db.run(`CREATE TABLE IF NOT EXISTS prayer_request_shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prayer_request_id INTEGER NOT NULL,
    shared_with_user_id INTEGER NOT NULL,
    permission_level TEXT DEFAULT 'view',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (prayer_request_id) REFERENCES personal_prayer_requests (id) ON DELETE CASCADE,
    FOREIGN KEY (shared_with_user_id) REFERENCES users (id) ON DELETE CASCADE,
    UNIQUE(prayer_request_id, shared_with_user_id)
  )`);

  // User sessions for authentication
  db.run(`CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  )`);

  // Create default admin user (username: admin, password: admin123)
  const defaultPassword = bcrypt.hashSync('admin123', 10);
  db.run(`INSERT OR IGNORE INTO admin_users (username, password_hash) VALUES (?, ?)`, 
    ['admin', defaultPassword]);
});

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
  db.get(
    `SELECT id, subdomain FROM organizations WHERE custom_domain = ? OR subdomain = ?`,
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

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = './public/uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'verse-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
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
  db.run(`UPDATE verses SET published = 1 WHERE date = ? AND published = 0`, [today], (err) => {
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

    db.run(
      `INSERT INTO analytics (verse_id, action, ip_address, user_agent, organization_id) VALUES (?, ?, ?, ?, ?)`,
      [verseId, action, ip, userAgent, orgId]
    );
    
    next();
  };
};

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
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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

// Get verse by date (with personalization support)
app.get('/api/verse/:date', trackAnalytics('api_verse'), optionalAuth, async (req, res) => {
  const { date } = req.params;
  const orgId = req.organizationId || 1;
  
  try {
    // Check if there's a scheduled verse for this date first
    db.get(`SELECT * FROM verses WHERE date = ? AND published = 1 AND organization_id = ?`, [date, orgId], async (err, scheduledVerse) => {
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
        db.get(`SELECT * FROM user_preferences WHERE user_id = ?`, [req.user.userId], (err, prefs) => {
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
            FROM verses 
            WHERE published = 1 
            AND date <= ? 
            AND (${conditions})
            AND organization_id = ?
            ORDER BY relevance_score DESC, ABS(julianday(date) - julianday(?)) ASC
            LIMIT 1
          `;

          db.get(personalizedQuery, [...searchParams, date, orgId, date], (err, personalizedVerse) => {
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

// Get random verse
app.get('/api/verse/random', trackAnalytics('api_random'), (req, res) => {
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const twoWeeksAgoStr = twoWeeksAgo.toISOString().split('T')[0];
  const today = new Date().toISOString().split('T')[0];
  const orgId = req.organizationId || 1;
  
  db.get(`SELECT * FROM verses WHERE date BETWEEN ? AND ? AND published = 1 AND organization_id = ? ORDER BY RANDOM() LIMIT 1`, 
    [twoWeeksAgoStr, today, orgId], (err, row) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    if (!row) {
      return res.json({ success: false, message: 'No verses found' });
    }
    
    res.json({ success: true, verse: row });
  });
});

// Heart a verse
app.post('/api/verse/heart', (req, res) => {
  const { verse_id, user_token } = req.body;
  
  if (!verse_id || !user_token) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }
  
  db.run(`UPDATE verses SET hearts = hearts + 1 WHERE id = ?`, [verse_id], function(err) {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    // Get updated heart count
    db.get(`SELECT hearts FROM verses WHERE id = ?`, [verse_id], (err, row) => {
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
  
  db.run(`INSERT INTO analytics (verse_id, action, ip_address, user_agent, organization_id) VALUES (?, ?, ?, ?, ?)`,
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
    const stmt = db.prepare(`INSERT INTO analytics (verse_id, action, ip_address, user_agent, organization_id) VALUES (?, ?, ?, ?, ?)`);
    for (const ev of events) {
      stmt.run([ev.verse_id || null, ev.action || 'bg_event', ip, userAgent, orgId]);
    }
    stmt.finalize((err) => {
      if (err) {
        console.error('Background sync batch error:', err);
        return res.status(500).json({ success: false });
      }
      return res.json({ success: true, processed: events.length });
    });
  } else {
    db.run(
      `INSERT INTO analytics (verse_id, action, ip_address, user_agent, organization_id) VALUES (?, ?, ?, ?, ?)`,
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

// Submit feedback
app.post('/api/feedback', (req, res) => {
  const { feedback, user_token, url } = req.body;
  
  if (!feedback) {
    return res.status(400).json({ success: false, error: 'Feedback is required' });
  }
  
  // Store feedback in a simple way (you might want a separate table)
  db.run(`INSERT INTO analytics (action, ip_address, user_agent) VALUES (?, ?, ?)`,
    [`feedback: ${feedback}`, req.ip, req.get('User-Agent')], (err) => {
    if (err) {
      console.error('Feedback error:', err);
      return res.status(500).json({ success: false });
    }
    
    res.json({ success: true });
  });
});

// Generate verse image (placeholder for now)
app.post('/api/verse/generate-image', (req, res) => {
  // This would generate an image from text verse
  // For now, return a placeholder response
  res.status(501).json({ success: false, error: 'Image generation not implemented yet' });
});

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
  db.get(`SELECT au.*, o.id as organization_id 
          FROM admin_users au 
          LEFT JOIN organizations o ON au.organization_id = o.id 
          WHERE au.id = ? AND au.is_active = 1`, [req.session.adminId], (err, admin) => {
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
  
  db.get(`SELECT au.*, o.name as organization_name, o.subdomain as organization_subdomain 
           FROM admin_users au 
           LEFT JOIN organizations o ON au.organization_id = o.id 
           WHERE au.username = ? AND au.is_active = 1`, [username], async (err, user) => {
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

// Admin logout
app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Check admin session status
app.get('/api/admin/check-session', (req, res) => {
  if (req.session.adminId) {
    // Get admin details with organization context
    db.get(`SELECT au.*, o.name as organization_name, o.subdomain as organization_subdomain 
            FROM admin_users au 
            LEFT JOIN organizations o ON au.organization_id = o.id 
            WHERE au.id = ? AND au.is_active = 1`, [req.session.adminId], (err, admin) => {
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
  db.all(`SELECT * FROM verses WHERE organization_id = ? ORDER BY date DESC`, [req.organizationId], (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    res.json({ success: true, verses: rows });
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
      // Resize image to 9:16 aspect ratio
      const outputPath = `./public/uploads/verse-${date}-${Date.now()}.jpg`;
      await sharp(req.file.path)
        .resize(720, 1280, { 
          fit: 'cover',
          position: 'center'
        })
        .jpeg({ quality: 85 })
        .toFile(outputPath);
      
      // Delete original
      fs.unlinkSync(req.file.path);
      image_path = outputPath.replace('./public', '');
    }
    
    db.run(`INSERT INTO verses (date, content_type, verse_text, image_path, bible_reference, context, tags, published, organization_id) 
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
      // Resize image to 9:16 aspect ratio
      const outputPath = `./public/uploads/verse-${date}-${Date.now()}.jpg`;
      await sharp(req.file.path)
        .resize(720, 1280, { 
          fit: 'cover',
          position: 'center'
        })
        .jpeg({ quality: 85 })
        .toFile(outputPath);
      
      // Delete original
      fs.unlinkSync(req.file.path);
      image_path = outputPath.replace('./public', '');
    }
    
    db.run(`UPDATE verses SET date = ?, content_type = ?, verse_text = ?, image_path = ?, 
            bible_reference = ?, context = ?, tags = ?, published = ? WHERE id = ? AND organization_id = ?`,
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
  db.get(`SELECT image_path FROM verses WHERE id = ? AND organization_id = ?`, [id, req.organizationId], (err, verse) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    db.run(`DELETE FROM verses WHERE id = ? AND organization_id = ?`, [id, req.organizationId], function(err) {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      // Delete image file if exists
      if (verse && verse.image_path) {
        const imagePath = './public' + verse.image_path;
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);
        }
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
      db.run(`DELETE FROM verses WHERE id IN (${placeholders}) AND organization_id = ?`, params, function(err) {
        if (err) {
          return res.status(500).json({ success: false, error: 'Database error' });
        }
        res.json({ success: true, affected: this.changes });
      });
      break;
      
    case 'publish':
      db.run(`UPDATE verses SET published = 1 WHERE id IN (${placeholders}) AND organization_id = ?`, params, function(err) {
        if (err) {
          return res.status(500).json({ success: false, error: 'Database error' });
        }
        res.json({ success: true, affected: this.changes });
      });
      break;
      
    case 'unpublish':
      db.run(`UPDATE verses SET published = 0 WHERE id IN (${placeholders}) AND organization_id = ?`, params, function(err) {
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
      db.run(`UPDATE verses SET tags = ? WHERE id IN (${placeholders}) AND organization_id = ?`, [data.tags, ...verse_ids, req.organizationId], function(err) {
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
        
        db.run(`INSERT INTO verses (date, content_type, verse_text, bible_reference, context, tags, published, organization_id) 
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
  db.all(`SELECT date, content_type, verse_text, bible_reference, context, tags, published FROM verses WHERE organization_id = ? ORDER BY date DESC`, [req.organizationId], (err, rows) => {
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

// MASTER ADMIN ROUTES

// Master admin login
app.post('/api/master/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password required' });
  }
  
  db.get(`SELECT * FROM master_admins WHERE username = ?`, [username], async (err, user) => {
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
    db.run(`UPDATE master_admins SET last_login_at = CURRENT_TIMESTAMP, last_login_ip = ? WHERE id = ?`, 
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
    db.all(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN plan_type = 'basic' THEN 29 WHEN plan_type = 'premium' THEN 79 WHEN plan_type = 'enterprise' THEN 199 ELSE 0 END) as revenue
      FROM organizations
    `, (err, rows) => {
      if (err) reject(err);
      else resolve(rows[0] || {});
    });
  });
  
  // Get total users across all orgs
  const getUserStats = new Promise((resolve, reject) => {
    db.get(`SELECT COUNT(*) as total FROM users`, (err, row) => {
      if (err) reject(err);
      else resolve(row || {});
    });
  });
  
  // Get recent organizations
  const getRecentOrgs = new Promise((resolve, reject) => {
    db.all(`SELECT name, subdomain, created_at FROM organizations ORDER BY created_at DESC LIMIT 5`, (err, rows) => {
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
  db.all(`SELECT * FROM organizations ORDER BY created_at DESC`, (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    res.json({ success: true, organizations: rows });
  });
});

// List admins for a specific organization (master scope)
app.get('/api/master/organizations/:id/admins', requireMasterAuth, (req, res) => {
  const { id } = req.params;
  db.all(
    `SELECT id, username, email, role, is_active, created_at, last_login_at 
     FROM admin_users 
     WHERE organization_id = ? 
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
  db.get(`SELECT id, organization_id FROM admin_users WHERE id = ?`, [adminId], (err, admin) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    if (!admin || String(admin.organization_id) !== String(id)) {
      return res.status(404).json({ success: false, error: 'Admin not found in this organization' });
    }

    const fields = [];
    const params = [];
    if (typeof is_active === 'boolean') {
      fields.push('is_active = ?');
      params.push(is_active ? 1 : 0);
    }
    if (role) {
      fields.push('role = ?');
      params.push(role);
    }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, error: 'No changes provided' });
    }

    params.push(adminId);
    db.run(`UPDATE admin_users SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params, function(updateErr) {
      if (updateErr) {
        return res.status(500).json({ success: false, error: 'Failed to update admin' });
      }
      return res.json({ success: true });
    });
  });
});

// Create new organization
app.post('/api/master/organizations', requireMasterAuth, (req, res) => {
  const { name, subdomain, contact_email, plan_type, custom_domain } = req.body;
  
  if (!name || !subdomain || !plan_type) {
    return res.status(400).json({ success: false, error: 'Name, subdomain, and plan are required' });
  }
  
  // Check if subdomain is already taken
  db.get(`SELECT id FROM organizations WHERE subdomain = ?`, [subdomain], (err, existing) => {
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
    
    db.run(`
      INSERT INTO organizations (
        name, subdomain, contact_email, plan_type, custom_domain, settings, features
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [name, subdomain, contact_email, plan_type, custom_domain, settings, features], 
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, error: 'Failed to create organization' });
      }
      
      // Log activity
      db.run(`
        INSERT INTO master_admin_activity (
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
});

// Update organization
app.put('/api/master/organizations/:id', requireMasterAuth, (req, res) => {
  const { id } = req.params;
  const { name, subdomain, contact_email, plan_type, custom_domain } = req.body;
  
  if (!name || !subdomain || !plan_type) {
    return res.status(400).json({ success: false, error: 'Name, subdomain, and plan are required' });
  }
  
  // Check if subdomain is taken by another organization
  db.get(`SELECT id FROM organizations WHERE subdomain = ? AND id != ?`, [subdomain, id], (err, existing) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    if (existing) {
      return res.status(400).json({ success: false, error: 'Subdomain is already taken' });
    }
    
    db.run(`
      UPDATE organizations SET 
        name = ?, subdomain = ?, contact_email = ?, plan_type = ?, 
        custom_domain = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [name, subdomain, contact_email, plan_type, custom_domain, id], 
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, error: 'Failed to update organization' });
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ success: false, error: 'Organization not found' });
      }
      
      // Log activity
      db.run(`
        INSERT INTO master_admin_activity (
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
    db.serialize(() => {
      const totals = {};
      db.get(`SELECT COUNT(*) AS total FROM organizations`, (err, row) => {
        if (err) return reject(err);
        totals.totalOrganizations = row?.total || 0;
      });
      db.get(`SELECT COUNT(*) AS active FROM organizations WHERE is_active = 1`, (err, row) => {
        if (err) return reject(err);
        totals.activeOrganizations = row?.active || 0;
      });
      db.get(`SELECT COUNT(*) AS total FROM users`, (err, row) => {
        if (err) return reject(err);
        totals.totalUsers = row?.total || 0;
      });
      db.get(`SELECT COUNT(*) AS total FROM verses`, (err, row) => {
        if (err) return reject(err);
        totals.totalVerses = row?.total || 0;
      });
      db.get(`SELECT COUNT(*) AS views, COUNT(DISTINCT ip_address) AS uniques FROM analytics WHERE action = 'verse_view' AND timestamp >= ?`, [sevenDaysAgoISO], (err, row) => {
        if (err) return reject(err);
        totals.totalViews7d = row?.views || 0;
        totals.uniqueVisitors7d = row?.uniques || 0;
        resolve(totals);
      });
    });
  });

  const getPerOrg = new Promise((resolve, reject) => {
    db.all(
      `SELECT 
         o.id,
         o.name,
         o.subdomain,
         o.plan_type,
         o.is_active,
         o.created_at,
         (SELECT COUNT(*) FROM verses v WHERE v.organization_id = o.id) AS verse_count,
         (SELECT COUNT(*) FROM admin_users au WHERE au.organization_id = o.id) AS admin_count,
         (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.id) AS user_count,
         (SELECT MAX(timestamp) FROM analytics a WHERE a.organization_id = o.id) AS last_activity,
         (SELECT COUNT(*) FROM analytics a WHERE a.organization_id = o.id AND a.timestamp >= ?) AS views_7d
       FROM organizations o
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
      db.all(
        `SELECT DATE(timestamp) as date, COUNT(*) as views, COUNT(DISTINCT ip_address) as unique_visitors
         FROM analytics 
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
  db.get(`SELECT name, subdomain FROM organizations WHERE id = ?`, [id], (err, org) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    if (!org) {
      return res.status(404).json({ success: false, error: 'Organization not found' });
    }
    
    // Delete organization (this will cascade delete related data)
    db.run(`DELETE FROM organizations WHERE id = ?`, [id], function(err) {
      if (err) {
        return res.status(500).json({ success: false, error: 'Failed to delete organization' });
      }
      
      // Log activity
      db.run(`
        INSERT INTO master_admin_activity (
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
    db.all(`SELECT * FROM prayer_requests WHERE date = ? AND is_approved = 1 AND is_hidden = 0 AND organization_id = ? ORDER BY created_at ASC`, 
      [date, orgId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
  });
  
  // Get praise reports for the date
  const getPraiseReports = new Promise((resolve, reject) => {
    db.all(`SELECT * FROM praise_reports WHERE date = ? AND is_approved = 1 AND is_hidden = 0 AND organization_id = ? ORDER BY created_at ASC`, 
      [date, orgId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
  });
  
  Promise.all([getPrayerRequests, getPraiseReports])
    .then(([prayerRequests, praiseReports]) => {
      res.json({
        success: true,
        community: {
          prayer_requests: prayerRequests,
          praise_reports: praiseReports
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
  
  if (!content || content.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Prayer request content is required' });
  }
  
  if (content.length > 500) {
    return res.status(400).json({ success: false, error: 'Prayer request too long (max 500 characters)' });
  }
  
  db.run(`INSERT INTO prayer_requests (date, content, user_token, ip_address, organization_id) VALUES (?, ?, ?, ?, ?)`,
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
  
  db.run(`INSERT INTO praise_reports (date, content, user_token, ip_address, organization_id) VALUES (?, ?, ?, ?, ?)`,
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
  db.get(`SELECT id FROM prayer_interactions WHERE prayer_request_id = ? AND user_token = ?`,
    [prayer_request_id, user_token], (err, row) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      if (row) {
        return res.status(400).json({ success: false, error: 'You already prayed for this request' });
      }
      
      // Add prayer interaction
      db.run(`INSERT INTO prayer_interactions (prayer_request_id, user_token, ip_address) VALUES (?, ?, ?)`,
        [prayer_request_id, user_token, ip], function(err) {
          if (err) {
            return res.status(500).json({ success: false, error: 'Database error' });
          }
          
          // Update prayer count
          db.run(`UPDATE prayer_requests SET prayer_count = prayer_count + 1 WHERE id = ?`,
            [prayer_request_id], (err) => {
              if (err) {
                return res.status(500).json({ success: false, error: 'Database error' });
              }
              
              // Get updated count
              db.get(`SELECT prayer_count FROM prayer_requests WHERE id = ?`, 
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
  db.get(`SELECT id FROM celebration_interactions WHERE praise_report_id = ? AND user_token = ?`,
    [praise_report_id, user_token], (err, row) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      if (row) {
        return res.status(400).json({ success: false, error: 'You already celebrated this report' });
      }
      
      // Add celebration interaction
      db.run(`INSERT INTO celebration_interactions (praise_report_id, user_token, ip_address) VALUES (?, ?, ?)`,
        [praise_report_id, user_token, ip], function(err) {
          if (err) {
            return res.status(500).json({ success: false, error: 'Database error' });
          }
          
          // Update celebration count
          db.run(`UPDATE praise_reports SET celebration_count = celebration_count + 1 WHERE id = ?`,
            [praise_report_id], (err) => {
              if (err) {
                return res.status(500).json({ success: false, error: 'Database error' });
              }
              
              // Get updated count
              db.get(`SELECT celebration_count FROM praise_reports WHERE id = ?`, 
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

// Admin: Get all prayer requests and praise reports
app.get('/api/admin/community', requireOrgAuth, (req, res) => {
  const { days = 7 } = req.query;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];
  
  const getPrayerRequests = new Promise((resolve, reject) => {
    db.all(`SELECT * FROM prayer_requests WHERE date >= ? AND organization_id = ? ORDER BY date DESC, created_at DESC`, 
      [startDateStr, req.organizationId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
  });
  
  const getPraiseReports = new Promise((resolve, reject) => {
    db.all(`SELECT * FROM praise_reports WHERE date >= ? AND organization_id = ? ORDER BY date DESC, created_at DESC`, 
      [startDateStr, req.organizationId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
  });
  
  Promise.all([getPrayerRequests, getPraiseReports])
    .then(([prayerRequests, praiseReports]) => {
      res.json({
        success: true,
        community: {
          prayer_requests: prayerRequests,
          praise_reports: praiseReports
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
  
  db.run(`UPDATE prayer_requests SET is_approved = ?, is_hidden = ? WHERE id = ? AND organization_id = ?`,
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
  
  db.run(`UPDATE praise_reports SET is_approved = ?, is_hidden = ? WHERE id = ? AND organization_id = ?`,
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
  db.run(`DELETE FROM prayer_interactions WHERE prayer_request_id = ?`, [id], (err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    // Delete prayer request (only from this organization)
    db.run(`DELETE FROM prayer_requests WHERE id = ? AND organization_id = ?`, [id, req.organizationId], function(err) {
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
  db.run(`DELETE FROM celebration_interactions WHERE praise_report_id = ?`, [id], (err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    // Delete praise report (only from this organization)
    db.run(`DELETE FROM praise_reports WHERE id = ? AND organization_id = ?`, [id, req.organizationId], function(err) {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      res.json({ success: true });
    });
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
    db.get(`SELECT id FROM users WHERE email = ?`, [email.toLowerCase()], async (err, existingUser) => {
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
      db.run(`INSERT INTO users (email, password_hash, first_name, last_name, display_name, verification_token) 
              VALUES (?, ?, ?, ?, ?, ?)`,
        [email.toLowerCase(), passwordHash, firstName, lastName, displayName, verificationToken],
        function(err) {
          if (err) {
            return res.status(500).json({ success: false, error: 'Failed to create user' });
          }

          const userId = this.lastID;

          // Create default user preferences
          db.run(`INSERT INTO user_preferences (user_id) VALUES (?)`, [userId], (err) => {
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
    db.get(`SELECT * FROM users WHERE email = ?`, [email.toLowerCase()], async (err, user) => {
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
      db.run(`UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?`, [user.id]);

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
      db.get(`SELECT * FROM user_preferences WHERE user_id = ?`, [user.id], (err, prefs) => {
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
  db.get(`SELECT u.*, p.* FROM users u 
          LEFT JOIN user_preferences p ON u.id = p.user_id 
          WHERE u.id = ?`, [req.user.userId], (err, user) => {
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

  db.run(`UPDATE user_preferences SET 
          life_stage = ?, interests = ?, struggles = ?, prayer_frequency = ?, preferred_translation = ?, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ?`,
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

  db.run(`UPDATE users SET 
          first_name = ?, last_name = ?, display_name = ?, phone = ?, date_of_birth = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
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

  db.run(`UPDATE user_preferences SET 
          life_stage = ?, interests = ?, struggles = ?, prayer_frequency = ?, preferred_translation = ?,
          notification_enabled = ?, notification_time = ?, timezone = ?, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ?`,
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
  db.all(`
    SELECT 
      DATE(timestamp) as date,
      COUNT(*) as views,
      COUNT(DISTINCT ip_address) as unique_visitors
    FROM analytics 
    WHERE action = 'verse_view' AND timestamp >= ? AND organization_id = ?
    GROUP BY DATE(timestamp)
    ORDER BY date DESC
  `, [startDate.toISOString(), req.organizationId], (err, dailyStats) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    // Get most viewed verses
    db.all(`
      SELECT 
        v.id,
        v.date,
        v.bible_reference,
        v.verse_text,
        COUNT(a.id) as views
      FROM verses v
      LEFT JOIN analytics a ON v.id = a.verse_id AND a.action = 'verse_view'
      WHERE a.timestamp >= ? AND v.organization_id = ? AND a.organization_id = ?
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
  db.get(`SELECT id FROM organizations WHERE id = ?`, [id], async (err, org) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    if (!org) {
      return res.status(404).json({ success: false, error: 'Organization not found' });
    }

    // Ensure username unique
    db.get(`SELECT id FROM admin_users WHERE username = ?`, [username], async (err, existing) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      if (existing) {
        return res.status(400).json({ success: false, error: 'Username already exists' });
      }

      try {
        const passwordHash = await bcrypt.hash(password, 12);
        db.run(
          `INSERT INTO admin_users (username, password_hash, email, role, organization_id, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`,
          [username, passwordHash, email || null, role, id],
          function(insertErr) {
            if (insertErr) {
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

// Start server after running migrations
async function startServer() {
  try {
    await runMigrationsOnStartup();
    // Ensure default master admin credentials are set (helpful for dev)
    await new Promise((resolve) => {
      const defaultMasterPassword = process.env.DEFAULT_MASTER_PASSWORD || 'master123';
      const passwordHash = bcrypt.hashSync(defaultMasterPassword, 12);
      db.run(
        `UPDATE master_admins SET password_hash = ? WHERE username = 'master'`,
        [passwordHash],
        () => resolve()
      );
    });
    
    app.listen(PORT, () => {
      console.log(`Church Tap app running on http://localhost:${PORT}`);
      console.log('Default admin login: admin / admin123');
      console.log('🚀 Multi-tenant system ready!');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();