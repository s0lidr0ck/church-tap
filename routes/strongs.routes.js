const express = require('express');
const { dbQuery } = require('../config/database');

const router = express.Router();

// Get verse with Strong's numbers (KJV only)
router.get('/:book/:chapter/:verse', async (req, res) => {
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
router.get('/definition/:number', async (req, res) => {
  const { number } = req.params;
  
  // First check if we have it cached
  dbQuery.get(`
    SELECT * FROM ct_strongs_references WHERE strongs_number = $1
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
    
    // If not cached, try to fetch from external API (placeholder)
    res.status(404).json({ success: false, error: 'Strong\'s definition not found' });
  });
});

module.exports = router;
