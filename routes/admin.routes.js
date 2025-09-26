const express = require('express');
const bcrypt = require('bcryptjs');
const sharp = require('sharp');
const fs = require('fs');
const csv = require('csv-parser');
const { dbQuery } = require('../config/database');
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
  
  dbQuery.get(`SELECT au.*, o.name as organization_name, o.subdomain as organization_subdomain 
           FROM ct_admin_users au 
           LEFT JOIN ct_organizations o ON au.organization_id = o.id 
           WHERE au.username = $1 AND au.is_active = TRUE`, [username], async (err, user) => {
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
    dbQuery.get(`SELECT au.*, o.name as organization_name, o.subdomain as organization_subdomain 
            FROM ct_admin_users au 
            LEFT JOIN ct_organizations o ON au.organization_id = o.id 
            WHERE au.id = $1 AND au.is_active = TRUE`, [req.session.adminId], (err, admin) => {
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
  dbQuery.all(`SELECT * FROM ct_verses WHERE organization_id = $1 ORDER BY date DESC`, [req.organizationId], (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    const verses = rows.map(verse => ({
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
    
    dbQuery.run(`INSERT INTO ct_verses (date, content_type, verse_text, image_path, bible_reference, context, tags, published, organization_id) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [date, content_type, verse_text, image_path, bible_reference, context, tags, published || 0, req.organizationId],
      function(err) {
        if (err) {
          return res.status(500).json({ success: false, error: 'Database error' });
        }
        
        res.json({ success: true, verse_id: this.lastID });
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
    
    dbQuery.run(`UPDATE ct_verses SET date = $1, content_type = $2, verse_text = $3, image_path = $4, 
            bible_reference = $5, context = $6, tags = $7, published = $8 WHERE id = $9 AND organization_id = $10`,
      [date, content_type, verse_text, image_path, bible_reference, context, tags, published, id, req.organizationId],
      function(err) {
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
  
  dbQuery.get(`SELECT image_path FROM ct_verses WHERE id = $1 AND organization_id = $2`, [id, req.organizationId], (err, verse) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    dbQuery.run(`DELETE FROM ct_verses WHERE id = $1 AND organization_id = $2`, [id, req.organizationId], function(err) {
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
  
  const placeholders = verse_ids.map(() => '?').join(',');
  const params = [...verse_ids, req.organizationId];
  
  switch (operation) {
    case 'delete':
      dbQuery.run(`DELETE FROM ct_verses WHERE id IN (${placeholders}) AND organization_id = $${params.length}`, params, function(err) {
        if (err) {
          return res.status(500).json({ success: false, error: 'Database error' });
        }
        res.json({ success: true, affected: this.changes });
      });
      break;
      
    case 'publish':
      dbQuery.run(`UPDATE ct_verses SET published = TRUE WHERE id IN (${placeholders}) AND organization_id = $${params.length}`, params, function(err) {
        if (err) {
          return res.status(500).json({ success: false, error: 'Database error' });
        }
        res.json({ success: true, affected: this.changes });
      });
      break;
      
    case 'unpublish':
      dbQuery.run(`UPDATE ct_verses SET published = FALSE WHERE id IN (${placeholders}) AND organization_id = $${params.length}`, params, function(err) {
        if (err) {
          return res.status(500).json({ success: false, error: 'Database error' });
        }
        res.json({ success: true, affected: this.changes });
      });
      break;
      
    case 'update_tags':
      if (!data.tags) {
        return res.status(400).json({ success: false, error: 'Tags required for tag update' });
      }
      dbQuery.run(`UPDATE ct_verses SET tags = $1 WHERE id IN (${placeholders}) AND organization_id = $${verse_ids.length + 2}`, [data.tags, ...verse_ids, req.organizationId], function(err) {
        if (err) {
          return res.status(500).json({ success: false, error: 'Database error' });
        }
        res.json({ success: true, affected: this.changes });
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
        
        dbQuery.run(`INSERT INTO ct_verses (date, content_type, verse_text, bible_reference, context, tags, published, organization_id) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [date, content_type, verse_text || '', bible_reference || '', context || '', tags || '', published === 'true' ? 1 : 0, req.organizationId],
          function(err) {
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
  dbQuery.all(`SELECT date, content_type, verse_text, bible_reference, context, tags, published FROM ct_verses WHERE organization_id = $1 ORDER BY date DESC`, [req.organizationId], (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    const csvHeader = 'date,content_type,verse_text,bible_reference,context,tags,published\n';
    const csvRows = rows.map(row => {
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
  
  dbQuery.get(
    `SELECT enabled, bible_version, import_time, fallback_versions 
     FROM CT_verse_import_settings 
     WHERE organization_id = $1`,
    [organizationId],
    (err, row) => {
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
        
        dbQuery.run(
          `INSERT INTO CT_verse_import_settings (organization_id, enabled, bible_version, import_time, fallback_versions)
           VALUES (?, ?, ?, ?, ?)`,
          [organizationId, defaultSettings.enabled, defaultSettings.bibleVersion, 
           defaultSettings.importTime, JSON.stringify(defaultSettings.fallbackVersions)],
          (insertErr) => {
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
  
  dbQuery.run(
    `UPDATE CT_verse_import_settings 
     SET enabled = $1, bible_version = $2, import_time = $3, fallback_versions = $4
     WHERE organization_id = $5`,
    [enabled, bibleVersion, importTime, JSON.stringify(fallbackVersions), organizationId],
    function(err) {
      if (err) {
        console.error('Error updating verse import settings:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }
      
      if (this.changes === 0) {
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
      dbQuery.all(`SELECT COUNT(*) as total FROM ct_verses WHERE organization_id = $1`, [organizationId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows[0]?.total || 0);
      });
    }),
    
    // Active users (unique visitors in last 30 days)
    new Promise((resolve, reject) => {
      dbQuery.all(`
        SELECT COUNT(DISTINCT ip_address) as active_users
        FROM ct_analytics 
        WHERE organization_id = $1 AND timestamp >= NOW() - INTERVAL '30 days'
      `, [organizationId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows[0]?.active_users || 0);
      });
    }),
    
    // Total hearts
    new Promise((resolve, reject) => {
      dbQuery.all(`
        SELECT COUNT(*) as total_hearts
        FROM ct_analytics 
        WHERE organization_id = $1 AND action = 'heart'
      `, [organizationId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows[0]?.total_hearts || 0);
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
      dbQuery.all(`
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
      `, [organizationId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    }),
    
    // Engagement actions (heart, favorite, share, download)
    new Promise((resolve, reject) => {
      dbQuery.all(`
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
      `, [organizationId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    }),
    
    // Top verses
    new Promise((resolve, reject) => {
      dbQuery.all(`
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
      `, [organizationId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    }),
    
    // Enhanced tag interaction stats
    new Promise((resolve, reject) => {
      dbQuery.all(`
        SELECT 
          COUNT(*) as total_scans,
          COUNT(DISTINCT session_id) as unique_sessions,
          COUNT(DISTINCT tag_id) as active_tags,
          COUNT(DISTINCT ip_address) as unique_visitors
        FROM tag_interactions 
        WHERE organization_id = $1 
        AND created_at >= NOW() - INTERVAL '${parseInt(days)} days'
      `, [organizationId], (err, rows) => {
        if (err) reject(err);
        else {
          const stats = rows[0] || { total_scans: 0, unique_sessions: 0, active_tags: 0, unique_visitors: 0 };
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
      dbQuery.all(`
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
      `, [organizationId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    }),
    
    // Top performing tags
    new Promise((resolve, reject) => {
      dbQuery.all(`
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
      `, [organizationId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    }),
    
    // Geographic analytics (simplified fallback)
    new Promise((resolve, reject) => {
      dbQuery.all(`
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
      `, [organizationId], (err, rows) => {
        if (err) {
          console.error('Geographic analytics error:', err);
          // Fallback: try to get any geographic data at all
          dbQuery.all(`
            SELECT DISTINCT country, city, region
            FROM anonymous_sessions 
            WHERE (country IS NOT NULL OR city IS NOT NULL)
            LIMIT 10
          `, [], (err2, fallbackRows) => {
            if (err2) {
              console.error('Geographic fallback error:', err2);
              resolve([]);
            } else {
              console.log('Geographic fallback data:', fallbackRows);
              resolve(fallbackRows?.map(row => ({
                ...row, 
                total_scans: 0, 
                unique_sessions: 0, 
                unique_visitors: 0
              })) || []);
            }
          });
        } else {
          console.log('Geographic data found:', rows?.length || 0, 'locations');
          resolve(rows || []);
        }
      });
    }),
    
    // Time-based patterns (hourly)
    new Promise((resolve, reject) => {
      dbQuery.all(`
        SELECT 
          EXTRACT(HOUR FROM t.created_at) as hour,
          COUNT(*) as total_scans,
          COUNT(DISTINCT t.session_id) as unique_sessions
        FROM tag_interactions t
        WHERE t.organization_id = $1 
        AND t.created_at >= NOW() - INTERVAL '${parseInt(days)} days'
        GROUP BY EXTRACT(HOUR FROM t.created_at)
        ORDER BY hour
      `, [organizationId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    }),
    
    // Day-of-week patterns
    new Promise((resolve, reject) => {
      dbQuery.all(`
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
      `, [organizationId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    }),
    
    // Content engagement funnel (simplified)
    new Promise((resolve, reject) => {
      Promise.all([
        // Scans
        new Promise((resolve, reject) => {
          dbQuery.all(`
            SELECT COUNT(DISTINCT session_id) as sessions, COUNT(*) as total_actions
            FROM tag_interactions 
            WHERE organization_id = $1 AND created_at >= NOW() - INTERVAL '${parseInt(days)} days'
          `, [organizationId], (err, rows) => {
            if (err) reject(err);
            else resolve({ stage: 'scan', ...rows[0] });
          });
        }),
        // Hearts
        new Promise((resolve, reject) => {
          dbQuery.all(`
            SELECT COUNT(DISTINCT tagged_session_id) as sessions, COUNT(*) as total_actions
            FROM CT_analytics 
            WHERE organization_id = $1 AND action = 'heart' 
            AND timestamp >= NOW() - INTERVAL '${parseInt(days)} days'
          `, [organizationId], (err, rows) => {
            if (err) {
              console.error('Hearts analytics error:', err);
              resolve({ stage: 'heart', sessions: 0, total_actions: 0 });
            } else {
              resolve({ stage: 'heart', ...rows[0] });
            }
          });
        }),
        // Community actions
        new Promise((resolve, reject) => {
          dbQuery.all(`
            SELECT COUNT(DISTINCT originating_tag_id) as sessions, COUNT(*) as total_actions
            FROM CT_prayer_requests 
            WHERE organization_id = $1 AND created_at >= NOW() - INTERVAL '${parseInt(days)} days'
            AND originating_tag_id IS NOT NULL
          `, [organizationId], (err, rows) => {
            if (err) {
              console.error('Community analytics error:', err);
              resolve({ stage: 'community_action', sessions: 0, total_actions: 0 });
            } else {
              resolve({ stage: 'community_action', ...rows[0] });
            }
          });
        })
      ]).then(results => resolve(results)).catch(reject);
    }),
    
    // Return visitor analysis
    new Promise((resolve, reject) => {
      dbQuery.all(`
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
      `, [organizationId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows[0] || { unique_visitors: 0, total_sessions: 0, avg_sessions_per_visitor: 0, multi_tag_visitors: 0, return_visitors_7d: 0 });
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

module.exports = router;