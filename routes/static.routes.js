const express = require('express');
const path = require('path');
const { trackInteraction } = require('../services/analyticsService');
const { trackAnalytics } = require('../services/analyticsService');
const { db } = require('../config/database');

const router = express.Router();

// Homepage route with NFC tag handling
router.get('/', trackInteraction, (req, res) => {
  const hostHeader = req.headers['x-forwarded-host'] || req.headers.host || '';
  const host = hostHeader.split(':')[0].toLowerCase();
  const { org, tag_id } = req.query;
  
  console.log(`🏠 Homepage request - Host: ${host}, org: ${org}, tag_id: ${tag_id}`);
  
  // Handle legacy NFC tag scan requests (redirect to new format)
  if (tag_id) {
    console.log(`🔄 Legacy URL detected: ${org ? `org=${org}, ` : ''}tag_id=${tag_id} - redirecting to new format`);
    
    // For development on localhost, skip the redirect and serve the app directly
    if (host.includes('localhost') || host.includes('127.0.0.1')) {
      console.log(`🏠 Development environment - serving app directly instead of redirecting`);
      res.sendFile(path.join(__dirname, '../public', 'index.html'));
      return;
    }
    
    // Redirect to new URL format /t/<UID> for production
    return res.redirect(302, `/t/${tag_id}`);
  } else {
    // Regular homepage request
    if (host === 'churchtap.app' || host === 'www.churchtap.app') {
      console.log(`📄 Serving marketing homepage for: ${host}`);
      res.sendFile(path.join(__dirname, '../public', 'homepage.html'));
    } else {
      console.log(`⛪ Serving church interface for: ${host}`);
      res.sendFile(path.join(__dirname, '../public', 'index.html'));
    }
  }
});

// Static page routes
router.get('/verse', trackAnalytics('view'), (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

router.get('/verse/:date', trackAnalytics('view'), (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

router.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'admin.html'));
});

router.get('/master', (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'master.html'));
});

module.exports = router;
