const express = require('express');
const path = require('path');

const router = express.Router();

// Homepage route with NFC tag handling
router.get('/', (req, res) => {
  const hostHeader = req.headers['x-forwarded-host'] || req.headers.host || '';
  const host = hostHeader.split(':')[0].toLowerCase();
  const { org, tag_id } = req.query;
  
  console.log(`🏠 Homepage request - Host: ${host}, org: ${org}, tag_id: ${tag_id}`);
  
  // Clean legacy URL redirect - ALL URLs with tag_id should redirect to /t/:uid format
  if (tag_id) {
    console.log(`🔄 Legacy URL detected: tag_id=${tag_id} - redirecting to new format`);
    return res.redirect(302, `/t/${tag_id}`);
  }

  // Regular homepage request
  if (host === 'churchtap.app' || host === 'www.churchtap.app') {
    console.log(`📄 Serving marketing homepage for: ${host}`);
    res.sendFile(path.join(__dirname, '../public', 'homepage.html'));
  } else {
    console.log(`⛪ Serving church interface for: ${host}`);
    res.sendFile(path.join(__dirname, '../public', 'index.html'));
  }
});

// Static page routes
router.get('/verse', (req, res, next) => {
  // Apply analytics tracking manually if needed
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

router.get('/verse/:date', (req, res, next) => {
  // Apply analytics tracking manually if needed
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

router.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'admin.html'));
});

router.get('/master', (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'master.html'));
});

module.exports = router;
