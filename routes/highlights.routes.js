const express = require('express');
const { db } = require('../config/database');
const { authenticateUser } = require('../middleware/userAuth');
const { requireActiveGroupMembership } = require('../middleware/membershipGate');

const router = express.Router();

const ALLOWED_COLORS = new Set(['yellow', 'amber', 'orange', 'red', 'pink', 'purple', 'blue', 'green']);

// Get highlight for a verse (private to user)
router.get('/verse/:verse_id', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;
    const verseId = Number(req.params.verse_id);

    if (!verseId || Number.isNaN(verseId)) {
      return res.status(400).json({ success: false, error: 'Invalid verse id' });
    }

    const result = await db.query(
      `
      SELECT color_key, created_at, updated_at
      FROM ct_user_verse_highlights
      WHERE user_id = $1 AND organization_id = $2 AND verse_id = $3
      LIMIT 1
      `,
      [userId, orgId, verseId]
    );

    const row = result.rows?.[0] || null;
    return res.json({ success: true, highlight: row ? { verse_id: verseId, color_key: row.color_key } : null });
  } catch (error) {
    console.error('Error getting highlight:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Set or clear highlight for a verse (private to user)
// body: { color_key: 'yellow' } or { color_key: null } to clear
router.put('/verse/:verse_id', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;
    const verseId = Number(req.params.verse_id);
    const colorKeyRaw = req.body?.color_key;
    const colorKey = colorKeyRaw === null || colorKeyRaw === undefined ? null : String(colorKeyRaw).trim().toLowerCase();

    if (!verseId || Number.isNaN(verseId)) {
      return res.status(400).json({ success: false, error: 'Invalid verse id' });
    }

    // Ensure verse belongs to this org
    const verseCheck = await db.query(
      `SELECT id FROM ct_verses WHERE id = $1 AND organization_id = $2`,
      [verseId, orgId]
    );
    if ((verseCheck.rows || []).length === 0) {
      return res.status(404).json({ success: false, error: 'Verse not found for this group' });
    }

    if (!colorKey) {
      await db.query(
        `DELETE FROM ct_user_verse_highlights WHERE user_id = $1 AND organization_id = $2 AND verse_id = $3`,
        [userId, orgId, verseId]
      );
      return res.json({ success: true, highlight: null });
    }

    if (!ALLOWED_COLORS.has(colorKey)) {
      return res.status(400).json({ success: false, error: 'Invalid color_key' });
    }

    const result = await db.query(
      `
      INSERT INTO ct_user_verse_highlights (user_id, organization_id, verse_id, color_key, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (user_id, organization_id, verse_id)
      DO UPDATE SET color_key = EXCLUDED.color_key, updated_at = NOW()
      RETURNING color_key
      `,
      [userId, orgId, verseId, colorKey]
    );

    return res.json({ success: true, highlight: { verse_id: verseId, color_key: result.rows?.[0]?.color_key || colorKey } });
  } catch (error) {
    console.error('Error setting highlight:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

module.exports = router;

