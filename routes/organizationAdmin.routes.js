const express = require('express');
const { dbQuery } = require('../config/database');
const { db } = require('../config/database');
const { requireOrgAuth } = require('../config/middleware');
const RecurringEventService = require('../services/recurringEventService');
const { getOrganizationFeatures, updateOrganizationFeatures, getTranslationCatalog } = require('../services/organizationFeaturesService');
const { parseVerseReference } = require('../services/bibleReferenceParser');

const router = express.Router();

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
    const query = hasRecurringColumns ? `
      SELECT id, title, description, location, address, start_at, end_at, all_day, link, is_active, notify_lead_minutes,
             is_recurring, recurrence_type, recurrence_interval, recurrence_days, recurrence_end_date,
             parent_event_id, instance_date, is_instance
      FROM CT_events
      WHERE organization_id = $1
      ORDER BY start_at DESC
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
      RETURNING id
    ` : `
      INSERT INTO CT_events (
        organization_id, title, description, location, address, start_at, end_at, all_day, link, is_active, notify_lead_minutes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id
    `;

    const params = hasRecurringColumns ? [
      req.session.organizationId, title, description || null, location || null, address || null,
      start_at, end_at || null, !!all_day, link || null, is_active !== false, notify_lead_minutes || 120,
      !!is_recurring, recurrence_type || null, recurrence_interval || 1,
      recurrence_days ? JSON.stringify(recurrence_days) : null, recurrence_end_date || null
    ] : [
      req.session.organizationId, title, description || null, location || null, address || null,
      start_at, end_at || null, !!all_day, link || null, is_active !== false, notify_lead_minutes || 120
    ];

    const result = await db.query(query, params);

    const eventId = result.rows[0].id;

    // If it's a recurring event and recurring columns exist, generate instances
    if (hasRecurringColumns && is_recurring) {
      const event = {
        id: eventId,
        ...req.body,
        organization_id: req.session.organizationId,
        is_recurring: true
      };
      await RecurringEventService.generateInstancesForEvent(event, new Date(Date.now() + 90 * 24 * 60 * 60 * 1000));
    }

    res.json({ success: true, id: eventId });
  } catch (err) {
    console.error('Error creating event:', err);
    return res.status(500).json({ success: false, error: 'Failed to create event' });
  }
});

router.put('/events/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  const { title, description, location, address, start_at, end_at, all_day, link, is_active, notify_lead_minutes } = req.body || {};
  if (!title || !start_at) {
    return res.status(400).json({ success: false, error: 'Title and start_at are required' });
  }
  db.query(`
    UPDATE CT_events
    SET title = $1, description = $2, location = $3, address = $4, start_at = $5, end_at = $6, all_day = $7, link = $8, is_active = $9, notify_lead_minutes = $10
    WHERE id = $11 AND organization_id = $12
  `, [title, description || null, location || null, address || null, start_at, end_at || null, !!all_day, link || null, is_active !== false, notify_lead_minutes || 120, id, req.session.organizationId], (err, result) => {
    if (err) {
      console.error('Error updating event:', err);
      return res.status(500).json({ success: false, error: 'Failed to update event' });
    }
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Event not found' });
    res.json({ success: true });
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
  const adminId = req.user?.id; // Get admin ID from session
  
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
  const adminId = req.user?.id; // Get admin ID from session
  
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

// Get organization CTAs (Call to Actions)
router.get('/ctas', requireOrgAuth, (req, res) => {
  dbQuery.all(`
    SELECT * FROM ct_organization_cta 
    WHERE organization_id = $1 AND is_active = true
    ORDER BY sort_order ASC, created_at DESC
  `, [req.session.organizationId], (err, rows) => {
    if (err) {
      console.error('Error fetching CTAs:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch CTAs' });
    }
    
    res.json({ success: true, ctas: rows || [] });
  });
});

// Create CTA
router.post('/ctas', requireOrgAuth, (req, res) => {
  const { title, description, url, button_text, sort_order, is_active } = req.body;
  const organizationId = req.session.organizationId;
  
  dbQuery.run(`
    INSERT INTO ct_organization_cta (organization_id, title, description, url, button_text, sort_order, is_active, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
  `, [organizationId, title, description, url, button_text, sort_order || 0, is_active !== false], function(err) {
    if (err) {
      console.error('Error creating CTA:', err);
      return res.status(500).json({ success: false, error: 'Failed to create CTA' });
    }
    
    res.json({ success: true, cta_id: this.lastID });
  });
});

// Update CTA
router.put('/ctas/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  const { title, description, url, button_text, sort_order, is_active } = req.body;
  const organizationId = req.session.organizationId;
  
  dbQuery.run(`
    UPDATE ct_organization_cta 
    SET title = $1, description = $2, url = $3, button_text = $4, sort_order = $5, is_active = $6, updated_at = NOW()
    WHERE id = $7 AND organization_id = $8
  `, [title, description, url, button_text, sort_order, is_active, id, organizationId], function(err) {
    if (err) {
      console.error('Error updating CTA:', err);
      return res.status(500).json({ success: false, error: 'Failed to update CTA' });
    }
    
    res.json({ success: true });
  });
});

// Delete CTA
router.delete('/ctas/:id', requireOrgAuth, (req, res) => {
  const { id } = req.params;
  const organizationId = req.session.organizationId;
  
  dbQuery.run(`
    DELETE FROM ct_organization_cta 
    WHERE id = $1 AND organization_id = $2
  `, [id, organizationId], function(err) {
    if (err) {
      console.error('Error deleting CTA:', err);
      return res.status(500).json({ success: false, error: 'Failed to delete CTA' });
    }
    
    res.json({ success: true });
  });
});

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

module.exports = router;