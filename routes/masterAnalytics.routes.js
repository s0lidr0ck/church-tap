const express = require('express');
const { db, dbQuery } = require('../config/database');
const { requireMasterAuth } = require('../config/middleware');
const { getLocationFromIP } = require('../services/locationService');

const router = express.Router();

// Get analytics map data
router.get('/map-data', requireMasterAuth, (req, res) => {
  const { timeframe = '7d', organization_id } = req.query;
  
  let timeFilter = '';
  switch(timeframe) {
    case '24h':
      timeFilter = "AND created_at >= NOW() - INTERVAL '24 hours'";
      break;
    case '7d':
      timeFilter = "AND created_at >= NOW() - INTERVAL '7 days'";
      break;
    case '30d':
      timeFilter = "AND created_at >= NOW() - INTERVAL '30 days'";
      break;
    case '90d':
      timeFilter = "AND created_at >= NOW() - INTERVAL '90 days'";
      break;
  }

  let orgFilter = organization_id ? 'AND organization_id = $1' : '';
  let params = organization_id ? [organization_id] : [];

  db.query(`
    SELECT
      country,
      city,
      latitude,
      longitude,
      COUNT(*) as session_count,
      SUM(total_interactions) as total_interactions,
      COUNT(DISTINCT ip_address) as unique_ips
    FROM anonymous_sessions
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    ${timeFilter} ${orgFilter}
    GROUP BY country, city, latitude, longitude
    ORDER BY session_count DESC
  `, params, (err, result) => {
    if (err) {
      console.error('Map data error:', err);
      return res.status(500).json({ success: false, error: 'Failed to get map data' });
    }

    res.json({ success: true, locations: result.rows || [] });
  });
});

// Get global analytics stats
router.get('/stats', requireMasterAuth, (req, res) => {
  const { timeframe = '7d', organization_id } = req.query;
  
  let timeFilter = '';
  switch(timeframe) {
    case '24h':
      timeFilter = "AND created_at >= NOW() - INTERVAL '24 hours'";
      break;
    case '7d':
      timeFilter = "AND created_at >= NOW() - INTERVAL '7 days'";
      break;
    case '30d':
      timeFilter = "AND created_at >= NOW() - INTERVAL '30 days'";
      break;
    case '90d':
      timeFilter = "AND created_at >= NOW() - INTERVAL '90 days'";
      break;
  }
  
  let orgFilter = '';
  let params = [];
  if (organization_id) {
    orgFilter = 'AND organization_id = $1';
    params = [organization_id];
  }

  Promise.all([
    // Total scans
    new Promise((resolve, reject) => {
      const sql = `SELECT COUNT(*) as count FROM tag_interactions WHERE 1=1 ${timeFilter.replace('created_at', 'tag_interactions.created_at')} ${orgFilter}`;
      db.query(sql, params, (err, result) => {
        if (err) reject(err);
        else resolve(result.rows[0]?.count || 0);
      });
    }),
    
    // Unique tags
    new Promise((resolve, reject) => {
      const sql = `SELECT COUNT(DISTINCT tag_id) as count FROM tag_interactions WHERE 1=1 ${timeFilter.replace('created_at', 'tag_interactions.created_at')} ${orgFilter}`;
      db.query(sql, params, (err, result) => {
        if (err) reject(err);
        else resolve(result.rows[0]?.count || 0);
      });
    }),
    
    // Active sessions
    new Promise((resolve, reject) => {
      const sql = `SELECT COUNT(DISTINCT session_id) as count FROM tag_interactions WHERE 1=1 ${timeFilter.replace('created_at', 'tag_interactions.created_at')} ${orgFilter}`;
      db.query(sql, params, (err, result) => {
        if (err) reject(err);
        else resolve(result.rows[0]?.count || 0);
      });
    }),
    
    // Unique countries
    new Promise((resolve, reject) => {
      const sql = `SELECT COUNT(DISTINCT s.country) as count FROM anonymous_sessions s
         INNER JOIN tag_interactions t ON s.session_id = t.session_id
         WHERE s.country IS NOT NULL AND s.country != 'Local' ${timeFilter.replace('created_at', 't.created_at')} ${orgFilter.replace('organization_id', 't.organization_id')}`;
      db.query(sql, params, (err, result) => {
        if (err) reject(err);
        else resolve(result.rows[0]?.count || 0);
      });
    })
  ]).then(([totalScans, uniqueTags, activeSessions, uniqueCountries]) => {
    res.json({
      success: true,
      stats: {
        totalScans,
        uniqueTags,
        activeSessions,
        uniqueCountries
      }
    });
  }).catch(error => {
    console.error('Analytics stats error:', error);
    res.status(500).json({ success: false, error: 'Failed to get analytics stats' });
  });
});

// Backfill geolocation data
router.post('/backfill-geo', requireMasterAuth, async (req, res) => {
  try {
    // Get sessions without geolocation data
    const sessionsResult = await db.query(`
      SELECT DISTINCT ip_address 
      FROM anonymous_sessions 
      WHERE (country IS NULL OR country = 'Unknown') 
      AND ip_address NOT IN ('127.0.0.1', '::1', 'Local')
      AND ip_address NOT LIKE '192.168.%'
      AND ip_address NOT LIKE '10.%'
      AND ip_address NOT LIKE '172.%'
      LIMIT 100
    `);
    
    const sessions = sessionsResult.rows || [];
    let updated = 0;
    let errors = 0;
    
    console.log(`🌍 Starting geolocation backfill for ${sessions.length} IP addresses...`);
    
    for (const session of sessions) {
      try {
        const location = await getLocationFromIP(session.ip_address);
        
        if (location.country !== 'Unknown') {
          await db.query(`
            UPDATE anonymous_sessions 
            SET country = $1, region = $2, city = $3, latitude = $4, longitude = $5
            WHERE ip_address = $6
          `, [location.country, location.region, location.city, location.latitude, location.longitude, session.ip_address]);
          
          updated++;
          console.log(`✅ Updated ${session.ip_address}: ${location.city}, ${location.country}`);
        } else {
          errors++;
          console.log(`❌ Failed to get location for ${session.ip_address}`);
        }
        
        // Rate limit: 1 request per second to respect ip-api.com limits
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`Error processing ${session.ip_address}:`, error);
        errors++;
      }
    }
    
    console.log(`🎯 Geolocation backfill completed: ${updated} updated, ${errors} errors`);
    res.json({ 
      success: true, 
      processed: sessions.length,
      updated,
      errors 
    });
    
  } catch (error) {
    console.error('Backfill geo error:', error);
    res.status(500).json({ success: false, error: 'Failed to backfill geolocation data' });
  }
});

// Get tag activities for master dashboard
router.get('/tag-activities', requireMasterAuth, (req, res) => {
  const { timeframe = '7d', organization_id, tag_id, limit = 50, offset = 0 } = req.query;
  
  let timeFilter = '';
  switch(timeframe) {
    case '24h':
      timeFilter = "AND t.created_at >= NOW() - INTERVAL '24 hours'";
      break;
    case '7d':
      timeFilter = "AND t.created_at >= NOW() - INTERVAL '7 days'";
      break;
    case '30d':
      timeFilter = "AND t.created_at >= NOW() - INTERVAL '30 days'";
      break;
    case '90d':
      timeFilter = "AND t.created_at >= NOW() - INTERVAL '90 days'";
      break;
  }

  let params = [];
  let paramIndex = 1;

  let orgFilter = '';
  if (organization_id) {
    orgFilter = `AND t.organization_id = $${paramIndex}`;
    params.push(organization_id);
    paramIndex++;
  }

  let tagFilter = '';
  if (tag_id) {
    tagFilter = `AND t.tag_id LIKE $${paramIndex}`;
    params.push(`%${tag_id}%`);
    paramIndex++;
  }

  const limitParam = `$${paramIndex}`;
  const offsetParam = `$${paramIndex + 1}`;
  params.push(parseInt(limit));
  params.push(parseInt(offset));

  db.query(`
    SELECT
      t.id,
      t.session_id,
      t.tag_id,
      t.interaction_type,
      t.page_url,
      t.referrer,
      t.created_at,
      COALESCE(s.ip_address, t.ip_address) as ip_address,
      s.country,
      s.city,
      s.latitude,
      s.longitude,
      o.name as organization_name,
      o.subdomain,
      -- Count ALL follow-up activities directly linked to this tag session
      COALESCE((
        SELECT COUNT(*)
        FROM ct_prayer_requests pr
        WHERE pr.originating_tag_id = t.tag_id
        AND pr.created_at >= t.created_at
        AND pr.created_at <= t.created_at + INTERVAL '30 minutes'
      ), 0) +
      COALESCE((
        SELECT COUNT(*)
        FROM ct_prayer_interactions pi
        WHERE pi.originating_tag_id = t.tag_id
        AND pi.created_at >= t.created_at
        AND pi.created_at <= t.created_at + INTERVAL '30 minutes'
      ), 0) as prayer_count,

      COALESCE((
        SELECT COUNT(*)
        FROM ct_praise_reports pr2
        WHERE pr2.originating_tag_id = t.tag_id
        AND pr2.created_at >= t.created_at
        AND pr2.created_at <= t.created_at + INTERVAL '30 minutes'
      ), 0) +
      COALESCE((
        SELECT COUNT(*)
        FROM ct_celebration_interactions ci
        WHERE ci.originating_tag_id = t.tag_id
        AND ci.created_at >= t.created_at
        AND ci.created_at <= t.created_at + INTERVAL '30 minutes'
      ), 0) as praise_count,

      COALESCE((
        SELECT COUNT(*)
        FROM ct_verse_community_posts vcp
        WHERE vcp.originating_tag_id = t.tag_id
        AND vcp.created_at >= t.created_at
        AND vcp.created_at <= t.created_at + INTERVAL '30 minutes'
      ), 0) +
      COALESCE((
        SELECT COUNT(*)
        FROM ct_analytics a
        WHERE a.originating_tag_id = t.tag_id
        AND a.timestamp >= t.created_at
        AND a.timestamp <= t.created_at + INTERVAL '30 minutes'
        AND a.action IN ('heart', 'favorite', 'share', 'download')
      ), 0) as insight_count
    FROM tag_interactions t
    LEFT JOIN anonymous_sessions s ON t.session_id = s.session_id
    LEFT JOIN ct_organizations o ON t.organization_id = o.id
    WHERE 1=1 ${timeFilter} ${orgFilter} ${tagFilter}
    ORDER BY t.created_at DESC
    LIMIT ${limitParam} OFFSET ${offsetParam}
  `, params, (err, result) => {
    if (err) {
      console.error('Tag activities error:', err);
      return res.status(500).json({ success: false, error: 'Failed to get tag activities' });
    }

    const rows = result.rows;
    
    // Get total count for pagination
    let countParams = [];
    let countParamIndex = 1;
    let countOrgFilter = '';
    let countTagFilter = '';

    if (organization_id) {
      countOrgFilter = `AND t.organization_id = $${countParamIndex}`;
      countParams.push(organization_id);
      countParamIndex++;
    }

    if (tag_id) {
      countTagFilter = `AND t.tag_id LIKE $${countParamIndex}`;
      countParams.push(`%${tag_id}%`);
      countParamIndex++;
    }

    db.query(`
      SELECT COUNT(*) as total
      FROM tag_interactions t
      WHERE 1=1 ${timeFilter} ${countOrgFilter} ${countTagFilter}
    `, countParams, (countErr, countResult) => {
      if (countErr) {
        console.error('Tag activities count error:', countErr);
        return res.status(500).json({ success: false, error: 'Failed to get count' });
      }

      res.json({
        success: true,
        activities: rows || [],
        total: countResult.rows[0]?.total || 0,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: (parseInt(offset) + parseInt(limit)) < (countResult.rows[0]?.total || 0)
        }
      });
    });
  });
});

// Get tag activities statistics for master dashboard
router.get('/tag-activities/stats', requireMasterAuth, (req, res) => {
  const { timeframe = '7d', organization_id } = req.query;
  
  let timeFilter = '';
  switch(timeframe) {
    case '24h':
      timeFilter = "AND created_at >= NOW() - INTERVAL '24 hours'";
      break;
    case '7d':
      timeFilter = "AND created_at >= NOW() - INTERVAL '7 days'";
      break;
    case '30d':
      timeFilter = "AND created_at >= NOW() - INTERVAL '30 days'";
      break;
    case '90d':
      timeFilter = "AND created_at >= NOW() - INTERVAL '90 days'";
      break;
  }
  
  let orgFilter = organization_id ? 'AND organization_id = $1' : '';
  let params = organization_id ? [organization_id] : [];

  console.log('Tag activities stats query - timeframe:', timeframe, 'org_id:', organization_id);

  Promise.all([
    // Total interactions
    new Promise((resolve, reject) => {
      const query = `SELECT COUNT(*) as count FROM tag_interactions WHERE 1=1 ${timeFilter} ${orgFilter}`;
      console.log('Total interactions query:', query, 'params:', params);
      
      db.query(query, params, (err, result) => {
        if (err) {
          console.error('Total interactions query error:', err);
          reject(err);
        } else {
          resolve(parseInt(result.rows[0]?.count || 0));
        }
      });
    }),
    
    // Unique tags
    new Promise((resolve, reject) => {
      const query = `SELECT COUNT(DISTINCT tag_id) as count FROM tag_interactions WHERE 1=1 ${timeFilter} ${orgFilter}`;
      console.log('Unique tags query:', query, 'params:', params);
      
      db.query(query, params, (err, result) => {
        if (err) {
          console.error('Unique tags query error:', err);
          reject(err);
        } else {
          resolve(parseInt(result.rows[0]?.count || 0));
        }
      });
    }),
    
    // Unique sessions
    new Promise((resolve, reject) => {
      const query = `SELECT COUNT(DISTINCT session_id) as count FROM tag_interactions WHERE 1=1 ${timeFilter} ${orgFilter}`;
      console.log('Unique sessions query:', query, 'params:', params);
      
      db.query(query, params, (err, result) => {
        if (err) {
          console.error('Unique sessions query error:', err);
          reject(err);
        } else {
          resolve(parseInt(result.rows[0]?.count || 0));
        }
      });
    }),
    
    // Simple engagement rate based on new attribution system
    new Promise((resolve, reject) => {
      const query = `
        SELECT 
          COUNT(DISTINCT t.session_id) as total_sessions,
          COUNT(DISTINCT CASE 
            WHEN EXISTS (
              SELECT 1 FROM ct_prayer_requests pr WHERE pr.originating_tag_id = t.tag_id
              UNION ALL
              SELECT 1 FROM ct_praise_reports rep WHERE rep.originating_tag_id = t.tag_id
              UNION ALL
              SELECT 1 FROM ct_verse_community_posts vcp WHERE vcp.originating_tag_id = t.tag_id
            ) THEN t.session_id 
          END) as engaged_sessions
        FROM tag_interactions t
        WHERE 1=1 ${timeFilter} ${orgFilter}
      `;
      console.log('Engagement rate query:', query, 'params:', params);
      
      db.query(query, params, (err, result) => {
        if (err) {
          console.error('Engagement rate query error:', err);
          reject(err);
        } else {
          const row = result.rows[0] || {};
          const totalSessions = parseInt(row.total_sessions || 0);
          const engagedSessions = parseInt(row.engaged_sessions || 0);
          const engagementRate = totalSessions > 0 ? Math.round((engagedSessions / totalSessions) * 100) : 0;
          console.log('Engagement calculation:', { totalSessions, engagedSessions, engagementRate });
          resolve(engagementRate);
        }
      });
    })
  ]).then(([totalInteractions, uniqueTags, uniqueSessions, engagementRate]) => {
    console.log('Tag activities stats result:', { totalInteractions, uniqueTags, uniqueSessions, engagementRate });
    res.json({
      success: true,
      stats: {
        totalInteractions,
        uniqueTags,
        uniqueSessions,
        engagementRate
      }
    });
  }).catch(error => {
    console.error('Tag activities stats error:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({ success: false, error: 'Failed to get tag activities stats' });
  });
});

// Get session details
router.get('/session-details/:sessionId', requireMasterAuth, (req, res) => {
  const { sessionId } = req.params;
  
  console.log('Session details request for:', sessionId);
  
  // Get tag interactions for this session using direct db.query
  db.query(`
    SELECT 
      t.*,
      s.country,
      s.city,
      s.latitude,
      s.longitude,
      s.ip_address as session_ip,
      s.user_agent,
      s.first_seen_at,
      s.last_seen_at,
      s.total_interactions,
      s.tagged_session_id,
      o.name as organization_name,
      o.subdomain
    FROM tag_interactions t
    LEFT JOIN anonymous_sessions s ON t.session_id = s.session_id
    LEFT JOIN ct_organizations o ON t.organization_id = o.id
    WHERE t.session_id = $1
    ORDER BY t.created_at DESC
  `, [sessionId], (err, result) => {
    if (err) {
      console.error('Session details query error:', err);
      return res.status(500).json({ success: false, error: 'Failed to get session details' });
    }
    
    const interactions = result.rows || [];
    console.log('Found', interactions.length, 'interactions for session:', sessionId);
    
    if (interactions.length === 0) {
      console.log('No interactions found, returning empty session details');
      return res.json({ 
        success: true, 
        sessionDetails: {
          sessionId,
          sessionInfo: null,
          location: null,
          deviceInfo: null,
          userJourney: [],
          activities: { prayerRequests: [], praiseReports: [], insights: [] }
        }
      });
    }
    
    const firstInteraction = interactions[0];
    const tagIds = [...new Set(interactions.map(i => i.tag_id))];
    
    console.log('Session has tag IDs:', tagIds);
    
    // Helper function to safely format dates
    const formatDate = (dateValue) => {
      if (!dateValue) return null;
      try {
        return new Date(dateValue).toISOString();
      } catch (e) {
        return null;
      }
    };

    // Helper function to parse user agent
    const parseUserAgent = (userAgent) => {
      if (!userAgent) return { browser: 'Unknown', platform: 'Unknown' };
      
      let browser = 'Unknown';
      let platform = 'Unknown';
      
      // Simple user agent parsing
      if (userAgent.includes('Chrome')) browser = 'Chrome';
      else if (userAgent.includes('Firefox')) browser = 'Firefox';
      else if (userAgent.includes('Safari')) browser = 'Safari';
      else if (userAgent.includes('Edge')) browser = 'Edge';
      
      if (userAgent.includes('Windows')) platform = 'Windows';
      else if (userAgent.includes('Mac')) platform = 'macOS';
      else if (userAgent.includes('Linux')) platform = 'Linux';
      else if (userAgent.includes('Android')) platform = 'Android';
      else if (userAgent.includes('iOS')) platform = 'iOS';
      
      return { browser, platform };
    };

    const deviceInfo = parseUserAgent(firstInteraction.user_agent);
    
    // Calculate session duration and page views
    const firstSeen = firstInteraction.first_seen_at || interactions[interactions.length - 1]?.created_at;
    const lastSeen = firstInteraction.last_seen_at || interactions[0]?.created_at;
    
    let sessionDuration = 0;
    if (firstSeen && lastSeen) {
      sessionDuration = Math.max(0, new Date(lastSeen) - new Date(firstSeen));
    }
    
    const sessionDetails = {
      sessionId,
      sessionInfo: {
        ipAddress: firstInteraction.session_ip || firstInteraction.ip_address || 'Unknown',
        userAgent: firstInteraction.user_agent || 'Unknown',
        sessionStart: formatDate(firstSeen),
        lastActivity: formatDate(lastSeen),
        totalPageViews: interactions.length,
        totalTimeSpent: sessionDuration, // in milliseconds
        organization: firstInteraction.organization_name || 'Unknown',
        tagScans: interactions.filter(i => i.interaction_type === 'scan').map(scan => ({
          tagId: scan.tag_id,
          scanTime: formatDate(scan.created_at),
          organizationId: scan.organization_id
        }))
      },
      location: {
        country: firstInteraction.country || 'Unknown',
        city: firstInteraction.city || 'Unknown',
        region: firstInteraction.region || 'Unknown',
        latitude: firstInteraction.latitude,
        longitude: firstInteraction.longitude
      },
      deviceInfo: {
        userAgent: firstInteraction.user_agent || 'Unknown',
        browser: deviceInfo.browser,
        platform: deviceInfo.platform,
        os: deviceInfo.platform, // Frontend expects 'os' field
        device: deviceInfo.platform.includes('Mobile') || deviceInfo.platform.includes('Android') || deviceInfo.platform.includes('iOS') ? 'Mobile' : 'Desktop'
      },
      userJourney: interactions.map((interaction, index) => ({
        timestamp: formatDate(interaction.created_at),
        action: interaction.interaction_type || 'scan',
        page: interaction.page_url || '/',
        tagId: interaction.tag_id || 'Unknown',
        pageUrl: interaction.page_url || '/',
        referrer: interaction.referrer || 'Direct',
        metadata: {
          tagId: interaction.tag_id,
          organizationId: interaction.organization_id,
          userAgent: interaction.user_agent
        }
      })),
      sectionTimeSpent: interactions.length > 1 ? interactions.map((interaction, index) => {
        const nextInteraction = interactions[index + 1];
        const timeSpent = nextInteraction ? 
          Math.max(0, new Date(interaction.created_at) - new Date(nextInteraction.created_at)) : 0;
        
        return {
          page: interaction.page_url || '/',
          timeMs: timeSpent,
          timeFormatted: timeSpent > 0 ? `${Math.floor(timeSpent / 1000)}s` : '< 1s'
        };
      }).filter(s => s.timeMs > 0) : [],
      activities: {
        prayerRequests: [],
        praiseReports: [],
        insights: []
      }
    };
    
    // Get activities separately with simpler queries
    Promise.all([
      // Prayer requests for any of the tags in this session
      new Promise((resolve) => {
        if (tagIds.length === 0) return resolve([]);
        
        const placeholders = tagIds.map((_, i) => `$${i + 1}`).join(',');
        db.query(`
          SELECT * FROM ct_prayer_requests 
          WHERE originating_tag_id IN (${placeholders})
          ORDER BY created_at DESC
          LIMIT 10
        `, tagIds, (err, result) => {
          if (err) {
            console.error('Prayer requests query error:', err);
            resolve([]);
          } else {
            resolve(result.rows || []);
          }
        });
      }),
      
      // Prayer interactions for any of the tags
      new Promise((resolve) => {
        if (tagIds.length === 0) return resolve([]);
        
        const placeholders = tagIds.map((_, i) => `$${i + 1}`).join(',');
        db.query(`
          SELECT pi.*, pr.content as prayer_content 
          FROM ct_prayer_interactions pi
          LEFT JOIN ct_prayer_requests pr ON pi.prayer_request_id = pr.id
          WHERE pi.originating_tag_id IN (${placeholders})
          ORDER BY pi.created_at DESC
          LIMIT 10
        `, tagIds, (err, result) => {
          if (err) {
            console.error('Prayer interactions query error:', err);
            resolve([]);
          } else {
            resolve(result.rows || []);
          }
        });
      }),
      
      // Praise reports
      new Promise((resolve) => {
        if (tagIds.length === 0) return resolve([]);
        
        const placeholders = tagIds.map((_, i) => `$${i + 1}`).join(',');
        db.query(`
          SELECT * FROM ct_praise_reports 
          WHERE originating_tag_id IN (${placeholders})
          ORDER BY created_at DESC
          LIMIT 10
        `, tagIds, (err, result) => {
          if (err) {
            console.error('Praise reports query error:', err);
            resolve([]);
          } else {
            resolve(result.rows || []);
          }
        });
      }),
      
      // Verse insights
      new Promise((resolve) => {
        if (tagIds.length === 0) return resolve([]);
        
        const placeholders = tagIds.map((_, i) => `$${i + 1}`).join(',');
        db.query(`
          SELECT * FROM ct_verse_community_posts 
          WHERE originating_tag_id IN (${placeholders})
          ORDER BY created_at DESC
          LIMIT 10
        `, tagIds, (err, result) => {
          if (err) {
            console.error('Verse insights query error:', err);
            resolve([]);
          } else {
            resolve(result.rows || []);
          }
        });
      }),
      
      // Analytics events (heart/favorite/share/download) for this session/tag
      new Promise((resolve) => {
        const taggedSessionId = firstInteraction.tagged_session_id;
        const actions = ['heart','favorite','share','download'];
        
        let whereParts = [];
        let params = [];
        
        if (tagIds.length > 0) {
          const tagPlaceholders = tagIds.map((_, i) => `$${i + 1}`).join(',');
          whereParts.push(`a.originating_tag_id IN (${tagPlaceholders})`);
          params = params.concat(tagIds);
        }
        
        if (taggedSessionId) {
          const paramIndex = params.length + 1;
          whereParts.push(`a.tagged_session_id = $${paramIndex}`);
          params.push(taggedSessionId);
        }
        
        if (whereParts.length === 0) return resolve([]);
        
        const actionPlaceholders = actions.map((_, i) => `$${params.length + i + 1}`).join(',');
        const sql = `
          SELECT a.action, a.verse_id, a.timestamp
          FROM ct_analytics a
          WHERE (${whereParts.join(' OR ')})
            AND a.action IN (${actionPlaceholders})
          ORDER BY a.timestamp DESC
          LIMIT 50
        `;
        const finalParams = params.concat(actions);
        
        db.query(sql, finalParams, (err, result) => {
          if (err) {
            console.error('Analytics events query error:', err);
            resolve([]);
          } else {
            resolve(result.rows || []);
          }
        });
      })
    ]).then(([prayerRequests, prayerInteractions, praiseReports, verseInsights, analyticsEvents]) => {
      
      console.log('Activities found:', {
        prayerRequests: prayerRequests.length,
        prayerInteractions: prayerInteractions.length,
        praiseReports: praiseReports.length,
        verseInsights: verseInsights.length
      });
      
      // Update activities in session details
      sessionDetails.activities = {
        prayerRequests: [
          ...prayerRequests.map(pr => ({
            id: pr.id,
            content: pr.content,
            createdAt: pr.created_at,
            isAnonymous: !pr.user_token || pr.user_token.startsWith('anon_'),
            organizationId: pr.organization_id
          })),
          ...prayerInteractions.map(pi => ({
            id: `interaction_${pi.id}`,
            content: `Prayed for: "${pi.prayer_content || 'Prayer request'}"`,
            createdAt: pi.created_at,
            isAnonymous: !pi.user_token || pi.user_token.startsWith('anon_'),
            organizationId: 1,
            type: 'prayer_interaction'
          }))
        ],
        praiseReports: praiseReports.map(pr => ({
          id: pr.id,
          content: pr.content,
          createdAt: pr.created_at,
          isAnonymous: !pr.user_token || pr.user_token.startsWith('anon_'),
          organizationId: pr.organization_id
        })),
        insights: verseInsights.map(vi => ({
          id: vi.id,
          verseReference: vi.verse_reference,
          insightText: vi.content,
          createdAt: vi.created_at,
          isAnonymous: !vi.user_token || vi.user_token.startsWith('anon_'),
          organizationId: vi.organization_id
        })),
        analyticsEvents: (analyticsEvents || []).map(a => ({
          action: a.action,
          verseId: a.verse_id,
          createdAt: a.timestamp
        }))
      };
      
      // Merge analytics events into the user journey and sort by time
      const analyticsJourney = (analyticsEvents || []).map(ev => ({
        timestamp: formatDate(ev.timestamp),
        action: ev.action,
        page: 'verse',
        tagId: null,
        pageUrl: '/',
        referrer: 'App',
        metadata: { verseId: ev.verse_id }
      }));
      
      sessionDetails.userJourney = [...sessionDetails.userJourney, ...analyticsJourney]
        .filter(step => step.timestamp)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      console.log('Returning session details with activities');
      res.json({ success: true, sessionDetails });
      
    }).catch(error => {
      console.error('Session details activities error:', error);
      res.status(500).json({ success: false, error: 'Failed to get session activities' });
    });
  });
});

// Get IP details
router.get('/ip-details/:ip', requireMasterAuth, (req, res) => {
  const { ip } = req.params;
  const { timeframe = '30d' } = req.query;
  
  let timeFilter = '';
  switch(timeframe) {
    case '24h':
      timeFilter = "AND t.created_at >= NOW() - INTERVAL '24 hours'";
      break;
    case '7d':
      timeFilter = "AND t.created_at >= NOW() - INTERVAL '7 days'";
      break;
    case '30d':
      timeFilter = "AND t.created_at >= NOW() - INTERVAL '30 days'";
      break;
    case '90d':
      timeFilter = "AND t.created_at >= NOW() - INTERVAL '90 days'";
      break;
  }

  db.query(`
    SELECT
      t.*,
      s.country,
      s.city,
      s.latitude,
      s.longitude,
      o.name as organization_name
    FROM tag_interactions t
    LEFT JOIN anonymous_sessions s ON t.session_id = s.session_id
    LEFT JOIN ct_organizations o ON t.organization_id = o.id
    WHERE (s.ip_address = $1 OR t.ip_address = $1) ${timeFilter}
    ORDER BY t.created_at DESC
  `, [ip], (err, result) => {
    if (err) {
      console.error('IP details error:', err);
      return res.status(500).json({ success: false, error: 'Failed to get IP details' });
    }

    res.json({ success: true, sessions: result.rows || [] });
  });
});

// Get latest anonymous session by last activity
router.get('/latest-session', requireMasterAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        session_id,
        ip_address,
        user_agent,
        country,
        region,
        city,
        latitude,
        longitude,
        first_seen_at,
        last_seen_at,
        total_interactions,
        tagged_session_id,
        originating_tag_id
      FROM anonymous_sessions
      ORDER BY last_seen_at DESC NULLS LAST, first_seen_at DESC NULLS LAST
      LIMIT 1
    `);
    const session = result.rows?.[0] || null;
    res.json({ success: true, session });
  } catch (error) {
    console.error('Latest session query error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch latest session' });
  }
});

// Get tag interaction details
router.get('/tag-details/:tagId', requireMasterAuth, (req, res) => {
  const { tagId } = req.params;
  const { timeframe = '7d' } = req.query;
  
  let timeFilter = '';
  switch(timeframe) {
    case '24h':
      timeFilter = "AND t.created_at >= NOW() - INTERVAL '24 hours'";
      break;
    case '7d':
      timeFilter = "AND t.created_at >= NOW() - INTERVAL '7 days'";
      break;
    case '30d':
      timeFilter = "AND t.created_at >= NOW() - INTERVAL '30 days'";
      break;
  }

  db.query(`
    SELECT 
      t.*,
      s.country,
      s.city,
      s.latitude,
      s.longitude,
      o.name as organization_name
    FROM tag_interactions t
    LEFT JOIN anonymous_sessions s ON t.session_id = s.session_id
    LEFT JOIN ct_organizations o ON t.organization_id = o.id
    WHERE t.tag_id = $1 ${timeFilter}
    ORDER BY t.created_at DESC
  `, [tagId], (err, result) => {
    if (err) {
      console.error('Tag details error:', err);
      return res.status(500).json({ success: false, error: 'Failed to get tag details' });
    }
    
    res.json({ success: true, interactions: result.rows || [] });
  });
});

// Debug endpoint to check activity data
router.get('/debug-activities', requireMasterAuth, (req, res) => {
  // Get recent tag interactions
  db.query(`
    SELECT
      t.id,
      t.session_id,
      t.tag_id,
      t.created_at,
      t.ip_address as tag_ip,
      s.ip_address as session_ip,
      COALESCE(s.ip_address, t.ip_address) as final_ip
    FROM tag_interactions t
    LEFT JOIN anonymous_sessions s ON t.session_id = s.session_id
    WHERE t.created_at >= NOW() - INTERVAL '7 days'
    ORDER BY t.created_at DESC
    LIMIT 5
  `, [], (err, tagResult) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error' });
    }

    const tagRows = tagResult.rows;
    
    // Get recent prayer requests
    db.query(`
      SELECT id, ip_address, created_at, organization_id, content
      FROM ct_prayer_requests
      WHERE created_at >= NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC
      LIMIT 5
    `, [], (err, prayerResult) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error' });
      }

      const prayerRows = prayerResult.rows;
      
      // Get recent praise reports
      db.query(`
        SELECT id, ip_address, created_at, organization_id, content
        FROM ct_praise_reports
        WHERE created_at >= NOW() - INTERVAL '7 days'
        ORDER BY created_at DESC
        LIMIT 5
      `, [], (err, praiseResult) => {
        if (err) {
          return res.status(500).json({ success: false, error: 'Database error' });
        }

        const praiseRows = praiseResult.rows;
        
        // Get recent analytics events
        db.query(`
          SELECT action, verse_id, ip_address, timestamp as created_at, tagged_session_id, originating_tag_id
          FROM CT_analytics
          WHERE timestamp >= NOW() - INTERVAL '7 days'
          ORDER BY timestamp DESC
          LIMIT 10
        `, [], (err, analyticsResult) => {
          if (err) {
            console.error('Analytics query error:', err);
            return res.status(500).json({ success: false, error: 'Database error', details: err.message });
          }

          const analyticsRows = analyticsResult.rows;

          res.json({
            success: true,
            debug: {
              recent_tag_interactions: tagRows,
              recent_prayer_requests: prayerRows,
              recent_praise_reports: praiseRows,
              recent_analytics_events: analyticsRows
            }
          });
        });
      });
    });
  });
});

module.exports = router;