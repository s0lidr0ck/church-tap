const express = require('express');
const bcrypt = require('bcryptjs');
const sharp = require('sharp');
const fs = require('fs');
const csv = require('csv-parser');
const { dbQuery, db } = require('../config/database');
const { requireAuth, requireOrgAuth, upload } = require('../config/middleware');
const s3Service = require('../services/s3Service');
const { VerseImportService } = require('../services/verseService');
const { BIBLE_VERSIONS } = require('../config/constants');

const router = express.Router();
const verseImportService = new VerseImportService();

// Admin login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password required' });
  }
  
  db.query(`SELECT au.*, o.name as organization_name, o.subdomain as organization_subdomain
           FROM ct_admin_users au
           LEFT JOIN ct_organizations o ON au.organization_id = o.id
           WHERE au.username = $1 AND au.is_active = TRUE`, [username], async (err, result) => {
    const user = result.rows[0];
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    if (!user || !await bcrypt.compare(password, user.password_hash)) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    
    if (!user.organization_id) {
      return res.status(401).json({ success: false, error: 'No organization assigned' });
    }
    
    req.session.adminId = user.id;
    req.session.adminUsername = user.username;
    req.session.organizationId = user.organization_id;
    req.session.organizationName = user.organization_name;
    req.session.admin = {
      id: user.id,
      username: user.username,
      role: user.role,
      organization_id: user.organization_id,
      organization_name: user.organization_name
    };
    
    res.json({ success: true, admin: { 
      id: user.id, 
      username: user.username, 
      role: user.role,
      organization_id: user.organization_id,
      organization_name: user.organization_name
    }});
  });
});

// Admin logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Check admin session status
router.get('/check-session', (req, res) => {
  if (req.session.adminId) {
    db.query(`SELECT au.*, o.name as organization_name, o.subdomain as organization_subdomain
            FROM ct_admin_users au
            LEFT JOIN ct_organizations o ON au.organization_id = o.id
            WHERE au.id = $1 AND au.is_active = TRUE`, [req.session.adminId], (err, result) => {
      const admin = result.rows[0];
      if (err) {
        console.error('Error checking admin session:', err);
        return res.json({ success: false, authenticated: false });
      }
      
      if (admin) {
        res.json({ 
          success: true, 
          authenticated: true, 
          admin: {
            id: admin.id,
            username: admin.username,
            role: admin.role,
            organization_id: admin.organization_id,
            organization_name: admin.organization_name,
            organization_subdomain: admin.organization_subdomain
          }
        });
      } else {
        res.json({ success: true, authenticated: false });
      }
    });
  } else {
    res.json({ 
      success: true, 
      authenticated: false 
    });
  }
});

// Get all verses (admin)
router.get('/verses', requireOrgAuth, (req, res) => {
  db.query(`SELECT * FROM ct_verses WHERE organization_id = $1 ORDER BY date DESC`, [req.organizationId], (err, result) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }

    const verses = (result.rows || []).map(verse => ({
      ...verse,
      date: verse.date ? new Date(verse.date).toISOString().split('T')[0] : null,
      created_at: verse.created_at ? new Date(verse.created_at).toLocaleString() : null,
      updated_at: verse.updated_at ? new Date(verse.updated_at).toLocaleString() : null
    }));
    
    res.json({ success: true, verses });
  });
});

// Create verse (admin)
router.post('/verses', requireOrgAuth, upload.single('image'), async (req, res) => {
  try {
    const { date, content_type, verse_text, bible_reference, context, tags, published } = req.body;
    let image_path = null;
    
    if (!date || !content_type) {
      return res.status(400).json({ success: false, error: 'Date and content type are required' });
    }
    
    if (content_type === 'text' && !verse_text) {
      return res.status(400).json({ success: false, error: 'Verse text is required for text verses' });
    }
    
    if (content_type === 'image' && req.file) {
      const processedImageBuffer = await sharp(req.file.buffer)
        .resize(720, 1280, { 
          fit: 'cover',
          position: 'center'
        })
        .jpeg({ quality: 85 })
        .toBuffer();
      
      const s3Result = await s3Service.uploadImage(processedImageBuffer, req.file.originalname);
      image_path = s3Result.path;
    }
    
    db.query(`INSERT INTO ct_verses (date, content_type, verse_text, image_path, bible_reference, context, tags, published, organization_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [date, content_type, verse_text, image_path, bible_reference, context, tags, published || 0, req.organizationId],
      (err, result) => {
        if (err) {
          return res.status(500).json({ success: false, error: 'Database error' });
        }

        res.json({ success: true, verse_id: result.rows[0].id });
      });
  } catch (error) {
    console.error('Error creating verse:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Update verse (admin)
router.put('/verses/:id', requireOrgAuth, upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    const { date, content_type, verse_text, bible_reference, context, tags, published } = req.body;
    let image_path = req.body.image_path;
    
    if (content_type === 'image' && req.file) {
      if (req.body.image_path) {
        await s3Service.deleteFile(req.body.image_path);
      }
      
      const processedImageBuffer = await sharp(req.file.buffer)
        .resize(720, 1280, { 
          fit: 'cover',
          position: 'center'
        })
        .jpeg({ quality: 85 })
        .toBuffer();
      
      const s3Result = await s3Service.uploadImage(processedImageBuffer, req.file.originalname);
      image_path = s3Result.path;
    }
    
    db.query(`UPDATE ct_verses SET date = $1, content_type = $2, verse_text = $3, image_path = $4,
            bible_reference = $5, context = $6, tags = $7, published = $8 WHERE id = $9 AND organization_id = $10`,
      [date, content_type, verse_text, image_path, bible_reference, context, tags, published, id, req.organizationId],
      (err, result) => {
        if (err) {
          return res.status(500).json({ success: false, error: 'Database error' });
        }
        
        res.json({ success: true });
      });
  } catch (error) {
    console.error('Error updating verse:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Delete verse (admin)
router.delete('/verses/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  
  db.query(`SELECT image_path FROM ct_verses WHERE id = $1 AND organization_id = $2`, [id, req.organizationId], (err, result) => {
    const verse = result.rows[0];
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    db.query(`DELETE FROM ct_verses WHERE id = $1 AND organization_id = $2`, [id, req.organizationId], (err, result) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      if (verse && verse.image_path) {
        s3Service.deleteFile(verse.image_path);
      }
      
      res.json({ success: true });
    });
  });
});

// Bulk operations (admin)
router.post('/verses/bulk', requireOrgAuth, (req, res) => {
  const { operation, verse_ids, data } = req.body;
  
  if (!operation || !verse_ids || !Array.isArray(verse_ids)) {
    return res.status(400).json({ success: false, error: 'Invalid bulk operation data' });
  }
  
  const placeholders = verse_ids.map((_, index) => `$${index + 1}`).join(',');
  const params = [...verse_ids, req.organizationId];
  
  switch (operation) {
    case 'delete':
      db.query(`DELETE FROM ct_verses WHERE id IN (${placeholders}) AND organization_id = $${verse_ids.length + 1}`, params, (err, result) => {
        if (err) {
          return res.status(500).json({ success: false, error: 'Database error' });
        }
        res.json({ success: true, affected: result.rowCount });
      });
      break;
      
    case 'publish':
      db.query(`UPDATE ct_verses SET published = TRUE WHERE id IN (${placeholders}) AND organization_id = $${verse_ids.length + 1}`, params, (err, result) => {
        if (err) {
          return res.status(500).json({ success: false, error: 'Database error' });
        }
        res.json({ success: true, affected: result.rowCount });
      });
      break;
      
    case 'unpublish':
      db.query(`UPDATE ct_verses SET published = FALSE WHERE id IN (${placeholders}) AND organization_id = $${verse_ids.length + 1}`, params, (err, result) => {
        if (err) {
          return res.status(500).json({ success: false, error: 'Database error' });
        }
        res.json({ success: true, affected: result.rowCount });
      });
      break;
      
    case 'update_tags':
      if (!data.tags) {
        return res.status(400).json({ success: false, error: 'Tags required for tag update' });
      }
      db.query(`UPDATE ct_verses SET tags = $1 WHERE id IN (${placeholders}) AND organization_id = $${verse_ids.length + 2}`, [data.tags, ...verse_ids, req.organizationId], (err, result) => {
        if (err) {
          return res.status(500).json({ success: false, error: 'Database error' });
        }
        res.json({ success: true, affected: result.rowCount });
      });
      break;
      
    default:
      res.status(400).json({ success: false, error: 'Unknown bulk operation' });
  }
});

// Templates management (admin)
router.get('/templates', requireOrgAuth, (req, res) => {
  const templates = [
    {
      id: 1,
      name: 'Hope & Encouragement',
      bible_reference: '[Reference]',
      context: 'This verse reminds us that even in difficult times, we can find hope and encouragement in God\'s promises.',
      tags: 'hope, encouragement, comfort, faith'
    },
    {
      id: 2,
      name: 'Strength & Perseverance',
      bible_reference: '[Reference]',
      context: 'When we feel weak or overwhelmed, this verse reminds us that our strength comes from the Lord.',
      tags: 'strength, perseverance, courage, endurance'
    },
    {
      id: 3,
      name: 'Peace & Rest',
      bible_reference: '[Reference]',
      context: 'In our busy and anxious world, God offers us true peace and rest for our souls.',
      tags: 'peace, rest, calm, tranquility'
    },
    {
      id: 4,
      name: 'Love & Grace',
      bible_reference: '[Reference]',
      context: 'This verse showcases the incredible depth of God\'s love and the amazing grace He extends to us.',
      tags: 'love, grace, mercy, forgiveness'
    },
    {
      id: 5,
      name: 'Wisdom & Guidance',
      bible_reference: '[Reference]',
      context: 'When facing decisions or uncertainty, we can trust in God\'s wisdom to guide our paths.',
      tags: 'wisdom, guidance, direction, trust'
    }
  ];
  
  res.json({ success: true, templates });
});

// CSV import
router.post('/verses/import', requireOrgAuth, upload.single('csv'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'CSV file required' });
  }
  
  const results = [];
  
  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', () => {
      let imported = 0;
      let errors = [];
      
      results.forEach((row, index) => {
        const { date, content_type, verse_text, bible_reference, context, tags, published } = row;
        
        if (!date || !content_type) {
          errors.push(`Row ${index + 1}: Date and content type are required`);
          return;
        }
        
        db.query(`INSERT INTO ct_verses (date, content_type, verse_text, bible_reference, context, tags, published, organization_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [date, content_type, verse_text || '', bible_reference || '', context || '', tags || '', published === 'true' ? 1 : 0, req.organizationId],
          (err, result) => {
            if (err) {
              errors.push(`Row ${index + 1}: ${err.message}`);
            } else {
              imported++;
            }
          });
      });
      
      fs.unlinkSync(req.file.path);
      
      setTimeout(() => {
        res.json({ 
          success: true, 
          imported, 
          errors: errors.length > 0 ? errors : null 
        });
      }, 1000);
    })
    .on('error', (err) => {
      fs.unlinkSync(req.file.path);
      res.status(500).json({ success: false, error: 'CSV parsing error' });
    });
});

// CSV export
router.get('/verses/export', requireOrgAuth, (req, res) => {
  db.query(`SELECT date, content_type, verse_text, bible_reference, context, tags, published FROM ct_verses WHERE organization_id = $1 ORDER BY date DESC`, [req.organizationId], (err, result) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }

    const csvHeader = 'date,content_type,verse_text,bible_reference,context,tags,published\n';
    const csvRows = (result.rows || []).map(row => {
      return [
        row.date,
        row.content_type,
        `"${(row.verse_text || '').replace(/"/g, '""')}"`,
        `"${(row.bible_reference || '').replace(/"/g, '""')}"`,
        `"${(row.context || '').replace(/"/g, '""')}"`,
        `"${(row.tags || '').replace(/"/g, '""')}"`,
        row.published ? 'true' : 'false'
      ].join(',');
    }).join('\n');
    
    const csv = csvHeader + csvRows;
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="verses-export.csv"');
    res.send(csv);
  });
});

// Verse import settings
router.get('/verse-import/settings', requireOrgAuth, (req, res) => {
  const organizationId = req.organizationId;
  
  db.query(
    `SELECT enabled, bible_version, import_time, fallback_versions
     FROM CT_verse_import_settings
     WHERE organization_id = $1`,
    [organizationId],
    (err, result) => {
      const row = result.rows[0];
      if (err) {
        console.error('Error fetching verse import settings:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      if (!row) {
        const defaultSettings = {
          enabled: true,
          bibleVersion: 'NIV',
          importTime: '00:00',
          fallbackVersions: ['NIV', 'NLT', 'KJV']
        };
        
        db.query(
          `INSERT INTO CT_verse_import_settings (organization_id, enabled, bible_version, import_time, fallback_versions)
           VALUES ($1, $2, $3, $4, $5)`,
          [organizationId, defaultSettings.enabled, defaultSettings.bibleVersion,
           defaultSettings.importTime, JSON.stringify(defaultSettings.fallbackVersions)],
          (insertErr, insertResult) => {
            if (insertErr) {
              console.error('Error creating default verse import settings:', insertErr);
            }
          }
        );
        
        return res.json({ success: true, settings: defaultSettings });
      }
      
      let fallbackVersions;
      try {
        fallbackVersions = typeof row.fallback_versions === 'string' 
          ? JSON.parse(row.fallback_versions) 
          : row.fallback_versions || ['NIV', 'NLT', 'KJV'];
      } catch (e) {
        console.warn('Invalid fallback_versions JSON:', row.fallback_versions, 'using defaults');
        fallbackVersions = ['NIV', 'NLT', 'KJV'];
      }
      
      res.json({
        success: true,
        settings: {
          enabled: row.enabled,
          bibleVersion: row.bible_version,
          importTime: row.import_time,
          fallbackVersions
        }
      });
    }
  );
});

// Update verse import settings
router.put('/verse-import/settings', requireOrgAuth, (req, res) => {
  const { enabled, bibleVersion, importTime, fallbackVersions } = req.body;
  const organizationId = req.organizationId;
  
  db.query(
    `UPDATE CT_verse_import_settings
     SET enabled = $1, bible_version = $2, import_time = $3, fallback_versions = $4
     WHERE organization_id = $5`,
    [enabled, bibleVersion, importTime, JSON.stringify(fallbackVersions), organizationId],
    (err, result) => {
      if (err) {
        console.error('Error updating verse import settings:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }

      if (result.rowCount === 0) {
        return res.status(404).json({ success: false, error: 'Settings not found' });
      }

      res.json({ success: true });
    }
  );
});

// Manual verse import
router.post('/verse-import/manual', requireOrgAuth, async (req, res) => {
  const { date, version = 'NIV' } = req.body;
  
  if (!date) {
    return res.status(400).json({ success: false, error: 'Date is required' });
  }
  
  try {
    const result = await verseImportService.importVerseForDate(req.organizationId, date, version);
    res.json({ success: true, verse: result });
  } catch (error) {
    console.error('Manual import error:', error);
    res.status(500).json({ success: false, error: error.message || 'Import failed' });
  }
});

// Check for missing verses
router.post('/verse-import/check', requireOrgAuth, async (req, res) => {
  const { date } = req.body;
  
  if (!date) {
    return res.status(400).json({ success: false, error: 'Date is required' });
  }
  
  try {
    const result = await verseImportService.checkAndImportMissingVerse(req.organizationId, date);
    if (result) {
      res.json({ success: true, imported: true, verse: result });
    } else {
      res.json({ success: true, imported: false, message: 'Verse already exists or import disabled' });
    }
  } catch (error) {
    console.error('Check import error:', error);
    res.status(500).json({ success: false, error: error.message || 'Check failed' });
  }
});

// Get available Bible versions
router.get('/verse-import/versions', (req, res) => {
  res.json({ success: true, versions: BIBLE_VERSIONS });
});

// Get dashboard stats for admin's organization
router.get('/dashboard', requireOrgAuth, (req, res) => {
  const organizationId = req.session.organizationId;
  
  if (!organizationId) {
    return res.status(400).json({ success: false, error: 'Organization ID required' });
  }

  Promise.all([
    // Total verses count
    new Promise((resolve, reject) => {
      db.query(`SELECT COUNT(*) as total FROM ct_verses WHERE organization_id = $1`, [organizationId], (err, result) => {
        if (err) reject(err);
        else resolve(result.rows[0]?.total || 0);
      });
    }),
    
    // Active users (unique visitors in last 30 days)
    new Promise((resolve, reject) => {
      db.query(`
        SELECT COUNT(DISTINCT ip_address) as active_users
        FROM ct_analytics
        WHERE organization_id = $1 AND timestamp >= NOW() - INTERVAL '30 days'
      `, [organizationId], (err, result) => {
        if (err) reject(err);
        else resolve(result.rows[0]?.active_users || 0);
      });
    }),
    
    // Total hearts
    new Promise((resolve, reject) => {
      db.query(`
        SELECT COUNT(*) as total_hearts
        FROM ct_analytics
        WHERE organization_id = $1 AND action = 'heart'
      `, [organizationId], (err, result) => {
        if (err) reject(err);
        else resolve(result.rows[0]?.total_hearts || 0);
      });
    })
  ])
  .then(([totalVerses, activeUsers, totalHearts]) => {
    res.json({
      success: true,
      stats: {
        total_verses: totalVerses,
        active_users: activeUsers,
        total_hearts: totalHearts
      }
    });
  })
  .catch(error => {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ success: false, error: 'Failed to load dashboard stats' });
  });
});

// Get analytics for admin's organization
router.get('/analytics', requireOrgAuth, (req, res) => {
  const { days = 7 } = req.query;
  const organizationId = req.session.organizationId;
  
  if (!organizationId) {
    return res.status(400).json({ success: false, error: 'Organization ID required' });
  }

  const timeFilter = `AND timestamp >= NOW() - INTERVAL '${parseInt(days)} days'`;
  
  Promise.all([
    // Daily verse views
    new Promise((resolve, reject) => {
      db.query(`
        SELECT
          DATE(timestamp) as date,
          COUNT(*) as views,
          COUNT(DISTINCT verse_id) as unique_verses,
          COUNT(DISTINCT ip_address) as unique_visitors
        FROM ct_analytics
        WHERE organization_id = $1 AND action IN ('verse_view', 'view')
        ${timeFilter}
        GROUP BY DATE(timestamp)
        ORDER BY date DESC
      `, [organizationId], (err, result) => {
        if (err) reject(err);
        else resolve(result.rows || []);
      });
    }),
    
    // Engagement actions (heart, favorite, share, download)
    new Promise((resolve, reject) => {
      db.query(`
        SELECT
          action,
          COUNT(*) as count,
          COUNT(DISTINCT verse_id) as unique_verses,
          COUNT(DISTINCT ip_address) as unique_users
        FROM ct_analytics
        WHERE organization_id = $1 AND action IN ('heart', 'favorite', 'share', 'download')
        ${timeFilter}
        GROUP BY action
        ORDER BY count DESC
      `, [organizationId], (err, result) => {
        if (err) reject(err);
        else resolve(result.rows || []);
      });
    }),
    
    // Top verses
    new Promise((resolve, reject) => {
      db.query(`
        SELECT
          v.id,
          v.bible_reference,
          v.verse_text,
          v.date,
          COUNT(a.id) as total_views,
          COUNT(CASE WHEN a.action = 'heart' THEN 1 END) as hearts,
          COUNT(CASE WHEN a.action = 'favorite' THEN 1 END) as favorites,
          COUNT(CASE WHEN a.action = 'share' THEN 1 END) as shares
        FROM ct_verses v
        LEFT JOIN ct_analytics a ON v.id = a.verse_id AND a.organization_id = $1 ${timeFilter.replace('timestamp', 'a.timestamp')}
        WHERE v.organization_id = $1 AND v.published = TRUE
        GROUP BY v.id, v.bible_reference, v.verse_text, v.date
        ORDER BY total_views DESC, v.date DESC
        LIMIT 10
      `, [organizationId], (err, result) => {
        if (err) reject(err);
        else resolve(result.rows || []);
      });
    }),
    
    // Enhanced tag interaction stats
    new Promise((resolve, reject) => {
      db.query(`
        SELECT
          COUNT(*) as total_scans,
          COUNT(DISTINCT session_id) as unique_sessions,
          COUNT(DISTINCT tag_id) as active_tags,
          COUNT(DISTINCT ip_address) as unique_visitors
        FROM tag_interactions
        WHERE organization_id = $1
        AND created_at >= NOW() - INTERVAL '${parseInt(days)} days'
      `, [organizationId], (err, result) => {
        if (err) reject(err);
        else {
          const stats = result.rows[0] || { total_scans: 0, unique_sessions: 0, active_tags: 0, unique_visitors: 0 };
          // Calculate average interactions per session separately if we have data
          if (stats.unique_sessions > 0) {
            stats.avg_interactions_per_session = (stats.total_scans / stats.unique_sessions).toFixed(1);
          } else {
            stats.avg_interactions_per_session = 0;
          }
          resolve(stats);
        }
      });
    }),
    
    // Daily tag scan trends
    new Promise((resolve, reject) => {
      db.query(`
        SELECT
          DATE(created_at) as date,
          COUNT(*) as scans,
          COUNT(DISTINCT session_id) as sessions,
          COUNT(DISTINCT tag_id) as unique_tags,
          COUNT(DISTINCT ip_address) as unique_visitors
        FROM tag_interactions
        WHERE organization_id = $1
        AND created_at >= NOW() - INTERVAL '${parseInt(days)} days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `, [organizationId], (err, result) => {
        if (err) reject(err);
        else resolve(result.rows || []);
      });
    }),
    
    // Top performing tags
    new Promise((resolve, reject) => {
      db.query(`
        SELECT
          t.tag_id,
          COUNT(*) as total_scans,
          COUNT(DISTINCT t.session_id) as unique_sessions,
          COUNT(DISTINCT t.ip_address) as unique_visitors,
          MAX(t.created_at) as last_scan,
          COUNT(CASE WHEN t.created_at >= NOW() - INTERVAL '24 hours' THEN 1 END) as scans_24h
        FROM tag_interactions t
        WHERE t.organization_id = $1
        AND t.created_at >= NOW() - INTERVAL '${parseInt(days)} days'
        GROUP BY t.tag_id
        ORDER BY total_scans DESC, last_scan DESC
        LIMIT 10
      `, [organizationId], (err, result) => {
        if (err) reject(err);
        else resolve(result.rows || []);
      });
    }),
    
    // Geographic analytics (simplified fallback)
    new Promise((resolve, reject) => {
      db.query(`
        SELECT
          s.country,
          s.city,
          s.region,
          COUNT(t.id) as total_scans,
          COUNT(DISTINCT t.session_id) as unique_sessions,
          COUNT(DISTINCT t.ip_address) as unique_visitors
        FROM tag_interactions t
        JOIN anonymous_sessions s ON t.session_id = s.session_id
        WHERE t.organization_id = $1
        AND t.created_at >= NOW() - INTERVAL '${parseInt(days)} days'
        AND (s.country IS NOT NULL OR s.city IS NOT NULL)
        GROUP BY s.country, s.city, s.region
        ORDER BY total_scans DESC
        LIMIT 50
      `, [organizationId], (err, result) => {
        if (err) {
          console.error('Geographic analytics error:', err);
          // Fallback: try to get any geographic data at all
          db.query(`
            SELECT DISTINCT country, city, region
            FROM anonymous_sessions
            WHERE (country IS NOT NULL OR city IS NOT NULL)
            LIMIT 10
          `, [], (err2, fallbackResult) => {
            if (err2) {
              console.error('Geographic fallback error:', err2);
              resolve([]);
            } else {
              console.log('Geographic fallback data:', fallbackResult.rows);
              resolve(fallbackResult.rows?.map(row => ({
                ...row,
                total_scans: 0,
                unique_sessions: 0,
                unique_visitors: 0
              })) || []);
            }
          });
        } else {
          console.log('Geographic data found:', result.rows?.length || 0, 'locations');
          resolve(result.rows || []);
        }
      });
    }),
    
    // Time-based patterns (hourly)
    new Promise((resolve, reject) => {
      db.query(`
        SELECT
          EXTRACT(HOUR FROM t.created_at) as hour,
          COUNT(*) as total_scans,
          COUNT(DISTINCT t.session_id) as unique_sessions
        FROM tag_interactions t
        WHERE t.organization_id = $1
        AND t.created_at >= NOW() - INTERVAL '${parseInt(days)} days'
        GROUP BY EXTRACT(HOUR FROM t.created_at)
        ORDER BY hour
      `, [organizationId], (err, result) => {
        if (err) reject(err);
        else resolve(result.rows || []);
      });
    }),
    
    // Day-of-week patterns
    new Promise((resolve, reject) => {
      db.query(`
        SELECT
          EXTRACT(DOW FROM t.created_at) as day_of_week,
          COUNT(*) as total_scans,
          COUNT(DISTINCT t.session_id) as unique_sessions,
          COUNT(DISTINCT DATE(t.created_at)) as active_days
        FROM tag_interactions t
        WHERE t.organization_id = $1
        AND t.created_at >= NOW() - INTERVAL '${parseInt(days)} days'
        GROUP BY EXTRACT(DOW FROM t.created_at)
        ORDER BY day_of_week
      `, [organizationId], (err, result) => {
        if (err) reject(err);
        else resolve(result.rows || []);
      });
    }),
    
    // Content engagement funnel (simplified)
    new Promise((resolve, reject) => {
      Promise.all([
        // Scans
        new Promise((resolve, reject) => {
          db.query(`
            SELECT COUNT(DISTINCT session_id) as sessions, COUNT(*) as total_actions
            FROM tag_interactions
            WHERE organization_id = $1 AND created_at >= NOW() - INTERVAL '${parseInt(days)} days'
          `, [organizationId], (err, result) => {
            if (err) reject(err);
            else resolve({ stage: 'scan', ...result.rows[0] });
          });
        }),
        // Hearts
        new Promise((resolve, reject) => {
          db.query(`
            SELECT COUNT(DISTINCT tagged_session_id) as sessions, COUNT(*) as total_actions
            FROM CT_analytics
            WHERE organization_id = $1 AND action = 'heart'
            AND timestamp >= NOW() - INTERVAL '${parseInt(days)} days'
          `, [organizationId], (err, result) => {
            if (err) {
              console.error('Hearts analytics error:', err);
              resolve({ stage: 'heart', sessions: 0, total_actions: 0 });
            } else {
              resolve({ stage: 'heart', ...result.rows[0] });
            }
          });
        }),
        // Community actions
        new Promise((resolve, reject) => {
          db.query(`
            SELECT COUNT(DISTINCT originating_tag_id) as sessions, COUNT(*) as total_actions
            FROM CT_prayer_requests
            WHERE organization_id = $1 AND created_at >= NOW() - INTERVAL '${parseInt(days)} days'
            AND originating_tag_id IS NOT NULL
          `, [organizationId], (err, result) => {
            if (err) {
              console.error('Community analytics error:', err);
              resolve({ stage: 'community_action', sessions: 0, total_actions: 0 });
            } else {
              resolve({ stage: 'community_action', ...result.rows[0] });
            }
          });
        })
      ]).then(results => resolve(results)).catch(reject);
    }),
    
    // Return visitor analysis
    new Promise((resolve, reject) => {
      db.query(`
        SELECT
          visitor_sessions.unique_visitors,
          visitor_sessions.total_sessions,
          visitor_sessions.avg_sessions_per_visitor,
          multi_tag_users.multi_tag_visitors,
          recent_returns.return_visitors_7d
        FROM (
          SELECT
            COUNT(DISTINCT ip_address) as unique_visitors,
            COUNT(DISTINCT session_id) as total_sessions,
            ROUND(COUNT(DISTINCT session_id)::numeric / COUNT(DISTINCT ip_address), 2) as avg_sessions_per_visitor
          FROM tag_interactions
          WHERE organization_id = $1
          AND created_at >= NOW() - INTERVAL '${parseInt(days)} days'
        ) visitor_sessions
        CROSS JOIN (
          SELECT COUNT(*) as multi_tag_visitors
          FROM (
            SELECT ip_address
            FROM tag_interactions
            WHERE organization_id = $1
            AND created_at >= NOW() - INTERVAL '${parseInt(days)} days'
            GROUP BY ip_address
            HAVING COUNT(DISTINCT tag_id) > 1
          ) multi_users
        ) multi_tag_users
        CROSS JOIN (
          SELECT COUNT(*) as return_visitors_7d
          FROM (
            SELECT ip_address
            FROM tag_interactions
            WHERE organization_id = $1
            AND created_at >= NOW() - INTERVAL '${parseInt(days)} days'
            GROUP BY ip_address
            HAVING COUNT(DISTINCT DATE(created_at)) > 1
          ) returning_users
        ) recent_returns
      `, [organizationId], (err, result) => {
        if (err) reject(err);
        else resolve(result.rows[0] || { unique_visitors: 0, total_sessions: 0, avg_sessions_per_visitor: 0, multi_tag_visitors: 0, return_visitors_7d: 0 });
      });
    })
  ])
  .then(([dailyStats, engagementStats, topVerses, tagStats, dailyScans, topTags, geoLocations, hourlyPatterns, weeklyPatterns, engagementFunnel, visitorRetention]) => {
    res.json({
      success: true,
      analytics: {
        daily_stats: dailyStats,
        engagement_stats: engagementStats,
        top_verses: topVerses,
        tag_stats: tagStats,
        daily_scans: dailyScans,
        top_tags: topTags,
        geo_locations: geoLocations,
        hourly_patterns: hourlyPatterns,
        weekly_patterns: weeklyPatterns,
        engagement_funnel: engagementFunnel,
        visitor_retention: visitorRetention,
        organization_id: organizationId,
        timeframe: `${days} days`
      }
    });
  })
  .catch(error => {
    console.error('Admin analytics error:', error);
    res.status(500).json({ success: false, error: 'Failed to load analytics data', details: error.message });
  });
});

// Get community data (prayer requests, praise reports)
router.get('/community', requireOrgAuth, (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const organizationId = req.organizationId;
  
  Promise.all([
    // Prayer requests
    new Promise((resolve, reject) => {
      db.query(`
        SELECT COUNT(*) as count, DATE(created_at) as date
        FROM ct_prayer_requests
        WHERE organization_id = $1 AND created_at >= NOW() - INTERVAL '${days} days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `, [organizationId], (err, result) => {
        if (err) reject(err);
        else resolve(result.rows || []);
      });
    }),
    
    // Praise reports
    new Promise((resolve, reject) => {
      db.query(`
        SELECT COUNT(*) as count, DATE(created_at) as date
        FROM ct_praise_reports
        WHERE organization_id = $1 AND created_at >= NOW() - INTERVAL '${days} days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `, [organizationId], (err, result) => {
        if (err) reject(err);
        else resolve(result.rows || []);
      });
    }),
    
    // Recent prayer requests
    new Promise((resolve, reject) => {
      db.query(`
        SELECT id, content, prayer_count, created_at, is_hidden
        FROM ct_prayer_requests
        WHERE organization_id = $1
        ORDER BY created_at DESC
        LIMIT 20
      `, [organizationId], (err, result) => {
        if (err) reject(err);
        else resolve(result.rows || []);
      });
    }),
    
    // Recent praise reports
    new Promise((resolve, reject) => {
      db.query(`
        SELECT id, content, celebration_count, created_at, is_hidden
        FROM ct_praise_reports
        WHERE organization_id = $1
        ORDER BY created_at DESC
        LIMIT 20
      `, [organizationId], (err, result) => {
        if (err) reject(err);
        else resolve(result.rows || []);
      });
    }),
    
    // Recent verse insights
    new Promise((resolve, reject) => {
      db.query(`
        SELECT
          p.id,
          p.content,
          COUNT(i.id) as heart_count,
          p.created_at,
          p.is_hidden
        FROM ct_verse_community_posts p
        LEFT JOIN ct_verse_community_interactions i ON p.id = i.post_id
        WHERE p.organization_id = $1
        GROUP BY p.id, p.content, p.created_at, p.is_hidden
        ORDER BY p.created_at DESC
        LIMIT 20
      `, [organizationId], (err, result) => {
        if (err) reject(err);
        else resolve(result.rows || []);
      });
    })
  ])
  .then(([prayerData, praiseData, recentPrayers, recentPraise, recentInsights]) => {
    res.json({
      success: true,
      community: {
        prayer_requests: prayerData,
        praise_reports: praiseData,
        recent_prayers: recentPrayers,
        recent_praise: recentPraise,
        verse_insights: recentInsights || [],
        timeframe: `${days} days`
      }
    });
  })
  .catch(error => {
    console.error('Community data error:', error);
    res.status(500).json({ success: false, error: 'Failed to load community data' });
  });
});

// Get bracelet requests
router.get('/bracelet-requests', requireOrgAuth, (req, res) => {
  const organizationId = req.organizationId;
  
  db.query(`
    SELECT br.*, u.email, u.first_name, u.last_name
    FROM ct_bracelet_requests br
    LEFT JOIN ct_users u ON br.user_id = u.id
    WHERE br.organization_id = $1
    ORDER BY br.created_at DESC
  `, [organizationId], (err, result) => {
    if (err) {
      console.error('Bracelet requests error:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }

    const requests = result.rows.map(request => ({
      ...request,
      created_at: request.created_at ? new Date(request.created_at).toLocaleString() : null,
      updated_at: request.updated_at ? new Date(request.updated_at).toLocaleString() : null
    }));

    res.json({ success: true, requests });
  });
});

// Update bracelet request status
router.put('/bracelet-requests/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  const { status, admin_notes } = req.body;
  const organizationId = req.organizationId;
  
  db.query(`
    UPDATE ct_bracelet_requests
    SET status = $1, admin_notes = $2, updated_at = NOW()
    WHERE id = $3 AND organization_id = $4
  `, [status, admin_notes, id, organizationId], (err, result) => {
    if (err) {
      console.error('Update bracelet request error:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }

    res.json({ success: true });
  });
});

// Prayer Request Moderation
router.put('/prayer-request/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  const { action, reason } = req.body; // action: 'hide' or 'unhide'
  const organizationId = req.organizationId;
  
  if (action === 'hide') {
    db.query(`
      UPDATE ct_prayer_requests
      SET is_hidden = true
      WHERE id = $1 AND organization_id = $2
    `, [id, organizationId], (err, result) => {
      if (err) {
        console.error('Error hiding prayer request:', err);
        return res.status(500).json({ success: false, error: 'Failed to hide prayer request' });
      }
      res.json({ success: true, message: 'Prayer request hidden' });
    });
  } else if (action === 'unhide') {
    db.query(`
      UPDATE ct_prayer_requests
      SET is_hidden = false
      WHERE id = $1 AND organization_id = $2
    `, [id, organizationId], (err, result) => {
      if (err) {
        console.error('Error unhiding prayer request:', err);
        return res.status(500).json({ success: false, error: 'Failed to unhide prayer request' });
      }
      res.json({ success: true, message: 'Prayer request unhidden' });
    });
  } else {
    res.status(400).json({ success: false, error: 'Invalid action. Use "hide" or "unhide"' });
  }
});

// Praise Report Moderation
router.put('/praise-report/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  const { action, reason } = req.body; // action: 'hide' or 'unhide'
  const organizationId = req.organizationId;
  
  if (action === 'hide') {
    db.query(`
      UPDATE ct_praise_reports
      SET is_hidden = true
      WHERE id = $1 AND organization_id = $2
    `, [id, organizationId], (err, result) => {
      if (err) {
        console.error('Error hiding praise report:', err);
        return res.status(500).json({ success: false, error: 'Failed to hide praise report' });
      }
      res.json({ success: true, message: 'Praise report hidden' });
    });
  } else if (action === 'unhide') {
    db.query(`
      UPDATE ct_praise_reports
      SET is_hidden = false
      WHERE id = $1 AND organization_id = $2
    `, [id, organizationId], (err, result) => {
      if (err) {
        console.error('Error unhiding praise report:', err);
        return res.status(500).json({ success: false, error: 'Failed to unhide praise report' });
      }
      res.json({ success: true, message: 'Praise report unhidden' });
    });
  } else {
    res.status(400).json({ success: false, error: 'Invalid action. Use "hide" or "unhide"' });
  }
});

// Verse Insight Moderation
router.put('/verse-insight/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  const { action, reason } = req.body; // action: 'hide' or 'unhide'
  const organizationId = req.organizationId;

  if (action === 'hide') {
    db.query(`
      UPDATE ct_verse_community_posts
      SET is_hidden = true
      WHERE id = $1 AND organization_id = $2
    `, [id, organizationId], (err, result) => {
      if (err) {
        console.error('Error hiding verse insight:', err);
        return res.status(500).json({ success: false, error: 'Failed to hide verse insight' });
      }
      res.json({ success: true, message: 'Verse insight hidden' });
    });
  } else if (action === 'unhide') {
    db.query(`
      UPDATE ct_verse_community_posts
      SET is_hidden = false
      WHERE id = $1 AND organization_id = $2
    `, [id, organizationId], (err, result) => {
      if (err) {
        console.error('Error unhiding verse insight:', err);
        return res.status(500).json({ success: false, error: 'Failed to unhide verse insight' });
      }
      res.json({ success: true, message: 'Verse insight unhidden' });
    });
  } else {
    res.status(400).json({ success: false, error: 'Invalid action. Use "hide" or "unhide"' });
  }
});

// Get user tag data for organization
router.get('/users', requireOrgAuth, (req, res) => {
  const organizationId = req.organizationId;

  Promise.all([
    // Get all tag IDs that have interacted with this organization
    new Promise((resolve, reject) => {
      db.query(`
        SELECT DISTINCT
          ti.tag_id,
          ti.ip_address,
          MAX(ti.created_at) as last_activity,
          MIN(ti.created_at) as first_activity,
          COUNT(*) as total_interactions,
          COUNT(DISTINCT DATE(ti.created_at)) as active_days
        FROM tag_interactions ti
        WHERE ti.organization_id = $1
        GROUP BY ti.tag_id, ti.ip_address
        ORDER BY last_activity DESC
      `, [organizationId], (err, result) => {
        if (err) reject(err);
        else resolve(result.rows || []);
      });
    }),

    // Get community post counts by tag
    new Promise((resolve, reject) => {
      db.query(`
        SELECT
          originating_tag_id as tag_id,
          COUNT(CASE WHEN table_name = 'prayer_requests' THEN 1 END) as prayer_count,
          COUNT(CASE WHEN table_name = 'praise_reports' THEN 1 END) as praise_count,
          COUNT(CASE WHEN table_name = 'verse_insights' THEN 1 END) as insight_count,
          COUNT(*) as total_posts
        FROM (
          SELECT originating_tag_id, 'prayer_requests' as table_name
          FROM ct_prayer_requests
          WHERE organization_id = $1 AND originating_tag_id IS NOT NULL

          UNION ALL

          SELECT originating_tag_id, 'praise_reports' as table_name
          FROM ct_praise_reports
          WHERE organization_id = $1 AND originating_tag_id IS NOT NULL

          UNION ALL

          SELECT originating_tag_id, 'verse_insights' as table_name
          FROM ct_verse_community_posts
          WHERE organization_id = $1 AND originating_tag_id IS NOT NULL
        ) combined_posts
        WHERE originating_tag_id IS NOT NULL
        GROUP BY originating_tag_id
      `, [organizationId], (err, result) => {
        if (err) reject(err);
        else resolve(result.rows || []);
      });
    })
  ])
  .then(([tagInteractions, communityPosts]) => {
    // Merge the data
    const communityMap = new Map();
    communityPosts.forEach(post => {
      communityMap.set(post.tag_id, post);
    });

    const userTags = tagInteractions.map(tag => ({
      ...tag,
      community_posts: communityMap.get(tag.tag_id) || {
        prayer_count: 0,
        praise_count: 0,
        insight_count: 0,
        total_posts: 0
      }
    }));

    res.json({
      success: true,
      users: userTags,
      stats: {
        total_tags: userTags.length,
        active_tags: userTags.filter(u => u.total_interactions > 0).length,
        community_contributors: userTags.filter(u => u.community_posts.total_posts > 0).length
      }
    });
  })
  .catch(error => {
    console.error('Users data error:', error);
    res.status(500).json({ success: false, error: 'Failed to load user data' });
  });
});

// Get detailed posts for a specific tag
router.get('/users/:tagId/posts', requireOrgAuth, (req, res) => {
  const { tagId } = req.params;
  const organizationId = req.organizationId;

  Promise.all([
    // Prayer requests
    new Promise((resolve, reject) => {
      db.query(`
        SELECT id, content, prayer_count, created_at, is_hidden, 'prayer_request' as type
        FROM ct_prayer_requests
        WHERE organization_id = $1 AND originating_tag_id = $2
        ORDER BY created_at DESC
      `, [organizationId, tagId], (err, result) => {
        if (err) reject(err);
        else resolve(result.rows || []);
      });
    }),

    // Praise reports
    new Promise((resolve, reject) => {
      db.query(`
        SELECT id, content, celebration_count as prayer_count, created_at, is_hidden, 'praise_report' as type
        FROM ct_praise_reports
        WHERE organization_id = $1 AND originating_tag_id = $2
        ORDER BY created_at DESC
      `, [organizationId, tagId], (err, result) => {
        if (err) reject(err);
        else resolve(result.rows || []);
      });
    }),

    // Verse insights
    new Promise((resolve, reject) => {
      db.query(`
        SELECT
          p.id,
          p.content,
          COUNT(i.id) as prayer_count,
          p.created_at,
          p.is_hidden,
          'verse_insight' as type
        FROM ct_verse_community_posts p
        LEFT JOIN ct_verse_community_interactions i ON p.id = i.post_id
        WHERE p.organization_id = $1 AND p.originating_tag_id = $2
        GROUP BY p.id, p.content, p.created_at, p.is_hidden
        ORDER BY p.created_at DESC
      `, [organizationId, tagId], (err, result) => {
        if (err) reject(err);
        else resolve(result.rows || []);
      });
    })
  ])
  .then(([prayers, praise, insights]) => {
    const allPosts = [...prayers, ...praise, ...insights]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({
      success: true,
      tagId,
      posts: allPosts,
      stats: {
        prayer_requests: prayers.length,
        praise_reports: praise.length,
        verse_insights: insights.length,
        total: allPosts.length
      }
    });
  })
  .catch(error => {
    console.error('Tag posts error:', error);
    res.status(500).json({ success: false, error: 'Failed to load tag posts' });
  });
});

module.exports = router;