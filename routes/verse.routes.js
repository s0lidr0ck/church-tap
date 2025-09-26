const express = require('express');
const { dbQuery } = require('../config/database');

const router = express.Router();

// Get random verse
router.get('/random', (req, res) => {
  const orgId = req.organizationId || 1;

  dbQuery.get(`SELECT * FROM ct_verses WHERE published = TRUE AND organization_id = $1 ORDER BY RANDOM() LIMIT 1`, [orgId], (err, row) => {
    if (err) {
      console.error('Random verse error:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }

    if (!row) {
      return res.status(404).json({ success: false, error: 'No verses found' });
    }

    res.json({ success: true, verse: row });
  });
});

// Get verse by date
router.get('/:date', (req, res) => {
  const { date } = req.params;
  const orgId = req.organizationId || 1;

  dbQuery.get(`SELECT * FROM ct_verses WHERE date = $1 AND published = TRUE AND organization_id = $2`, [date, orgId], (err, scheduledVerse) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }

    if (scheduledVerse) {
      return res.json({ success: true, verse: scheduledVerse });
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

  dbQuery.run(`UPDATE ct_verses SET hearts = hearts + 1 WHERE id = $1`, [verse_id], function(err) {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }

    dbQuery.get(`SELECT hearts FROM ct_verses WHERE id = $1`, [verse_id], (err, row) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }

      res.json({ success: true, hearts: row ? row.hearts : 0 });
    });
  });
});

module.exports = router;