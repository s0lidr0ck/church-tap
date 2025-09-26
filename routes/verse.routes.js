const express = require('express');
const QRCode = require('qrcode');
const { dbQuery } = require('../config/database');
const { optionalAuth } = require('../config/middleware');
const { generateVerseImage } = require('../services/imageService');
const { getBookName } = require('../config/constants');

const router = express.Router();

// Get random verse from bolls.life API
router.get('/random', async (req, res) => {
  console.log('🎲 Random verse endpoint called - URL:', req.url);
  console.log('🎲 Query params:', req.query);
  try {
    // Use NASB translation by default, could be made configurable per user/org
    const translation = 'NASB';
    console.log('🌐 Fetching from bolls.life API...');
    const bollsResponse = await fetch(`https://bolls.life/get-random-verse/${translation}/`);
    
    if (!bollsResponse.ok) {
      throw new Error(`Bolls.life API error: ${bollsResponse.status}`);
    }
    
    const bollsData = await bollsResponse.json();
    console.log('📖 Received data from bolls.life:', bollsData);
    
    // Convert bolls.life format to our app's format
    const bookName = getBookName(bollsData.book);
    const reference = `${bookName} ${bollsData.chapter}:${bollsData.verse}`;
    
    const verse = {
      id: `bolls_${bollsData.pk}`,
      date: new Date().toISOString().split('T')[0],
      content_type: 'text',
      verse_text: bollsData.text,
      bible_reference: reference,
      context: `Random verse from ${translation} translation via bolls.life`,
      tags: 'random,external',
      published: true,
      hearts: 0,
      source: 'bolls.life',
      translation: bollsData.translation,
      external_id: bollsData.pk
    };
    
    console.log('✅ Sending verse response');
    res.json({ success: true, verse });
    
  } catch (error) {
    console.error('Error fetching random verse from bolls.life:', error);
    
    // Fallback to local database if bolls.life is unavailable
    console.log('🔄 Falling back to local database...');
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const twoWeeksAgoStr = twoWeeksAgo.toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    const orgId = req.organizationId || 1;
    
    dbQuery.get(`SELECT * FROM ct_verses WHERE date BETWEEN $1 AND $2 AND published = TRUE AND organization_id = $3 ORDER BY RANDOM() LIMIT 1`, 
      [twoWeeksAgoStr, today, orgId], (err, row) => {
      if (err) {
        console.error('Database error in fallback:', err);
        return res.status(500).json({ success: false, error: 'Database error in fallback' });
      }
      if (!row) {
        return res.status(404).json({ success: false, error: 'No verses found for this organization' });
      }
      
      res.json({ success: true, verse: row });
    });
  }
});

// Get verse by date (with personalization support)
router.get('/:date', optionalAuth, async (req, res) => {
  const { date } = req.params;
  const orgId = req.organizationId || 1;
  
  try {
    dbQuery.get(`SELECT * FROM ct_verses WHERE date = $1 AND published = TRUE AND organization_id = $2`, [date, orgId], async (err, scheduledVerse) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      if (!req.user || !scheduledVerse) {
        if (scheduledVerse) {
          return res.json({ success: true, verse: scheduledVerse });
        } else {
          return res.json({ success: false, message: 'No verse found for this date' });
        }
      }

      // For logged-in users, try to find a personalized verse
      try {
        dbQuery.get(`SELECT * FROM ct_user_preferences WHERE user_id = $1`, [req.user.userId], (err, prefs) => {
          if (err || !prefs) {
            return res.json({ success: true, verse: scheduledVerse });
          }

          const interests = prefs.interests ? JSON.parse(prefs.interests) : [];
          const struggles = prefs.struggles ? JSON.parse(prefs.struggles) : [];
          const allTopics = [...interests, ...struggles];
          
          if (allTopics.length === 0) {
            return res.json({ success: true, verse: scheduledVerse });
          }

          // Build personalization query
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
            FROM ct_verses 
            WHERE published = TRUE 
            AND date <= $1 
            AND (${conditions})
            AND organization_id = $2
            ORDER BY relevance_score DESC, ABS((date - $3::date)) ASC
            LIMIT 1
          `;

          dbQuery.get(personalizedQuery, [...searchParams, date, orgId, date], (err, personalizedVerse) => {
            if (err) {
              console.error('Personalization query error:', err);
              return res.json({ success: true, verse: scheduledVerse });
            }

            if (personalizedVerse && personalizedVerse.relevance_score > 2) {
              personalizedVerse.personalized = true;
              personalizedVerse.reason = 'Selected based on your interests and preferences';
              return res.json({ success: true, verse: personalizedVerse });
            }

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

// Generate QR code for verse
router.get('/qr/:id', async (req, res) => {
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
    console.error('QR code generation error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate QR code' });
  }
});

// Generate verse image
router.post('/generate-image', async (req, res) => {
  try {
    const { verse_text, bible_reference } = req.body;
    
    if (!verse_text || !bible_reference) {
      return res.status(400).json({ success: false, error: 'verse_text and bible_reference are required' });
    }

    const result = await generateVerseImage(verse_text, bible_reference);
    res.json(result);
  } catch (error) {
    console.error('Image generation error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate image' });
  }
});

module.exports = router;
