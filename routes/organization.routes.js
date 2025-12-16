const express = require('express');
const { dbQuery, db } = require('../config/database');
const { requireOrgAuth } = require('../config/middleware');
const { getOrganizationFeatures, getTranslationCatalog } = require('../services/organizationFeaturesService');

const router = express.Router();

async function resolveOrgIdFromRequest(req) {
  let orgId = req.organization?.id || null;
  const originatingTagId = req.cookies?.originatingTag;
  if (orgId) return orgId;
  if (originatingTagId) {
    try {
      const result = await db.query(`SELECT organization_id FROM ct_nfc_tags WHERE custom_id = $1`, [originatingTagId]);
      if (result.rows?.length > 0) return result.rows[0].organization_id;
    } catch (e) {
      // ignore
    }
  }
  return 1;
}

async function fetchPassageFromBolls({ translation, book_number, chapter, verse_start, verse_end }) {
  const start = parseInt(verse_start, 10);
  const end = parseInt(verse_end, 10);
  const maxVerses = 30;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) {
    throw new Error('Invalid verse range');
  }
  if ((end - start + 1) > maxVerses) {
    throw new Error(`Verse range too large (max ${maxVerses} verses)`);
  }

  const t = (translation || 'NIV').toString().trim().toUpperCase();
  const parts = [];
  for (let v = start; v <= end; v++) {
    const apiUrl = `https://bolls.life/get-verse/${encodeURIComponent(t)}/${book_number}/${chapter}/${v}/`;
    const resp = await fetch(apiUrl);
    if (!resp.ok) throw new Error('Failed to fetch verse from provider');
    const data = await resp.json();
    const text = (data?.text || data?.verse_text || '').toString().trim();
    parts.push((start === end) ? text : `${v}. ${text}`);
  }

  return {
    verse_text: parts.join('\n'),
    source: 'bolls.life',
    translation: t
  };
}

// Admin: Get all organization links (moved to admin routes)
// This route has been moved to organizationAdmin.routes.js to avoid conflicts

// Admin: Create organization link
router.post('/links', requireOrgAuth, (req, res) => {
  const { title, url, icon, sort_order } = req.body;
  
  if (!title || !url) {
    return res.status(400).json({ success: false, error: 'Title and URL are required' });
  }
  
  db.query(
    `INSERT INTO ct_organization_links (organization_id, title, url, icon, sort_order)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [req.session.organizationId, title, url, icon || 'website', sort_order || 0],
    (err, result) => {
      if (err) {
        console.error('Error creating organization link:', err);
        return res.status(500).json({ success: false, error: 'Failed to create link' });
      }

      res.json({
        success: true,
        link: {
          id: result.rows[0].id,
          organization_id: req.session.organizationId,
          title,
          url,
          icon: icon || 'website',
          sort_order: sort_order || 0,
          is_active: true
        }
      });
    }
  );
});

// Admin: Update organization link
router.put('/links/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  const { title, url, icon, sort_order, is_active } = req.body;
  
  if (!title || !url) {
    return res.status(400).json({ success: false, error: 'Title and URL are required' });
  }
  
  db.query(
    `UPDATE ct_organization_links
     SET title = $1, url = $2, icon = $3, sort_order = $4, is_active = $5
     WHERE id = $6 AND organization_id = $7`,
    [title, url, icon || 'website', sort_order || 0, is_active !== undefined ? is_active : true, id, req.session.organizationId],
    (err, result) => {
      if (err) {
        console.error('Error updating organization link:', err);
        return res.status(500).json({ success: false, error: 'Failed to update link' });
      }

      if (result.rowCount === 0) {
        return res.status(404).json({ success: false, error: 'Link not found' });
      }

      res.json({ success: true });
    }
  );
});

// Admin: Delete organization link
router.delete('/links/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  
  db.query(
    `DELETE FROM ct_organization_links
     WHERE id = $1 AND organization_id = $2`,
    [id, req.session.organizationId],
    (err, result) => {
      if (err) {
        console.error('Error deleting organization link:', err);
        return res.status(500).json({ success: false, error: 'Failed to delete link' });
      }

      if (result.rowCount === 0) {
        return res.status(404).json({ success: false, error: 'Link not found' });
      }

      res.json({ success: true });
    }
  );
});

// Get organization links (public endpoint)
router.get('/links', (req, res) => {
  let orgId = req.organization?.id || null;
  
  // If no org from middleware, try to resolve from tag cookie
  const originatingTagId = req.cookies?.originatingTag;
  
  const resolveOrgFromTag = (cb) => {
    if (orgId) return cb();
    if (!originatingTagId) {
      orgId = 1; // Default fallback
      return cb();
    }
    
    db.query(`SELECT organization_id FROM ct_nfc_tags WHERE custom_id = $1`, [originatingTagId], (err, result) => {
      if (!err && result.rows.length > 0) {
        orgId = result.rows[0].organization_id;
        console.log(`🔗 ✅ Resolved org ${orgId} from tag ${originatingTagId}`);
      } else {
        orgId = 1; // Default fallback
      }
      cb();
    });
  };
  
  resolveOrgFromTag(() => {
    console.log('Public links request for organization:', orgId);
    console.log('Request query params:', req.query);
    console.log('Organization from middleware:', req.organization);
    console.log('Organization ID resolved:', orgId);

    getOrganizationFeatures(orgId).then(features => {
      if (features.group_links_enabled === false) {
        return res.status(403).json({ success: false, error: 'Links are disabled for this group', code: 'FEATURE_DISABLED', feature: 'group_links_enabled' });
      }

      db.query(
        `SELECT id, title, url, icon, sort_order
         FROM ct_organization_links
         WHERE organization_id = $1 AND is_active = true
         ORDER BY sort_order ASC, title ASC`,
        [orgId],
        (err, result) => {
          if (err) {
            console.error('Error fetching organization links:', err);
            return res.status(500).json({ success: false, error: 'Failed to fetch links' });
          }
          console.log('Found', result.rows.length, 'active organization links for org', orgId);
          console.log('Links found:', result.rows);
          res.json(result.rows);
        }
      );
    }).catch(e => {
      console.error('Error checking org features (links):', e);
      return res.status(500).json({ success: false, error: 'Failed to fetch links' });
    });
  });
});

// ===========================
// Emergency Scripture Topics - Public
// ===========================
router.get('/topics', async (req, res) => {
  try {
    const orgId = await resolveOrgIdFromRequest(req);

    const templates = await db.query(
      `SELECT t.id, t.name, t.description, t.sort_order
       FROM ct_topic_templates t
       LEFT JOIN ct_organization_topic_template_settings s
         ON s.template_id = t.id AND s.organization_id = $1
       WHERE t.is_active = TRUE
         AND COALESCE(s.is_enabled, TRUE) = TRUE
       ORDER BY t.sort_order ASC, t.name ASC`,
      [orgId]
    );

    const custom = await db.query(
      `SELECT id, name, description, sort_order
       FROM ct_scripture_topics
       WHERE organization_id = $1 AND is_active = TRUE
       ORDER BY sort_order ASC, name ASC`,
      [orgId]
    );

    const topics = [
      ...(templates.rows || []).map(r => ({ ...r, source: 'default' })),
      ...(custom.rows || []).map(r => ({ ...r, source: 'custom' }))
    ];

    res.json({ success: true, topics });
  } catch (e) {
    console.error('Error fetching public topics:', e);
    res.status(500).json({ success: false, error: 'Failed to fetch topics' });
  }
});

router.get('/topics/:id/random', async (req, res) => {
  try {
    const orgId = await resolveOrgIdFromRequest(req);
    const topicId = parseInt(req.params.id, 10);
    if (!topicId) return res.status(400).json({ success: false, error: 'Invalid topic id' });

    // Ensure topic belongs to org + active
    const topic = await db.query(
      `SELECT id, name
       FROM ct_scripture_topics
       WHERE id = $1 AND organization_id = $2 AND is_active = TRUE`,
      [topicId, orgId]
    );
    if (!topic.rows?.length) return res.status(404).json({ success: false, error: 'Topic not found' });

    const pick = await db.query(
      `SELECT book_number, chapter, verse_start, verse_end, bible_reference, COALESCE(translation_code, 'NIV') AS translation
       FROM ct_scripture_topic_verses
       WHERE topic_id = $1
       ORDER BY RANDOM()
       LIMIT 1`,
      [topicId]
    );
    if (!pick.rows?.length) return res.status(404).json({ success: false, error: 'No verses configured for this topic' });

    const v = pick.rows[0];
    const passage = await fetchPassageFromBolls({
      translation: v.translation,
      book_number: v.book_number,
      chapter: v.chapter,
      verse_start: v.verse_start,
      verse_end: v.verse_end
    });

    res.json({
      success: true,
      topic: { id: topicId, name: topic.rows[0].name },
      verse: {
        id: null,
        verse_text: passage.verse_text,
        bible_reference: v.bible_reference,
        source: passage.source,
        translation: passage.translation
      }
    });
  } catch (e) {
    console.error('Error fetching random topic verse:', e);
    res.status(500).json({ success: false, error: e?.message || 'Failed to fetch random topic verse' });
  }
});

router.get('/default-topics/:id/random', async (req, res) => {
  try {
    const orgId = await resolveOrgIdFromRequest(req);
    const templateId = parseInt(req.params.id, 10);
    if (!templateId) return res.status(400).json({ success: false, error: 'Invalid topic id' });

    const tpl = await db.query(
      `SELECT t.id, t.name, COALESCE(s.is_enabled, TRUE) AS is_enabled
       FROM ct_topic_templates t
       LEFT JOIN ct_organization_topic_template_settings s
         ON s.template_id = t.id AND s.organization_id = $1
       WHERE t.id = $2 AND t.is_active = TRUE`,
      [orgId, templateId]
    );
    if (!tpl.rows?.length) return res.status(404).json({ success: false, error: 'Topic not found' });
    if (tpl.rows[0].is_enabled !== true) return res.status(403).json({ success: false, error: 'Topic is disabled for this group' });

    const pick = await db.query(
      `SELECT book_number, chapter, verse_start, verse_end, bible_reference, COALESCE(translation_code, 'NIV') AS translation
       FROM ct_topic_template_verses
       WHERE template_id = $1
       ORDER BY RANDOM()
       LIMIT 1`,
      [templateId]
    );
    if (!pick.rows?.length) return res.status(404).json({ success: false, error: 'No verses configured for this topic' });

    const v = pick.rows[0];
    const passage = await fetchPassageFromBolls({
      translation: v.translation,
      book_number: v.book_number,
      chapter: v.chapter,
      verse_start: v.verse_start,
      verse_end: v.verse_end
    });

    res.json({
      success: true,
      topic: { id: templateId, name: tpl.rows[0].name, source: 'default' },
      verse: {
        id: null,
        verse_text: passage.verse_text,
        bible_reference: v.bible_reference,
        source: passage.source,
        translation: passage.translation
      }
    });
  } catch (e) {
    console.error('Error fetching random default topic verse:', e);
    res.status(500).json({ success: false, error: e?.message || 'Failed to fetch random topic verse' });
  }
});

// ===========================
// Fundraising Goal - Public
// ===========================
router.get('/fundraising', async (req, res) => {
  try {
    const orgId = await resolveOrgIdFromRequest(req);
    const result = await db.query(
      `SELECT organization_id, goal_title, goal_amount_cents, current_amount_cents, deadline_date, is_active
       FROM ct_fundraising_goals
       WHERE organization_id = $1 AND is_active = TRUE`,
      [orgId]
    );
    res.json({ success: true, fundraising: result.rows[0] || null });
  } catch (e) {
    console.error('Error fetching fundraising (public):', e);
    res.status(500).json({ success: false, error: 'Failed to fetch fundraising goal' });
  }
});

// ===========================
// Worship Playlist - Public
// ===========================
router.get('/worship-playlist', async (req, res) => {
  try {
    const orgId = await resolveOrgIdFromRequest(req);
    const result = await db.query(
      `SELECT organization_id, title, youtube_url
       FROM ct_organization_worship_playlists
       WHERE organization_id = $1 AND is_active = TRUE`,
      [orgId]
    );
    res.json({ success: true, playlist: result.rows[0] || null });
  } catch (e) {
    console.error('Error fetching worship playlist (public):', e);
    res.status(500).json({ success: false, error: 'Failed to fetch worship playlist' });
  }
});

// Calendar: get events for a specific day (YYYY-MM-DD)
router.get('/calendar/daily', (req, res) => {
  let orgId = req.organization?.id || null;
  const originatingTagId = req.cookies?.originatingTag;
  
  const resolveOrgFromTag = (cb) => {
    if (orgId) return cb();
    if (!originatingTagId) {
      orgId = 1;
      return cb();
    }
    db.query(`SELECT organization_id FROM ct_nfc_tags WHERE custom_id = $1`, [originatingTagId], (err, result) => {
      if (!err && result.rows.length > 0) {
        orgId = result.rows[0].organization_id;
      } else {
        orgId = 1;
      }
      cb();
    });
  };
  
  resolveOrgFromTag(() => {
  const { date } = req.query;
  if (!date) {
    return res.status(400).json({ success: false, error: 'date required (YYYY-MM-DD)' });
  }

  getOrganizationFeatures(orgId).then(features => {
    if (features.group_calendar_enabled === false) {
      return res.status(403).json({ success: false, error: 'Calendar is disabled for this group', code: 'FEATURE_DISABLED', feature: 'group_calendar_enabled' });
    }

    db.query(
      `SELECT id, title, description, location, address, start_at, end_at, all_day, link, notify_lead_minutes
       FROM CT_events
       WHERE organization_id = $1
         AND is_active = TRUE
         AND DATE(start_at) = $2
       ORDER BY start_at ASC`,
      [orgId, date],
      (err, result) => {
        if (err) {
          console.error('Error fetching daily events:', err);
          return res.status(500).json({ success: false, error: 'Failed to fetch daily events' });
        }
        res.json({ success: true, events: result.rows || [] });
      }
    );
  }).catch(e => {
    console.error('Error checking org features (calendar daily):', e);
    return res.status(500).json({ success: false, error: 'Failed to fetch daily events' });
  });
  });
});

// Calendar: get events for a given month (YYYY-MM)
router.get('/calendar/month', (req, res) => {
  let orgId = req.organization?.id || null;
  const originatingTagId = req.cookies?.originatingTag;
  
  const resolveOrgFromTag = (cb) => {
    if (orgId) return cb();
    if (!originatingTagId) {
      orgId = 1;
      return cb();
    }
    db.query(`SELECT organization_id FROM ct_nfc_tags WHERE custom_id = $1`, [originatingTagId], (err, result) => {
      if (!err && result.rows.length > 0) {
        orgId = result.rows[0].organization_id;
      } else {
        orgId = 1;
      }
      cb();
    });
  };
  
  resolveOrgFromTag(() => {
  const { ym } = req.query; // e.g., 2025-09
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
    return res.status(400).json({ success: false, error: 'ym required (YYYY-MM)' });
  }

  getOrganizationFeatures(orgId).then(features => {
    if (features.group_calendar_enabled === false) {
      return res.status(403).json({ success: false, error: 'Calendar is disabled for this group', code: 'FEATURE_DISABLED', feature: 'group_calendar_enabled' });
    }

    db.query(
      `WITH bounds AS (
         SELECT DATE_TRUNC('month', $2::date) AS month_start,
                (DATE_TRUNC('month', $2::date) + INTERVAL '1 month') AS next_month
       )
       SELECT e.id, e.title, e.description, e.location, e.address, e.start_at, e.end_at, e.all_day, e.link, e.notify_lead_minutes
       FROM CT_events e, bounds b
       WHERE e.organization_id = $1
         AND e.is_active = TRUE
         AND e.start_at < b.next_month
         AND COALESCE(e.end_at, e.start_at) >= b.month_start
       ORDER BY e.start_at ASC`,
      [orgId, ym + '-01'],
      (err, result) => {
        if (err) {
          console.error('Error fetching month events:', err);
          return res.status(500).json({ success: false, error: 'Failed to fetch month events' });
        }
        res.json({ success: true, events: result.rows || [] });
      }
    );
  }).catch(e => {
    console.error('Error checking org features (calendar month):', e);
    return res.status(500).json({ success: false, error: 'Failed to fetch month events' });
  });
  });
});

// Public: Get organization feature flags (for app bootstrap)
router.get('/features', async (req, res) => {
  let orgId = req.organization?.id || null;
  const originatingTagId = req.cookies?.originatingTag;

  try {
    if (!orgId) {
      if (originatingTagId) {
        const result = await db.query(`SELECT organization_id FROM ct_nfc_tags WHERE custom_id = $1`, [originatingTagId]);
        if (result.rows?.length > 0) orgId = result.rows[0].organization_id;
      }
      if (!orgId) orgId = 1;
    }

    const features = await getOrganizationFeatures(orgId);
    res.json({ success: true, features, translation_catalog: getTranslationCatalog() });
  } catch (e) {
    console.error('Error fetching public org features:', e);
    res.status(500).json({ success: false, error: 'Failed to fetch features' });
  }
});

// Active CTA for organization
router.get('/cta', (req, res) => {
  let orgId = req.organization?.id || null;
  const originatingTagId = req.cookies?.originatingTag;
  
  const resolveOrgFromTag = (cb) => {
    if (orgId) return cb();
    if (!originatingTagId) {
      orgId = 1;
      return cb();
    }
    db.query(`SELECT organization_id FROM ct_nfc_tags WHERE custom_id = $1`, [originatingTagId], (err, result) => {
      if (!err && result.rows.length > 0) {
        orgId = result.rows[0].organization_id;
      } else {
        orgId = 1;
      }
      cb();
    });
  };
  
  resolveOrgFromTag(() => {
  db.query(
    `SELECT id, text, url, icon, bg_color, text_color, start_at, end_at
     FROM CT_organization_cta
     WHERE organization_id = $1
       AND is_active = TRUE
       AND (start_at IS NULL OR start_at <= NOW())
       AND (end_at IS NULL OR end_at >= NOW())
     ORDER BY COALESCE(start_at, NOW()) DESC
     LIMIT 1`,
    [orgId],
    (err, result) => {
      if (err) {
        console.error('Error fetching CTA:', err);
        return res.status(500).json({ success: false, error: 'Failed to fetch CTA' });
      }
      res.json({ success: true, cta: result.rows[0] || null });
    }
  );
  });
});

// Get all public organizations for bracelet claiming
router.get('/public', (req, res) => {
  console.log('🏢 Fetching public organizations for bracelet claiming');

  db.query(
    `SELECT id, name, short_name, location
     FROM organizations
     WHERE is_active = true
     ORDER BY name ASC`,
    [],
    (err, result) => {
      if (err) {
        console.error('Error fetching public organizations:', err);
        return res.status(500).json({ success: false, error: 'Failed to fetch organizations' });
      }

      console.log('Found', result.rows.length, 'active organizations');
      res.json({ success: true, organizations: result.rows });
    }
  );
});

// Submit new organization request
router.post('/request', (req, res) => {
  const {
    tag_id,
    organization_name,
    organization_type,
    street_address,
    city,
    state,
    zip_code,
    country,
    first_name,
    last_name,
    contact_email,
    phone,
    website,
    description
  } = req.body;

  // Validate required fields
  if (!tag_id || !organization_name || !organization_type || !street_address || !city || !state || !zip_code || !first_name || !last_name || !contact_email) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: tag_id, organization_name, organization_type, street_address, city, state, zip_code, first_name, last_name, contact_email'
    });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(contact_email)) {
    return res.status(400).json({ success: false, error: 'Invalid email format' });
  }

  // Generate a subdomain suggestion based on organization name
  const suggested_subdomain = organization_name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '')
    .substring(0, 20);

  // Combine name fields
  const contact_name = `${first_name} ${last_name}`;

  // Combine address fields
  const full_address = `${street_address}, ${city}, ${state} ${zip_code}${country && country !== 'United States' ? ', ' + country : ''}`;

  console.log('📝 Submitting organization request:', {
    organization_name,
    organization_type,
    full_address,
    contact_email,
    contact_name,
    tag_id
  });

  db.query(`
    INSERT INTO ct_organization_requests (
      org_name, org_type, description, address, contact_name,
      contact_email, contact_phone, requested_subdomain,
      submitted_at, status, bracelet_uid, street_address, city, state, zip_code, country,
      first_name, last_name, website
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), 'pending', $9, $10, $11, $12, $13, $14, $15, $16, $17)
    RETURNING id
  `, [
    organization_name,
    organization_type,
    description || '',
    full_address,
    contact_name,
    contact_email,
    phone || null,
    suggested_subdomain,
    tag_id,
    street_address,
    city,
    state,
    zip_code,
    country || 'United States',
    first_name,
    last_name,
    website || null
  ], (err, result) => {
    if (err) {
      console.error('Error submitting organization request:', err);
      return res.status(500).json({ success: false, error: 'Failed to submit request' });
    }

    const requestId = result.rows[0].id;
    console.log('✅ Organization request submitted with ID:', requestId);

    res.json({
      success: true,
      message: 'Organization request submitted successfully',
      request_id: requestId
    });
  });
});

module.exports = router;
