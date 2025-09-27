const express = require('express');
const { dbQuery, db } = require('../config/database');
const { requireOrgAuth } = require('../config/middleware');

const router = express.Router();

// Submit verse community post
router.post('/', (req, res) => {
  const { content, verse_reference, user_token, date } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  const today = date || new Date().toISOString().split('T')[0];
  const orgId = req.organizationId || 1;
  
  // Get session attribution from cookies
  const taggedSessionId = req.cookies?.taggedSession;
  const originatingTagId = req.cookies?.originatingTag;
  
  console.log(`Verse community post - org: ${req.query.org}, orgId: ${orgId}, taggedSession: ${taggedSessionId}, originatingTag: ${originatingTagId}`);
  
  if (!content || content.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Post content is required' });
  }
  
  if (content.length > 500) {
    return res.status(400).json({ success: false, error: 'Post too long (max 500 characters)' });
  }
  
  if (!verse_reference) {
    return res.status(400).json({ success: false, error: 'Verse reference is required' });
  }
  
  dbQuery.run(`
    INSERT INTO ct_verse_community_posts
    (verse_reference, date, content, author_name, user_token, ip_address, organization_id, is_approved, tagged_session_id, originating_tag_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8, $9)
  `, [verse_reference, today, content.trim(), 'Anonymous', user_token, ip, orgId, taggedSessionId, originatingTagId], function(err) {
    if (err) {
      console.error('Error submitting verse community post:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    // Update session activity timestamp if we have a tagged session
    if (taggedSessionId) {
      dbQuery.run(`UPDATE anonymous_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE tagged_session_id = $1`, [taggedSessionId]);
      console.log(`📖 Verse community post linked to tag session: ${originatingTagId}`);
    }
    
    res.json({ success: true, post_id: this.lastID });
  });
});

// Heart/like a community post
router.post('/heart', (req, res) => {
  const { post_id, user_token } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  const orgId = req.organizationId || 1;
  
  if (!post_id || !user_token) {
    return res.status(400).json({ success: false, error: 'Post ID and user token are required' });
  }
  
  // Check if user already hearted this post
  db.query(`
    SELECT id FROM ct_verse_community_interactions
    WHERE post_id = $1 AND user_token = $2
  `, [post_id, user_token], (err, result) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }

    if (result.rows && result.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'You have already hearted this post' });
    }
    
    // Add interaction
    dbQuery.run(`
      INSERT INTO ct_verse_community_interactions (post_id, user_token, ip_address)
      VALUES ($1, $2, $3)
    `, [post_id, user_token, ip], function(err) {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      // Update heart count
      dbQuery.run(`
        UPDATE ct_verse_community_posts SET heart_count = heart_count + 1 WHERE id = $1
      `, [post_id], (err) => {
        if (err) {
          return res.status(500).json({ success: false, error: 'Database error' });
        }
        
        // Get updated count
        db.query(`
          SELECT heart_count FROM ct_verse_community_posts WHERE id = $1
        `, [post_id], (err, result) => {
          if (err) {
            return res.status(500).json({ success: false, error: 'Database error' });
          }

          res.json({ success: true, heart_count: result.rows && result.rows.length > 0 ? result.rows[0].heart_count : 0 });
        });
      });
    });
  });
});

// Admin: Get verse community posts for moderation
router.get('/admin', requireOrgAuth, (req, res) => {
  const { days = 7 } = req.query;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];
  
  db.query(`
    SELECT * FROM ct_verse_community_posts
    WHERE date >= $1 AND organization_id = $2
    ORDER BY date DESC, created_at DESC
  `, [startDateStr, req.organizationId], (err, result) => {
    if (err) {
      console.error('Error fetching admin verse community posts:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }

    res.json({
      success: true,
      posts: result.rows || []
    });
  });
});

// Admin: Moderate verse community post
router.put('/admin/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  const { is_approved, is_hidden } = req.body;
  
  dbQuery.run(`
    UPDATE ct_verse_community_posts SET is_approved = $1, is_hidden = $2 
    WHERE id = $3 AND organization_id = $4
  `, [is_approved ? 1 : 0, is_hidden ? 1 : 0, id, req.organizationId], function(err) {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    res.json({ success: true });
  });
});

// Admin: Delete verse community post
router.delete('/admin/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  
  if (!id || isNaN(id)) {
    return res.status(400).json({ success: false, error: 'Invalid post ID' });
  }
  
  // Delete post (only from this organization)
  dbQuery.run(`
    DELETE FROM ct_verse_community_posts WHERE id = $1 AND organization_id = $2
  `, [id, req.organizationId], function(err) {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    res.json({ success: true });
  });
});

module.exports = router;
