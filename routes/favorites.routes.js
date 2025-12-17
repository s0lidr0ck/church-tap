const express = require('express');
const { db } = require('../config/database');
const { authenticateUser } = require('../middleware/userAuth');
const { requireActiveGroupMembership } = require('../middleware/membershipGate');

const router = express.Router();

// List favorites (includes verse data)
router.get('/', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;

    const result = await db.query(
      `
      SELECT
        v.id,
        v.date,
        v.content_type,
        v.verse_text,
        v.image_path,
        v.bible_reference,
        v.context,
        v.tags,
        uf.created_at AS favorited_at
      FROM ct_user_favorites uf
      JOIN ct_verses v
        ON v.id = uf.verse_id
       AND v.organization_id = uf.organization_id
      WHERE uf.user_id = $1
        AND uf.organization_id = $2
      ORDER BY uf.created_at DESC
      `,
      [userId, orgId]
    );

    return res.json({ success: true, favorites: result.rows || [] });
  } catch (error) {
    console.error('Error listing favorites:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Toggle favorite
router.post('/toggle', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;
    const verseId = Number(req.body?.verse_id);

    if (!verseId || Number.isNaN(verseId)) {
      return res.status(400).json({ success: false, error: 'verse_id is required' });
    }

    // Ensure the verse belongs to the active org
    const verseCheck = await db.query(
      `SELECT id FROM ct_verses WHERE id = $1 AND organization_id = $2`,
      [verseId, orgId]
    );
    if ((verseCheck.rows || []).length === 0) {
      return res.status(404).json({ success: false, error: 'Verse not found for this group' });
    }

    const exists = await db.query(
      `SELECT id FROM ct_user_favorites WHERE user_id = $1 AND organization_id = $2 AND verse_id = $3`,
      [userId, orgId, verseId]
    );

    if ((exists.rows || []).length > 0) {
      await db.query(
        `DELETE FROM ct_user_favorites WHERE user_id = $1 AND organization_id = $2 AND verse_id = $3`,
        [userId, orgId, verseId]
      );
      return res.json({ success: true, favorited: false });
    }

    await db.query(
      `INSERT INTO ct_user_favorites (user_id, organization_id, verse_id) VALUES ($1, $2, $3)`,
      [userId, orgId, verseId]
    );

    return res.json({ success: true, favorited: true });
  } catch (error) {
    console.error('Error toggling favorite:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Bulk import favorites (used to migrate localStorage favorites after login)
router.post('/import', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;
    const verseIds = Array.isArray(req.body?.verse_ids) ? req.body.verse_ids : [];

    const normalized = verseIds
      .map(v => Number(v))
      .filter(v => v && !Number.isNaN(v));

    if (normalized.length === 0) {
      return res.json({ success: true, imported: 0 });
    }

    // Only import verses that belong to the active org
    const allowed = await db.query(
      `SELECT id FROM ct_verses WHERE organization_id = $1 AND id = ANY($2::int[])`,
      [orgId, normalized]
    );

    const allowedIds = (allowed.rows || []).map(r => Number(r.id)).filter(Boolean);
    if (allowedIds.length === 0) {
      return res.json({ success: true, imported: 0 });
    }

    const valuesSql = allowedIds
      .map((_, idx) => `($1, $2, $${idx + 3})`)
      .join(',');

    const params = [userId, orgId, ...allowedIds];

    // Insert and ignore duplicates
    const insertSql = `
      INSERT INTO ct_user_favorites (user_id, organization_id, verse_id)
      VALUES ${valuesSql}
      ON CONFLICT (user_id, verse_id, organization_id) DO NOTHING
    `;

    const result = await db.query(insertSql, params);

    return res.json({ success: true, imported: result.rowCount || 0 });
  } catch (error) {
    console.error('Error importing favorites:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

module.exports = router;
