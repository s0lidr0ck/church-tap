const express = require('express');
const { dbQuery } = require('../config/database');
const { optionalAuth } = require('../config/middleware');

const router = express.Router();

// Search verses
router.get('/search', optionalAuth, (req, res) => {
  const { q: query, limit = 10, offset = 0 } = req.query;
  const orgId = req.organization?.id || 1;

  if (!query || query.trim().length < 2) {
    return res.status(400).json({ success: false, error: 'Search query must be at least 2 characters' });
  }

  const searchTerm = `%${query.trim()}%`;

  dbQuery.all(`
    SELECT id, date, content_type, verse_text, image_path, bible_reference, context, tags, published
    FROM ct_verses
    WHERE published = TRUE
    AND organization_id = $1
    AND (
      verse_text LIKE $2 OR
      bible_reference LIKE $3 OR
      context LIKE $4 OR
      tags LIKE $5
    )
    ORDER BY date DESC
    LIMIT $6 OFFSET $7
  `, [orgId, searchTerm, searchTerm, searchTerm, searchTerm, parseInt(limit), parseInt(offset)], (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    // Get total count for pagination
    dbQuery.get(`
      SELECT COUNT(*) as total
      FROM ct_verses
      WHERE published = TRUE
      AND organization_id = $1
      AND (
        verse_text LIKE $2 OR
        bible_reference LIKE $3 OR
        context LIKE $4 OR
        tags LIKE $5
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
router.post('/search', optionalAuth, (req, res) => {
  const { query, limit = 20, offset = 0 } = req.body;
  const orgId = req.organization?.id || 1;
  
  if (!query || query.trim().length < 2) {
    return res.status(400).json({ success: false, error: 'Search query must be at least 2 characters' });
  }
  
  const searchTerm = `%${query.trim()}%`;
  
  dbQuery.all(`
    SELECT id, date, content_type, verse_text, image_path, bible_reference, context, tags, published
    FROM ct_verses
    WHERE published = TRUE
    AND organization_id = $1
    AND (
      verse_text LIKE $2 OR
      bible_reference LIKE $3 OR
      context LIKE $4 OR
      tags LIKE $5
    )
    ORDER BY date DESC
    LIMIT $6 OFFSET $7
  `, [orgId, searchTerm, searchTerm, searchTerm, searchTerm, parseInt(limit), parseInt(offset)], (err, rows) => {
    if (err) {
      console.error('Search verses error:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    dbQuery.get(`
      SELECT COUNT(*) as total
      FROM ct_verses
      WHERE published = TRUE
      AND organization_id = $1
      AND (
        verse_text LIKE $2 OR
        bible_reference LIKE $3 OR
        context LIKE $4 OR
        tags LIKE $5
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
router.get('/history/:days', optionalAuth, (req, res) => {
  const days = parseInt(req.params.days) || 30;
  const orgId = req.organization?.id || 1;
  
  // Calculate the date N days ago
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffDateStr = cutoffDate.toISOString().split('T')[0];
  
  dbQuery.all(`
    SELECT id, date, content_type, verse_text, image_path, bible_reference, context, tags, published
    FROM ct_verses
    WHERE published = TRUE
    AND organization_id = $1
    AND date >= $2
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

module.exports = router;
