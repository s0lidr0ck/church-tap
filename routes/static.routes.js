const express = require('express');
const path = require('path');

const router = express.Router();

function setNoStore(res) {
  // Help prevent phones from sticking to old HTML/app shells.
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
}

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
    setNoStore(res);
    res.sendFile(path.join(__dirname, '../public', 'homepage.html'));
  } else {
    console.log(`⛪ Serving church interface for: ${host}`);
    setNoStore(res);
    res.sendFile(path.join(__dirname, '../public', 'index.html'));
  }
});

// Global store redirect (Shopify)
router.get('/store', (req, res) => {
  setNoStore(res);
  return res.redirect(302, 'https://shop.churchtap.app');
});

// Always serve the church interface app shell (even on churchtap.app)
router.get('/app', (req, res) => {
  setNoStore(res);
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

// App shell routes for SPA-style pages (support hard refresh on deep links)
router.get('/explore', (req, res) => {
  setNoStore(res);
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

router.get('/saved', (req, res) => {
  setNoStore(res);
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

router.get('/me', (req, res) => {
  setNoStore(res);
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

router.get('/study', (req, res) => {
  setNoStore(res);
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

// Community is a SPA shortcut route that scrolls within Today
router.get('/community', (req, res) => {
  setNoStore(res);
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

// Static page routes
router.get('/verse', (req, res, next) => {
  // Apply analytics tracking manually if needed
  setNoStore(res);
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

router.get('/verse/:date', (req, res, next) => {
  // Apply analytics tracking manually if needed
  setNoStore(res);
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

// App shell routes for SPA-style pages
router.get('/favorites', (req, res) => {
  setNoStore(res);
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

router.get('/collections', (req, res) => {
  setNoStore(res);
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

router.get('/collections/:id', (req, res) => {
  setNoStore(res);
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

router.get('/my-prayers', (req, res) => {
  setNoStore(res);
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

router.get('/admin', (req, res) => {
  setNoStore(res);
  res.sendFile(path.join(__dirname, '../public', 'admin.html'));
});

router.get('/master', (req, res) => {
  setNoStore(res);
  res.sendFile(path.join(__dirname, '../public', 'master.html'));
});

module.exports = router;
