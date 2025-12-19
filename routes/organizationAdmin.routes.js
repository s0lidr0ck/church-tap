const express = require('express');
const { dbQuery } = require('../config/database');
const { db } = require('../config/database');
const { requireOrgAuth } = require('../config/middleware');
const RecurringEventService = require('../services/recurringEventService');
const CalendarSyncService = require('../services/calendarSyncService');
const { getOrganizationFeatures, updateOrganizationFeatures, getTranslationCatalog } = require('../services/organizationFeaturesService');
const { parseVerseReference } = require('../services/bibleReferenceParser');

const router = express.Router();

function isAllowedOrganizationLinkUrl(raw) {
  const url = (raw || '').toString().trim();
  if (!url) return false;
  // No whitespace allowed in URLs we store (prevents a lot of injection/typos).
  if (/\s/.test(url)) return false;
  if (url.length > 2048) return false;
  try {
    const u = new URL(url);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(u.protocol);
  } catch (e) {
    return false;
  }
}

// ===========================
// Organization Profile (basic fields) - Admin
// ===========================
router.get('/profile', requireOrgAuth, async (req, res) => {
  try {
    const orgId = req.session.organizationId;
    const result = await db.query(
      `
      SELECT
        id,
        name,
        subdomain,
        address,
        city,
        state,
        zip_code,
        country,
        latitude,
        longitude
      FROM ct_organizations
      WHERE id = $1
      LIMIT 1
      `,
      [orgId]
    );
    const org = result.rows?.[0] || null;
    if (!org) return res.status(404).json({ success: false, error: 'Organization not found' });
    res.json({ success: true, organization: org });
  } catch (e) {
    console.error('Error fetching organization profile:', e);
    res.status(500).json({ success: false, error: 'Failed to fetch organization profile' });
  }
});

function requireSettingsWriteRole(req, res) {
  const role = (req.session?.admin?.role || '').toString().toLowerCase();
  const allowedRoles = new Set(['admin', 'super_admin', 'owner']);
  if (!allowedRoles.has(role)) {
    res.status(403).json({ success: false, error: 'Insufficient permissions to update settings', code: 'INSUFFICIENT_ROLE' });
    return false;
  }
  return true;
}

// ===========================
// Feature Flags (ct_organization_features) - Admin
// ===========================
router.get('/features', requireOrgAuth, async (req, res) => {
  try {
    const orgId = req.session.organizationId;
    const features = await getOrganizationFeatures(orgId);
    res.json({ success: true, features, translation_catalog: getTranslationCatalog() });
  } catch (e) {
    console.error('Error fetching org features:', e);
    res.status(500).json({ success: false, error: 'Failed to fetch features' });
  }
});

router.put('/features', requireOrgAuth, async (req, res) => {
  try {
    // Role-based admin authorization: only allowed roles can modify settings.
    // (Reading is available to any authenticated org admin.)
    if (!requireSettingsWriteRole(req, res)) return;

    const orgId = req.session.organizationId;
    const updated = await updateOrganizationFeatures(orgId, req.body || {});
    res.json({ success: true, features: updated, translation_catalog: getTranslationCatalog() });
  } catch (e) {
    console.error('Error updating org features:', e);
    res.status(500).json({ success: false, error: 'Failed to update features' });
  }
});

// Admin: Get all organization links
router.get('/links', requireOrgAuth, (req, res) => {
  db.query(
    `SELECT * FROM ct_organization_links
     WHERE organization_id = $1
     ORDER BY sort_order ASC, title ASC`,
    [req.session.organizationId],
    (err, result) => {
      if (err) {
        console.error('Error fetching organization links:', err);
        return res.status(500).json({ success: false, error: 'Failed to fetch links' });
      }
      res.json(result.rows || []);
    }
  );
});

// Admin: Create organization link
router.post('/links', requireOrgAuth, (req, res) => {
  const { title, url, icon, sort_order } = req.body;
  
  if (!title || !url) {
    return res.status(400).json({ success: false, error: 'Title and URL are required' });
  }
  if (!isAllowedOrganizationLinkUrl(url)) {
    return res.status(400).json({ success: false, error: 'Invalid URL. Please use a full http(s) URL (or mailto:/tel:).' });
  }
  
  dbQuery.run(
    `INSERT INTO ct_organization_links (organization_id, title, url, icon, sort_order)
     VALUES ($1, $2, $3, $4, $5)`,
    [req.session.organizationId, title, url, icon || 'website', sort_order || 0],
    function(err) {
      if (err) {
        console.error('Error creating organization link:', err);
        return res.status(500).json({ success: false, error: 'Failed to create link' });
      }
      
      res.json({ 
        success: true, 
        link: {
          id: this.lastID,
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
  if (!isAllowedOrganizationLinkUrl(url)) {
    return res.status(400).json({ success: false, error: 'Invalid URL. Please use a full http(s) URL (or mailto:/tel:).' });
  }
  
  dbQuery.run(
    `UPDATE ct_organization_links 
     SET title = $1, url = $2, icon = $3, sort_order = $4, is_active = $5
     WHERE id = $6 AND organization_id = $7`,
    [title, url, icon || 'website', sort_order || 0, is_active !== undefined ? is_active : true, id, req.session.organizationId],
    function(err) {
      if (err) {
        console.error('Error updating organization link:', err);
        return res.status(500).json({ success: false, error: 'Failed to update link' });
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ success: false, error: 'Link not found' });
      }
      
      res.json({ success: true });
    }
  );
});

// Admin: Delete organization link
router.delete('/links/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  
  dbQuery.run(
    `DELETE FROM ct_organization_links 
     WHERE id = $1 AND organization_id = $2`,
    [id, req.session.organizationId],
    function(err) {
      if (err) {
        console.error('Error deleting organization link:', err);
        return res.status(500).json({ success: false, error: 'Failed to delete link' });
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ success: false, error: 'Link not found' });
      }
      
      res.json({ success: true });
    }
  );
});

// ===========================
// Emergency Scripture Topics - Admin
// ===========================
router.get('/topics', requireOrgAuth, async (req, res) => {
  try {
    const orgId = req.session.organizationId;
    const result = await db.query(
      `SELECT t.*,
              (SELECT COUNT(*)::int FROM ct_scripture_topic_verses v WHERE v.topic_id = t.id) AS verse_count
       FROM ct_scripture_topics t
       WHERE t.organization_id = $1
       ORDER BY t.sort_order ASC, t.name ASC`,
      [orgId]
    );
    res.json({ success: true, topics: result.rows || [] });
  } catch (e) {
    console.error('Error fetching topics:', e);
    res.status(500).json({ success: false, error: 'Failed to fetch topics' });
  }
});

// ===========================
// Default Topic Templates - Org Admin (enable/disable)
// ===========================
router.get('/default-topics', requireOrgAuth, async (req, res) => {
  try {
    const orgId = req.session.organizationId;
    const result = await db.query(
      `SELECT t.id, t.name, t.description, t.sort_order,
              COALESCE(s.is_enabled, TRUE) AS is_enabled,
              (SELECT COUNT(*)::int FROM ct_topic_template_verses v WHERE v.template_id = t.id) AS verse_count
       FROM ct_topic_templates t
       LEFT JOIN ct_organization_topic_template_settings s
         ON s.template_id = t.id AND s.organization_id = $1
       WHERE t.is_active = TRUE
       ORDER BY t.sort_order ASC, t.name ASC`,
      [orgId]
    );
    res.json({ success: true, topics: result.rows || [] });
  } catch (e) {
    console.error('Error fetching default topics:', e);
    res.status(500).json({ success: false, error: 'Failed to fetch default topics' });
  }
});

router.put('/default-topics/:id', requireOrgAuth, async (req, res) => {
  try {
    if (!requireSettingsWriteRole(req, res)) return;
    const orgId = req.session.organizationId;
    const templateId = parseInt(req.params.id, 10);
    const { is_enabled } = req.body || {};
    if (!templateId) return res.status(400).json({ success: false, error: 'Invalid topic id' });
    if (typeof is_enabled !== 'boolean') return res.status(400).json({ success: false, error: 'is_enabled must be boolean' });

    // Ensure template exists and active
    const tpl = await db.query(`SELECT id FROM ct_topic_templates WHERE id = $1 AND is_active = TRUE`, [templateId]);
    if (!tpl.rows?.length) return res.status(404).json({ success: false, error: 'Topic not found' });

    await db.query(
      `INSERT INTO ct_organization_topic_template_settings (organization_id, template_id, is_enabled)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, template_id) DO UPDATE
         SET is_enabled = EXCLUDED.is_enabled,
             updated_at = NOW()`,
      [orgId, templateId, is_enabled]
    );

    res.json({ success: true });
  } catch (e) {
    console.error('Error updating default topic setting:', e);
    res.status(500).json({ success: false, error: 'Failed to update default topic setting' });
  }
});

router.post('/topics', requireOrgAuth, async (req, res) => {
  try {
    if (!requireSettingsWriteRole(req, res)) return;
    const orgId = req.session.organizationId;
    const { name, description, sort_order, is_active } = req.body || {};
    if (!name || !name.toString().trim()) {
      return res.status(400).json({ success: false, error: 'Topic name is required' });
    }

    const result = await db.query(
      `INSERT INTO ct_scripture_topics (organization_id, name, description, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [orgId, name.toString().trim(), description || null, parseInt(sort_order ?? 0, 10) || 0, is_active !== false]
    );

    res.json({ success: true, topic: result.rows[0] });
  } catch (e) {
    console.error('Error creating topic:', e);
    res.status(500).json({ success: false, error: 'Failed to create topic' });
  }
});

router.put('/topics/:id', requireOrgAuth, async (req, res) => {
  try {
    if (!requireSettingsWriteRole(req, res)) return;
    const orgId = req.session.organizationId;
    const id = parseInt(req.params.id, 10);
    const { name, description, sort_order, is_active } = req.body || {};
    if (!id) return res.status(400).json({ success: false, error: 'Invalid topic id' });
    if (!name || !name.toString().trim()) {
      return res.status(400).json({ success: false, error: 'Topic name is required' });
    }

    const result = await db.query(
      `UPDATE ct_scripture_topics
       SET name = $1,
           description = $2,
           sort_order = $3,
           is_active = $4,
           updated_at = NOW()
       WHERE id = $5 AND organization_id = $6
       RETURNING *`,
      [name.toString().trim(), description || null, parseInt(sort_order ?? 0, 10) || 0, is_active !== false, id, orgId]
    );

    if (!result.rows?.length) return res.status(404).json({ success: false, error: 'Topic not found' });
    res.json({ success: true, topic: result.rows[0] });
  } catch (e) {
    console.error('Error updating topic:', e);
    res.status(500).json({ success: false, error: 'Failed to update topic' });
  }
});

router.delete('/topics/:id', requireOrgAuth, async (req, res) => {
  try {
    if (!requireSettingsWriteRole(req, res)) return;
    const orgId = req.session.organizationId;
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid topic id' });

    const result = await db.query(
      `DELETE FROM ct_scripture_topics WHERE id = $1 AND organization_id = $2`,
      [id, orgId]
    );

    if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Topic not found' });
    res.json({ success: true });
  } catch (e) {
    console.error('Error deleting topic:', e);
    res.status(500).json({ success: false, error: 'Failed to delete topic' });
  }
});

router.get('/topics/:id/verses', requireOrgAuth, async (req, res) => {
  try {
    const orgId = req.session.organizationId;
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid topic id' });

    // Ensure topic belongs to org
    const topic = await db.query(`SELECT id FROM ct_scripture_topics WHERE id = $1 AND organization_id = $2`, [id, orgId]);
    if (!topic.rows?.length) return res.status(404).json({ success: false, error: 'Topic not found' });

    const result = await db.query(
      `SELECT id, bible_reference, book_number, chapter, verse_start, verse_end, translation_code, created_at
       FROM ct_scripture_topic_verses
       WHERE topic_id = $1
       ORDER BY created_at DESC`,
      [id]
    );

    res.json({ success: true, verses: result.rows || [] });
  } catch (e) {
    console.error('Error fetching topic verses:', e);
    res.status(500).json({ success: false, error: 'Failed to fetch topic verses' });
  }
});

router.post('/topics/:id/verses', requireOrgAuth, async (req, res) => {
  try {
    if (!requireSettingsWriteRole(req, res)) return;
    const orgId = req.session.organizationId;
    const id = parseInt(req.params.id, 10);
    const { bible_reference, translation_code } = req.body || {};
    if (!id) return res.status(400).json({ success: false, error: 'Invalid topic id' });
    if (!bible_reference || !bible_reference.toString().trim()) {
      return res.status(400).json({ success: false, error: 'bible_reference is required' });
    }

    const topic = await db.query(`SELECT id FROM ct_scripture_topics WHERE id = $1 AND organization_id = $2`, [id, orgId]);
    if (!topic.rows?.length) return res.status(404).json({ success: false, error: 'Topic not found' });

    const parsed = parseVerseReference(bible_reference);
    const result = await db.query(
      `INSERT INTO ct_scripture_topic_verses (topic_id, bible_reference, book_number, chapter, verse_start, verse_end, translation_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        id,
        parsed.normalized_reference,
        parsed.book_number,
        parsed.chapter,
        parsed.verse_start,
        parsed.verse_end,
        translation_code ? translation_code.toString().trim().toUpperCase() : null
      ]
    );

    res.json({ success: true, verse: result.rows[0] });
  } catch (e) {
    console.error('Error adding topic verse:', e);
    const msg = (e && e.message) ? e.message : 'Failed to add topic verse';
    res.status(400).json({ success: false, error: msg });
  }
});

router.delete('/topics/:topicId/verses/:verseId', requireOrgAuth, async (req, res) => {
  try {
    if (!requireSettingsWriteRole(req, res)) return;
    const orgId = req.session.organizationId;
    const topicId = parseInt(req.params.topicId, 10);
    const verseId = parseInt(req.params.verseId, 10);
    if (!topicId || !verseId) return res.status(400).json({ success: false, error: 'Invalid id(s)' });

    const topic = await db.query(`SELECT id FROM ct_scripture_topics WHERE id = $1 AND organization_id = $2`, [topicId, orgId]);
    if (!topic.rows?.length) return res.status(404).json({ success: false, error: 'Topic not found' });

    const result = await db.query(`DELETE FROM ct_scripture_topic_verses WHERE id = $1 AND topic_id = $2`, [verseId, topicId]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Verse not found' });

    res.json({ success: true });
  } catch (e) {
    console.error('Error deleting topic verse:', e);
    res.status(500).json({ success: false, error: 'Failed to delete topic verse' });
  }
});

// ===========================
// Fundraising Goal - Admin
// ===========================
router.get('/fundraising', requireOrgAuth, async (req, res) => {
  try {
    const orgId = req.session.organizationId;
    const result = await db.query(
      `SELECT organization_id, goal_title, goal_amount_cents, current_amount_cents, deadline_date, is_active
       FROM ct_fundraising_goals
       WHERE organization_id = $1`,
      [orgId]
    );
    res.json({ success: true, fundraising: result.rows[0] || null });
  } catch (e) {
    console.error('Error fetching fundraising goal:', e);
    res.status(500).json({ success: false, error: 'Failed to fetch fundraising goal' });
  }
});

router.put('/fundraising', requireOrgAuth, async (req, res) => {
  try {
    if (!requireSettingsWriteRole(req, res)) return;
    const orgId = req.session.organizationId;
    const { goal_title, goal_amount_cents, current_amount_cents, deadline_date, is_active } = req.body || {};

    const title = (goal_title || '').toString().trim();
    const goalCents = parseInt(goal_amount_cents, 10);
    const currentCents = current_amount_cents === undefined || current_amount_cents === null ? 0 : parseInt(current_amount_cents, 10);

    if (!title) return res.status(400).json({ success: false, error: 'goal_title is required' });
    if (!Number.isFinite(goalCents) || goalCents <= 0) return res.status(400).json({ success: false, error: 'goal_amount_cents must be > 0' });
    if (!Number.isFinite(currentCents) || currentCents < 0) return res.status(400).json({ success: false, error: 'current_amount_cents must be >= 0' });

    const result = await db.query(
      `INSERT INTO ct_fundraising_goals (organization_id, goal_title, goal_amount_cents, current_amount_cents, deadline_date, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (organization_id) DO UPDATE
         SET goal_title = EXCLUDED.goal_title,
             goal_amount_cents = EXCLUDED.goal_amount_cents,
             current_amount_cents = EXCLUDED.current_amount_cents,
             deadline_date = EXCLUDED.deadline_date,
             is_active = EXCLUDED.is_active,
             updated_at = NOW()
       RETURNING organization_id, goal_title, goal_amount_cents, current_amount_cents, deadline_date, is_active`,
      [orgId, title, goalCents, currentCents, deadline_date || null, is_active !== false]
    );

    res.json({ success: true, fundraising: result.rows[0] });
  } catch (e) {
    console.error('Error updating fundraising goal:', e);
    res.status(500).json({ success: false, error: 'Failed to update fundraising goal' });
  }
});

// ===========================
// Worship Playlist - Admin (separate from generic links)
// ===========================
router.get('/worship-playlist', requireOrgAuth, async (req, res) => {
  try {
    const orgId = req.session.organizationId;
    const result = await db.query(
      `SELECT organization_id, title, youtube_url, is_active
       FROM ct_organization_worship_playlists
       WHERE organization_id = $1`,
      [orgId]
    );
    res.json({ success: true, playlist: result.rows[0] || null });
  } catch (e) {
    console.error('Error fetching worship playlist:', e);
    res.status(500).json({ success: false, error: 'Failed to fetch worship playlist' });
  }
});

router.put('/worship-playlist', requireOrgAuth, async (req, res) => {
  try {
    if (!requireSettingsWriteRole(req, res)) return;
    const orgId = req.session.organizationId;
    const { title, youtube_url, is_active } = req.body || {};

    const t = (title || 'Worship Playlist').toString().trim() || 'Worship Playlist';
    const url = (youtube_url || '').toString().trim();
    if (!url) return res.status(400).json({ success: false, error: 'youtube_url is required' });

    const result = await db.query(
      `INSERT INTO ct_organization_worship_playlists (organization_id, title, youtube_url, is_active)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id) DO UPDATE
         SET title = EXCLUDED.title,
             youtube_url = EXCLUDED.youtube_url,
             is_active = EXCLUDED.is_active,
             updated_at = NOW()
       RETURNING organization_id, title, youtube_url, is_active`,
      [orgId, t, url, is_active !== false]
    );

    res.json({ success: true, playlist: result.rows[0] });
  } catch (e) {
    console.error('Error saving worship playlist:', e);
    res.status(500).json({ success: false, error: 'Failed to save worship playlist' });
  }
});

// ===========================
// Events (CT_events) - Admin
// ===========================
router.get('/events', requireOrgAuth, (req, res) => {
  const includeInstances = String(req.query?.include_instances || '').toLowerCase() === 'true';
  // First check if recurring columns exist
  db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'ct_events' AND column_name = 'is_recurring'
  `, [], (err, columnCheck) => {
    if (err) {
      console.error('Error checking columns:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }

    const hasRecurringColumns = columnCheck.rows.length > 0;

    // Use appropriate query based on whether recurring columns exist
    const instanceFilter = includeInstances ? '' : `AND (is_instance IS NOT TRUE)`;

    const query = hasRecurringColumns ? `
      SELECT
        e.id,
        e.title,
        e.description,
        e.location,
        e.address,
        e.start_at,
        e.end_at,
        e.all_day,
        e.link,
        e.is_active,
        e.notify_lead_minutes,
        e.is_recurring,
        e.recurrence_type,
        e.recurrence_interval,
        e.recurrence_days,
        e.recurrence_end_date,
        e.parent_event_id,
        e.instance_date,
        e.is_instance,
        CASE
          WHEN e.is_recurring = TRUE AND (e.is_instance IS NOT TRUE)
            THEN (
              SELECT COUNT(*)::int
              FROM ct_event_occurrence_exceptions ex
              WHERE ex.parent_event_id = e.id AND ex.action = 'cancelled'
            )
          ELSE 0
        END AS cancelled_count
      FROM CT_events e
      WHERE e.organization_id = $1
        ${instanceFilter}
      ORDER BY e.start_at DESC
    ` : `
      SELECT id, title, description, location, address, start_at, end_at, all_day, link, is_active, notify_lead_minutes,
             FALSE as is_recurring, NULL as recurrence_type, 1 as recurrence_interval, NULL as recurrence_days, NULL as recurrence_end_date,
             NULL as parent_event_id, NULL as instance_date, FALSE as is_instance
      FROM CT_events
      WHERE organization_id = $1
      ORDER BY start_at DESC
    `;

    db.query(query, [req.session.organizationId], (err, result) => {
      if (err) {
        console.error('Error fetching events:', err);
        return res.status(500).json({ success: false, error: 'Failed to fetch events' });
      }
      res.json({ success: true, events: result.rows || [] });
    });
  });
});

router.post('/events', requireOrgAuth, async (req, res) => {
  const {
    title, description, location, address, start_at, end_at, all_day, link, is_active, notify_lead_minutes,
    is_recurring, recurrence_type, recurrence_interval, recurrence_days, recurrence_end_date
  } = req.body || {};

  if (!title || !start_at) {
    return res.status(400).json({ success: false, error: 'Title and start_at are required' });
  }

  try {
    // Check if recurring columns exist
    const columnCheck = await db.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'ct_events' AND column_name = 'is_recurring'
    `, []);

    const hasRecurringColumns = columnCheck.rows.length > 0;

    // Use appropriate query based on whether recurring columns exist
    const query = hasRecurringColumns ? `
      INSERT INTO CT_events (
        organization_id, title, description, location, address, start_at, end_at, all_day, link, is_active, notify_lead_minutes,
        is_recurring, recurrence_type, recurrence_interval, recurrence_days, recurrence_end_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    ` : `
      INSERT INTO CT_events (
        organization_id, title, description, location, address, start_at, end_at, all_day, link, is_active, notify_lead_minutes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;

    const params = hasRecurringColumns ? [
      req.session.organizationId, title, description || null, location || null, address || null,
      start_at, end_at || null, !!all_day, link || null, is_active !== false, notify_lead_minutes || 120,
      !!is_recurring,
      (recurrence_type || '').toString().trim().toLowerCase() || null,
      recurrence_interval || 1,
      Array.isArray(recurrence_days) ? JSON.stringify(recurrence_days) : (recurrence_days ? JSON.stringify(recurrence_days) : null),
      recurrence_end_date || null
    ] : [
      req.session.organizationId, title, description || null, location || null, address || null,
      start_at, end_at || null, !!all_day, link || null, is_active !== false, notify_lead_minutes || 120
    ];

    const result = await db.query(query, params);

    const savedEvent = result.rows[0];
    const eventId = savedEvent.id;

    // If it's a recurring event and recurring columns exist, generate instances
    if (hasRecurringColumns && is_recurring) {
      await RecurringEventService.generateInstancesForEvent(
        { ...savedEvent, is_recurring: true },
        new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
      );
    }

    res.json({ success: true, id: eventId });
  } catch (err) {
    console.error('Error creating event:', err);
    return res.status(500).json({ success: false, error: 'Failed to create event' });
  }
});

router.put('/events/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  const {
    title, description, location, address, start_at, end_at, all_day, link, is_active, notify_lead_minutes,
    is_recurring, recurrence_type, recurrence_interval, recurrence_days, recurrence_end_date
  } = req.body || {};
  if (!title || !start_at) {
    return res.status(400).json({ success: false, error: 'Title and start_at are required' });
  }
  // Update recurring columns too (they exist in the current Postgres schema).
  db.query(`
    UPDATE CT_events
    SET
      title = $1,
      description = $2,
      location = $3,
      address = $4,
      start_at = $5,
      end_at = $6,
      all_day = $7,
      link = $8,
      is_active = $9,
      notify_lead_minutes = $10,
      is_recurring = $11,
      recurrence_type = $12,
      recurrence_interval = $13,
      recurrence_days = $14,
      recurrence_end_date = $15,
      updated_at = NOW()
    WHERE id = $16 AND organization_id = $17
    RETURNING *
  `, [
    title,
    description || null,
    location || null,
    address || null,
    start_at,
    end_at || null,
    !!all_day,
    link || null,
    is_active !== false,
    notify_lead_minutes || 120,
    !!is_recurring,
    (recurrence_type || '').toString().trim().toLowerCase() || null,
    parseInt(recurrence_interval || 1, 10) || 1,
    Array.isArray(recurrence_days) ? JSON.stringify(recurrence_days) : (recurrence_days ? JSON.stringify(recurrence_days) : null),
    recurrence_end_date || null,
    id,
    req.session.organizationId
  ], async (err, result) => {
    if (err) {
      console.error('Error updating event:', err);
      return res.status(500).json({ success: false, error: 'Failed to update event' });
    }
    const updated = result.rows?.[0];
    if (!updated) return res.status(404).json({ success: false, error: 'Event not found' });

    // If this is a parent recurring event, regenerate future instances so changes take effect.
    try {
      if (updated.is_recurring === true && updated.is_instance !== true) {
        await RecurringEventService.updateFutureInstances(updated);
      }
    } catch (regenErr) {
      console.error('Error regenerating recurring instances:', regenErr);
      // Don't fail the save; the event update succeeded. Admin can regenerate via endpoint.
    }

    res.json({ success: true, event: updated });
  });
});

router.delete('/events/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  db.query(`DELETE FROM CT_events WHERE id = $1 AND organization_id = $2`, [id, req.session.organizationId], (err, result) => {
    if (err) {
      console.error('Error deleting event:', err);
      return res.status(500).json({ success: false, error: 'Failed to delete event' });
    }
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Event not found' });
    res.json({ success: true });
  });
});

// Cancel or restore a single occurrence of a recurring event (by date).
// This creates/removes an exception so the generator won't recreate cancelled dates.
router.post('/events/:id/occurrence', requireOrgAuth, async (req, res) => {
  try {
    if (!requireSettingsWriteRole(req, res)) return;

    const parentId = parseInt(req.params.id, 10);
    const action = (req.body?.action || '').toString().trim().toLowerCase();
    const dateStr = (req.body?.date || '').toString().trim(); // YYYY-MM-DD
    const reason = (req.body?.reason || '').toString().trim() || null;

    if (!parentId) return res.status(400).json({ success: false, error: 'Invalid event id' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' });
    if (!['cancel', 'restore'].includes(action)) return res.status(400).json({ success: false, error: 'action must be cancel or restore' });

    const orgId = req.session.organizationId;
    const adminId = req.session?.admin?.id || req.session?.adminId || null;

    const parentResult = await db.query(
      `SELECT * FROM CT_events WHERE id = $1 AND organization_id = $2`,
      [parentId, orgId]
    );
    const parent = parentResult.rows?.[0];
    if (!parent) return res.status(404).json({ success: false, error: 'Event not found' });
    if (parent.is_recurring !== true) return res.status(400).json({ success: false, error: 'Event is not recurring' });
    if (parent.is_instance === true) return res.status(400).json({ success: false, error: 'Use the parent recurring event id (not an instance)' });

    if (action === 'cancel') {
      // Mark existing instance inactive if present.
      await db.query(
        `UPDATE CT_events
         SET is_active = FALSE, updated_at = NOW()
         WHERE parent_event_id = $1 AND instance_date = $2`,
        [parentId, dateStr]
      );

      // Add/update exception so generator never recreates it.
      await db.query(
        `
        INSERT INTO ct_event_occurrence_exceptions (organization_id, parent_event_id, instance_date, action, reason, created_by_admin_id)
        VALUES ($1, $2, $3, 'cancelled', $4, $5)
        ON CONFLICT (parent_event_id, instance_date)
        DO UPDATE SET action = 'cancelled', reason = EXCLUDED.reason, updated_at = NOW()
        `,
        [orgId, parentId, dateStr, reason, adminId]
      );

      return res.json({ success: true, status: 'cancelled', date: dateStr });
    }

    // restore
    await db.query(
      `DELETE FROM ct_event_occurrence_exceptions WHERE parent_event_id = $1 AND instance_date = $2`,
      [parentId, dateStr]
    );

    // If an instance exists, re-activate it; otherwise generate just this one.
    const existing = await db.query(
      `SELECT id FROM CT_events WHERE parent_event_id = $1 AND instance_date = $2`,
      [parentId, dateStr]
    );

    if ((existing.rows || []).length > 0) {
      await db.query(
        `UPDATE CT_events
         SET is_active = TRUE, updated_at = NOW()
         WHERE parent_event_id = $1 AND instance_date = $2`,
        [parentId, dateStr]
      );
      return res.json({ success: true, status: 'restored', date: dateStr, instance_exists: true });
    }

    // Generate only this date as an instance (even if outside the normal pattern).
    const instanceDay = new Date(dateStr + 'T00:00:00');
    const startAt = new Date(parent.start_at);
    const durationMs = parent.end_at ? (new Date(parent.end_at).getTime() - startAt.getTime()) : null;
    const RecurringEventService = require('../services/recurringEventService');
    await RecurringEventService.createEventInstance(parent, instanceDay, durationMs);

    return res.json({ success: true, status: 'restored', date: dateStr, instance_created: true });
  } catch (e) {
    console.error('Error updating event occurrence:', e);
    return res.status(500).json({ success: false, error: 'Failed to update occurrence' });
  }
});

// List cancelled occurrence exceptions for a recurring event.
router.get('/events/:id/exceptions', requireOrgAuth, async (req, res) => {
  try {
    const parentId = parseInt(req.params.id, 10);
    if (!parentId) return res.status(400).json({ success: false, error: 'Invalid event id' });

    const orgId = req.session.organizationId;
    const parentResult = await db.query(
      `SELECT id, is_recurring, is_instance FROM CT_events WHERE id = $1 AND organization_id = $2`,
      [parentId, orgId]
    );
    const parent = parentResult.rows?.[0];
    if (!parent) return res.status(404).json({ success: false, error: 'Event not found' });
    if (parent.is_recurring !== true || parent.is_instance === true) {
      return res.status(400).json({ success: false, error: 'Exceptions apply to parent recurring events only' });
    }

    const result = await db.query(
      `
      SELECT instance_date, reason, created_at, updated_at
      FROM ct_event_occurrence_exceptions
      WHERE organization_id = $1
        AND parent_event_id = $2
        AND action = 'cancelled'
      ORDER BY instance_date DESC
      `,
      [orgId, parentId]
    );

    return res.json({ success: true, exceptions: result.rows || [] });
  } catch (e) {
    console.error('Error fetching event exceptions:', e);
    return res.status(500).json({ success: false, error: 'Failed to fetch exceptions' });
  }
});

// List upcoming occurrences for a recurring event (and ensure instances exist).
router.get('/events/:id/occurrences', requireOrgAuth, async (req, res) => {
  try {
    const parentId = parseInt(req.params.id, 10);
    if (!parentId) return res.status(400).json({ success: false, error: 'Invalid event id' });

    const orgId = req.session.organizationId;
    const parentResult = await db.query(
      `SELECT * FROM CT_events WHERE id = $1 AND organization_id = $2`,
      [parentId, orgId]
    );
    const parent = parentResult.rows?.[0];
    if (!parent) return res.status(404).json({ success: false, error: 'Event not found' });
    if (parent.is_recurring !== true || parent.is_instance === true) {
      return res.status(400).json({ success: false, error: 'Occurrences apply to parent recurring events only' });
    }

    const daysAheadRaw = parseInt(req.query?.days_ahead ?? 90, 10);
    const daysAhead = Math.max(7, Math.min(Number.isFinite(daysAheadRaw) ? daysAheadRaw : 90, 365));
    const now = new Date();
    const endDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    // Ensure instances exist (generator will skip cancelled dates via exceptions).
    try {
      await RecurringEventService.generateInstancesForEvent(parent, endDate);
    } catch (e) {
      // Don't fail listing if generation fails; we can still show whatever exists.
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    const [instancesRes, exRes] = await Promise.all([
      db.query(
        `
        SELECT id, start_at, end_at, instance_date, is_active
        FROM CT_events
        WHERE organization_id = $1
          AND parent_event_id = $2
          AND is_instance = TRUE
          AND instance_date >= $3::date
          AND instance_date <= $4::date
        ORDER BY instance_date ASC
        `,
        [orgId, parentId, todayStr, endStr]
      ),
      db.query(
        `
        SELECT instance_date, reason, created_at, updated_at
        FROM ct_event_occurrence_exceptions
        WHERE organization_id = $1
          AND parent_event_id = $2
          AND action = 'cancelled'
          AND instance_date >= $3::date
          AND instance_date <= $4::date
        ORDER BY instance_date ASC
        `,
        [orgId, parentId, todayStr, endStr]
      )
    ]);

    const exceptionsByDate = new Map();
    for (const ex of (exRes.rows || [])) {
      const d = String(ex.instance_date).slice(0, 10);
      exceptionsByDate.set(d, ex);
    }

    const occurrences = [];
    const instanceDates = new Set();
    for (const row of (instancesRes.rows || [])) {
      const d = String(row.instance_date).slice(0, 10);
      instanceDates.add(d);
      const ex = exceptionsByDate.get(d);
      const cancelled = row.is_active === false || !!ex;
      occurrences.push({
        instance_date: d,
        start_at: row.start_at,
        end_at: row.end_at,
        is_instance_row: true,
        is_cancelled: cancelled,
        reason: (ex?.reason || null),
        exception_updated_at: ex?.updated_at || null
      });
    }

    // Include exceptions that don't currently have an instance row (rare, but possible).
    const parentStart = parent.start_at ? new Date(parent.start_at) : null;
    const durationMs = (parent.start_at && parent.end_at)
      ? (new Date(parent.end_at).getTime() - new Date(parent.start_at).getTime())
      : null;
    for (const [d, ex] of exceptionsByDate.entries()) {
      if (instanceDates.has(d)) continue;
      // Build a best-effort start/end from parent time-of-day.
      let startAt = null;
      let endAt = null;
      if (parentStart && Number.isFinite(parentStart.getTime())) {
        const s = new Date(d + 'T00:00:00');
        s.setHours(parentStart.getHours(), parentStart.getMinutes(), parentStart.getSeconds(), parentStart.getMilliseconds());
        startAt = s;
        if (durationMs !== null && Number.isFinite(durationMs)) endAt = new Date(s.getTime() + durationMs);
      }
      occurrences.push({
        instance_date: d,
        start_at: startAt,
        end_at: endAt,
        is_instance_row: false,
        is_cancelled: true,
        reason: (ex?.reason || null),
        exception_updated_at: ex?.updated_at || null
      });
    }

    occurrences.sort((a, b) => String(a.instance_date).localeCompare(String(b.instance_date)));

    return res.json({ success: true, days_ahead: daysAhead, occurrences });
  } catch (e) {
    console.error('Error fetching event occurrences:', e);
    return res.status(500).json({ success: false, error: 'Failed to fetch occurrences' });
  }
});

// ===========================
// CTA (CT_organization_cta) - Admin
// ===========================
router.get('/ctas', requireOrgAuth, (req, res) => {
  dbQuery.all(`
    SELECT id, text, url, icon, bg_color, text_color, start_at, end_at, is_active
    FROM CT_organization_cta
    WHERE organization_id = $1
    ORDER BY COALESCE(start_at, NOW()) DESC
  `, [req.session.organizationId], (err, rows) => {
    if (err) {
      console.error('Error fetching CTAs:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch CTAs' });
    }
    res.json({ success: true, ctas: rows || [] });
  });
});

router.post('/ctas', requireOrgAuth, (req, res) => {
  const { text, url, icon, bg_color, text_color, start_at, end_at, is_active } = req.body || {};
  if (!text) {
    return res.status(400).json({ success: false, error: 'Text is required' });
  }
  dbQuery.run(`
    INSERT INTO CT_organization_cta (organization_id, text, url, icon, bg_color, text_color, start_at, end_at, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [req.session.organizationId, text, url || null, icon || '📣', bg_color || '#0ea5e9', text_color || '#ffffff', start_at || null, end_at || null, is_active !== false], function(err) {
    if (err) {
      console.error('Error creating CTA:', err);
      return res.status(500).json({ success: false, error: 'Failed to create CTA' });
    }
    res.json({ success: true, id: this.lastID });
  });
});

router.put('/ctas/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  const { text, url, icon, bg_color, text_color, start_at, end_at, is_active } = req.body || {};
  if (!text) {
    return res.status(400).json({ success: false, error: 'Text is required' });
  }
  dbQuery.run(`
    UPDATE CT_organization_cta
    SET text = $1, url = $2, icon = $3, bg_color = $4, text_color = $5, start_at = $6, end_at = $7, is_active = $8
    WHERE id = $9 AND organization_id = $10
  `, [text, url || null, icon || '📣', bg_color || '#0ea5e9', text_color || '#ffffff', start_at || null, end_at || null, is_active !== false, id, req.session.organizationId], (err, result) => {
    if (err) {
      console.error('Error updating CTA:', err);
      return res.status(500).json({ success: false, error: 'Failed to update CTA' });
    }
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'CTA not found' });
    res.json({ success: true });
  });
});

router.delete('/ctas/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  db.query(`DELETE FROM ct_organization_cta WHERE id = $1 AND organization_id = $2`, [id, req.session.organizationId], (err, result) => {
    if (err) {
      console.error('Error deleting CTA:', err);
      return res.status(500).json({ success: false, error: 'Failed to delete CTA' });
    }
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'CTA not found' });
    res.json({ success: true });
  });
});

// ===========================
// BRACELET MEMBERSHIP REQUESTS
// ===========================

// Get all bracelet membership requests for the organization
router.get('/bracelet-requests', requireOrgAuth, (req, res) => {
  const { status } = req.query;
  
  let whereClause = 'WHERE bm.organization_id = $1';
  const params = [req.session.organizationId];
  
  if (status && ['pending', 'approved', 'denied'].includes(status)) {
    whereClause += ' AND bm.status = $2';
    params.push(status);
  }
  
  const sql = `
    SELECT 
      bm.id,
      bm.bracelet_uid,
      bm.status,
      bm.requested_at,
      bm.approved_at,
      bm.approved_by,
      nt.scan_count,
      nt.last_scanned_at,
      au.username as approved_by_username
    FROM ct_bracelet_memberships bm
    LEFT JOIN ct_nfc_tags nt ON bm.bracelet_uid = nt.custom_id
    LEFT JOIN CT_admin_users au ON bm.approved_by = au.id
    ${whereClause}
    ORDER BY bm.requested_at DESC
  `;
  
  db.query(sql, params, (err, result) => {
    if (err) {
      console.error('Error fetching bracelet requests:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    res.json({ success: true, requests: result.rows || [] });
  });
});

// Approve a bracelet membership request
router.post('/bracelet-requests/:id/approve', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  const adminId = req.session?.admin?.id || req.session?.adminId;
  if (!adminId) {
    return res.status(401).json({ success: false, error: 'Organization authentication required' });
  }
  
  // First, verify the request belongs to this organization and is pending
  db.query(`
    SELECT bm.id, bm.bracelet_uid, bm.organization_id, bm.status
    FROM ct_bracelet_memberships bm
    WHERE bm.id = $1 AND bm.organization_id = $2
  `, [id, req.session.organizationId], (err, result) => {
    if (err) {
      console.error('Error fetching bracelet request:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Bracelet request not found' });
    }
    
    const request = result.rows[0];
    
    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Request has already been processed' });
    }
    
    // Update the membership request to approved
    db.query(`
      UPDATE ct_bracelet_memberships 
      SET status = 'approved', approved_at = NOW(), approved_by = $1
      WHERE id = $2
    `, [adminId, id], (updateErr) => {
      if (updateErr) {
        console.error('Error approving bracelet request:', updateErr);
        return res.status(500).json({ success: false, error: 'Failed to approve request' });
      }
      
      // Update the NFC tag status to 'assigned' 
      db.query(`
        UPDATE ct_nfc_tags 
        SET status = 'assigned', assigned_by = $1, assigned_at = NOW()
        WHERE custom_id = $2
      `, [adminId, request.bracelet_uid], (tagUpdateErr) => {
        if (tagUpdateErr) {
          console.error('Error updating NFC tag status:', tagUpdateErr);
          // Don't fail the approval, just log the error
        }
        
        console.log(`✅ Bracelet request approved: ${request.bracelet_uid} for organization ${req.session.organizationId}`);
        
        res.json({ 
          success: true, 
          message: 'Bracelet request approved successfully'
        });
      });
    });
  });
});

// Deny a bracelet membership request
router.post('/bracelet-requests/:id/deny', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const adminId = req.session?.admin?.id || req.session?.adminId;
  if (!adminId) {
    return res.status(401).json({ success: false, error: 'Organization authentication required' });
  }
  
  // First, verify the request belongs to this organization and is pending
  db.query(`
    SELECT bm.id, bm.bracelet_uid, bm.organization_id, bm.status
    FROM ct_bracelet_memberships bm
    WHERE bm.id = $1 AND bm.organization_id = $2
  `, [id, req.session.organizationId], (err, result) => {
    if (err) {
      console.error('Error fetching bracelet request:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Bracelet request not found' });
    }
    
    const request = result.rows[0];
    
    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Request has already been processed' });
    }
    
    // Update the membership request to denied
    db.query(`
      UPDATE ct_bracelet_memberships 
      SET status = 'denied', approved_at = NOW(), approved_by = $1
      WHERE id = $2
    `, [adminId, id], (updateErr) => {
      if (updateErr) {
        console.error('Error denying bracelet request:', updateErr);
        return res.status(500).json({ success: false, error: 'Failed to deny request' });
      }
      
      // Remove the organization assignment from the NFC tag and reset status
      db.query(`
        UPDATE ct_nfc_tags 
        SET organization_id = NULL, status = 'available', assigned_by = NULL, assigned_at = NULL
        WHERE custom_id = $1
      `, [request.bracelet_uid], (tagUpdateErr) => {
        if (tagUpdateErr) {
          console.error('Error resetting NFC tag:', tagUpdateErr);
          // Don't fail the denial, just log the error
        }
        
        console.log(`❌ Bracelet request denied: ${request.bracelet_uid} for organization ${req.session.organizationId}`);
        
        res.json({ 
          success: true, 
          message: 'Bracelet request denied successfully'
        });
      });
    });
  });
});

// NOTE: CTA admin routes are defined above (text/url/icon/bg_color/text_color/start/end schema),
// which matches the current admin UI (public/js/admin.js) and the public CTA endpoint.

// Generate recurring event instances (useful for maintenance/testing)
router.post('/events/generate-instances', requireOrgAuth, async (req, res) => {
  try {
    const RecurringEventService = require('../services/recurringEventService');
    const generatedCount = await RecurringEventService.generateUpcomingInstances(90);
    res.json({ 
      success: true, 
      message: `Generated ${generatedCount} recurring event instances`,
      generated: generatedCount 
    });
  } catch (err) {
    console.error('Error generating recurring instances:', err);
    res.status(500).json({ success: false, error: 'Failed to generate instances' });
  }
});

// ===========================
// External Calendar Sync (Google ICS) - Admin
// ===========================
router.get('/calendar-integrations/google_ics', requireOrgAuth, async (req, res) => {
  try {
    const orgId = req.session.organizationId;
    const result = await db.query(
      `
      SELECT *
      FROM ct_organization_calendar_integrations
      WHERE organization_id = $1 AND provider = 'google_ics'
      LIMIT 1
      `,
      [orgId]
    );
    res.json({ success: true, integration: result.rows?.[0] || null });
  } catch (e) {
    console.error('Error fetching calendar integration:', e);
    res.status(500).json({ success: false, error: 'Failed to fetch calendar integration' });
  }
});

router.put('/calendar-integrations/google_ics', requireOrgAuth, async (req, res) => {
  try {
    if (!requireSettingsWriteRole(req, res)) return;

    const orgId = req.session.organizationId;
    const inputUrl = (req.body?.input_url || req.body?.ics_url || '').toString().trim();
    const isEnabled = req.body?.is_enabled !== false;
    const syncAhead = parseInt(req.body?.sync_window_days_ahead ?? 180, 10);
    const syncBack = parseInt(req.body?.sync_window_days_back ?? 14, 10);

    if (!inputUrl) return res.status(400).json({ success: false, error: 'input_url is required' });

    const normalizedIcsUrl = CalendarSyncService.normalizeGoogleIcsUrl(inputUrl);
    if (!normalizedIcsUrl) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Google Calendar URL. Paste the iCal (.ics) link or the Google share link.'
      });
    }

    const result = await db.query(
      `
      INSERT INTO ct_organization_calendar_integrations (
        organization_id,
        provider,
        ics_url,
        is_enabled,
        sync_window_days_ahead,
        sync_window_days_back,
        updated_at
      )
      VALUES ($1, 'google_ics', $2, $3, $4, $5, NOW())
      ON CONFLICT (organization_id, provider) DO UPDATE
      SET ics_url = EXCLUDED.ics_url,
          is_enabled = EXCLUDED.is_enabled,
          sync_window_days_ahead = EXCLUDED.sync_window_days_ahead,
          sync_window_days_back = EXCLUDED.sync_window_days_back,
          updated_at = NOW()
      RETURNING *
      `,
      [
        orgId,
        normalizedIcsUrl,
        isEnabled,
        Number.isFinite(syncAhead) && syncAhead > 0 ? syncAhead : 180,
        Number.isFinite(syncBack) && syncBack >= 0 ? syncBack : 14
      ]
    );

    res.json({ success: true, integration: result.rows?.[0] || null });
  } catch (e) {
    console.error('Error saving calendar integration:', e);
    res.status(500).json({ success: false, error: 'Failed to save calendar integration' });
  }
});

router.post('/calendar-integrations/google_ics/sync', requireOrgAuth, async (req, res) => {
  try {
    if (!requireSettingsWriteRole(req, res)) return;
    const orgId = req.session.organizationId;
    const result = await db.query(
      `
      SELECT *
      FROM ct_organization_calendar_integrations
      WHERE organization_id = $1 AND provider = 'google_ics'
      LIMIT 1
      `,
      [orgId]
    );
    const integration = result.rows?.[0];
    if (!integration) return res.status(404).json({ success: false, error: 'No calendar integration configured yet' });

    const out = await CalendarSyncService.syncCalendarIntegration(integration);
    if (out.success === false) return res.status(500).json({ success: false, error: out.error || 'Sync failed' });
    res.json({ success: true, result: out });
  } catch (e) {
    console.error('Error running calendar sync:', e);
    res.status(500).json({ success: false, error: 'Failed to run calendar sync' });
  }
});

// Remove all imported events for this org/integration (useful to reset a sync).
router.post('/calendar-integrations/google_ics/clear', requireOrgAuth, async (req, res) => {
  try {
    if (!requireSettingsWriteRole(req, res)) return;
    const orgId = req.session.organizationId;
    const disable = req.body?.disable === true;

    const result = await db.query(
      `
      SELECT *
      FROM ct_organization_calendar_integrations
      WHERE organization_id = $1 AND provider = 'google_ics'
      LIMIT 1
      `,
      [orgId]
    );
    const integration = result.rows?.[0];
    if (!integration) return res.status(404).json({ success: false, error: 'No calendar integration configured yet' });

    await db.query('BEGIN');
    const deleted = await db.query(
      `
      DELETE FROM ct_events
      WHERE organization_id = $1
        AND external_integration_id = $2
      `,
      [orgId, integration.id]
    );

    const updated = await db.query(
      `
      UPDATE ct_organization_calendar_integrations
      SET last_synced_at = NULL,
          last_sync_status = NULL,
          last_sync_error = NULL,
          last_etag = NULL,
          last_modified = NULL,
          is_enabled = CASE WHEN $2::boolean = TRUE THEN FALSE ELSE is_enabled END,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [integration.id, disable]
    );
    await db.query('COMMIT');

    res.json({
      success: true,
      deleted: deleted.rowCount || 0,
      integration: updated.rows?.[0] || null
    });
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    console.error('Error clearing imported events:', e);
    res.status(500).json({ success: false, error: 'Failed to clear imported events' });
  }
});

module.exports = router;