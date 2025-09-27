const session = require('express-session');
const multer = require('multer');
const { db } = require('./database');
const { SESSION_SECRET, NODE_ENV } = require('./constants');

// Security headers middleware
const securityHeaders = (req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
};

// Session configuration
const sessionConfig = {
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: 'lax'
  }
};

// Organization resolution middleware
const resolveOrganization = async (req, res, next) => {
  try {
    // Extract organization from subdomain, query param, or session
    let orgSlug = null;
    
    // Check query parameter first (for compatibility)
    if (req.query.org) {
      orgSlug = req.query.org;
    }
    
    // Check subdomain if no query param
    if (!orgSlug) {
      const host = req.get('host') || '';
      const subdomain = host.split('.')[0];
      if (subdomain && subdomain !== 'www' && subdomain !== 'churchtap' && !subdomain.includes('localhost')) {
        orgSlug = subdomain;
      }
    }
    
    // Look up organization if we have a slug
    if (orgSlug) {
      const orgResult = await db.query(
        'SELECT * FROM organizations WHERE subdomain = $1 AND is_active = true',
        [orgSlug]
      );
      
      if (orgResult.rows.length > 0) {
        req.organization = orgResult.rows[0];
      }
    }
    
    next();
  } catch (error) {
    console.error('Error resolving organization:', error);
    next();
  }
};

// Auth middleware
const requireAuth = (req, res, next) => {
  if (!req.session.admin) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  next();
};

// Optional auth middleware - adds user info if available but doesn't require auth
const optionalAuth = (req, res, next) => {
  if (req.session.admin) {
    req.user = req.session.admin;
  }
  next();
};

// Organization admin auth middleware
const requireOrgAuth = (req, res, next) => {
  if (!req.session.admin) {
    return res.status(401).json({ success: false, error: 'Organization authentication required' });
  }
  
  // Set organization ID for admin routes (from session)
  if (!req.organizationId) {
    req.organizationId = req.session.admin.organization_id;
  }
  
  // If organization was resolved from subdomain/query, check if admin belongs to it
  if (req.organization && req.session.admin.organization_id !== req.organization.id) {
    return res.status(403).json({ success: false, error: 'Access denied for this organization' });
  }
  
  next();
};

// Master admin auth middleware
const requireMasterAuth = (req, res, next) => {
  if (!req.session.master_admin) {
    return res.status(401).json({ success: false, error: 'Master admin authentication required' });
  }
  next();
};

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + '.' + file.originalname.split('.').pop());
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

module.exports = {
  securityHeaders,
  sessionConfig,
  resolveOrganization,
  requireAuth,
  optionalAuth,
  requireOrgAuth,
  requireMasterAuth,
  upload
};
