const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { dbQuery, db } = require('../config/database');
const { JWT_SECRET } = require('../config/constants');
const { validateInput } = require('../middleware/validation');

const router = express.Router();

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

// User registration
router.post('/register', validateInput.email, validateInput.password, validateInput.sanitizeHtml, async (req, res) => {
  try {
    const { email, password, firstName, lastName, displayName } = req.body;

    // Check if user already exists
    db.query(`SELECT id FROM ct_users WHERE email = $1`, [email.toLowerCase()], async (err, result) => {
      const existingUser = result.rows[0];
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
router.post('/login', validateInput.email, validateInput.password, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    // Find user
    db.query(`SELECT * FROM ct_users WHERE email = $1`, [email.toLowerCase()], async (err, result) => {
      const user = result.rows[0];
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
      db.query(`UPDATE ct_users SET last_login = CURRENT_TIMESTAMP WHERE id = $1`, [user.id]);

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
      db.query(`SELECT * FROM ct_user_preferences WHERE user_id = $1`, [user.id], (err, result) => {
        const prefs = result.rows[0];
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
router.post('/logout', (req, res) => {
  res.clearCookie('authToken');
  res.json({ success: true, message: 'Logged out successfully' });
});

// Get current user
router.get('/me', authenticateUser, (req, res) => {
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
router.post('/onboarding', authenticateUser, (req, res) => {
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
router.put('/profile', authenticateUser, (req, res) => {
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
router.put('/preferences', authenticateUser, (req, res) => {
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

module.exports = { router, authenticateUser };
