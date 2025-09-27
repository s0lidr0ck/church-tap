const express = require('express');
const { dbQuery, db } = require('../config/database');
const { optionalAuth } = require('../config/middleware');

const router = express.Router();

// Get random verse
router.get('/random', optionalAuth, (req, res) => {
  const orgId = req.organization?.id || 1;

  db.query(`SELECT * FROM ct_verses WHERE published = TRUE AND organization_id = $1 ORDER BY RANDOM() LIMIT 1`, [orgId], (err, result) => {
    if (err) {
      console.error('Random verse error:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No verses found' });
    }

    res.json({ success: true, verse: result.rows[0] });
  });
});

// Get verse by date
router.get('/:date', optionalAuth, (req, res) => {
  const { date } = req.params;
  const orgId = req.organization?.id || 1;

  db.query(`SELECT * FROM ct_verses WHERE date = $1 AND published = TRUE AND organization_id = $2`, [date, orgId], (err, result) => {
    if (err) {
      console.error('Verse by date error:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }

    if (result.rows && result.rows.length > 0) {
      return res.json({ success: true, verse: result.rows[0] });
    } else {
      return res.json({ success: false, message: 'No verse found for this date' });
    }
  });
});

// Heart a verse
router.post('/heart', (req, res) => {
  const { verse_id, user_token } = req.body;

  if (!verse_id || !user_token) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  db.query(`UPDATE ct_verses SET hearts = hearts + 1 WHERE id = $1`, [verse_id], (err, result) => {
    if (err) {
      console.error('Heart verse error:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }

    db.query(`SELECT hearts FROM ct_verses WHERE id = $1`, [verse_id], (err, result) => {
      if (err) {
        console.error('Get hearts error:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }

      const hearts = result.rows.length > 0 ? result.rows[0].hearts : 0;
      res.json({ success: true, hearts: hearts });
    });
  });
});

module.exports = router;