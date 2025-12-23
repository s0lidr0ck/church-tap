const express = require('express');
const { db } = require('../config/database');
const { authenticateUser } = require('../middleware/userAuth');
const { requireActiveGroupMembership } = require('../middleware/membershipGate');

const router = express.Router();

const ALLOWED_COLORS = new Set(['yellow', 'amber', 'orange', 'red', 'pink', 'purple', 'blue', 'green']);

function parseRefParams(req) {
  const book = Number(req.params.book);
  const chapter = Number(req.params.chapter);
  const verse = Number(req.params.verse);
  if (!book || Number.isNaN(book) || !chapter || Number.isNaN(chapter) || !verse || Number.isNaN(verse)) return null;
  return { book, chapter, verse };
}

// List all highlights for a chapter (private to user)
router.get('/:book/:chapter', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const book = Number(req.params.book);
    const chapter = Number(req.params.chapter);
    if (!book || Number.isNaN(book) || !chapter || Number.isNaN(chapter)) {
      return res.status(400).json({ success: false, error: 'Invalid reference' });
    }

    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;

    const result = await db.query(
      `
      SELECT verse, color_key
      FROM ct_user_scripture_highlights
      WHERE user_id = $1 AND organization_id = $2
        AND book = $3 AND chapter = $4
      ORDER BY verse ASC
      `,
      [userId, orgId, book, chapter]
    );

    return res.json({
      success: true,
      ref: { book, chapter },
      highlights: (result.rows || []).map(r => ({
        verse: Number(r.verse),
        color_key: r.color_key
      }))
    });
  } catch (error) {
    console.error('Error listing scripture highlights:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Get highlight for a scripture verse (private to user)
router.get('/:book/:chapter/:verse', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const ref = parseRefParams(req);
    if (!ref) return res.status(400).json({ success: false, error: 'Invalid reference' });

    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;

    const result = await db.query(
      `
      SELECT color_key
      FROM ct_user_scripture_highlights
      WHERE user_id = $1 AND organization_id = $2
        AND book = $3 AND chapter = $4 AND verse = $5
      LIMIT 1
      `,
      [userId, orgId, ref.book, ref.chapter, ref.verse]
    );

    const row = result.rows?.[0] || null;
    return res.json({ success: true, highlight: row ? { ...ref, color_key: row.color_key } : null });
  } catch (error) {
    console.error('Error getting scripture highlight:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Set or clear highlight for a scripture verse (private to user)
// body: { color_key: 'yellow' } or { color_key: null } to clear
router.put('/:book/:chapter/:verse', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const ref = parseRefParams(req);
    if (!ref) return res.status(400).json({ success: false, error: 'Invalid reference' });

    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;
    const colorKeyRaw = req.body?.color_key;
    const colorKey = colorKeyRaw === null || colorKeyRaw === undefined ? null : String(colorKeyRaw).trim().toLowerCase();

    if (!colorKey) {
      await db.query(
        `
        DELETE FROM ct_user_scripture_highlights
        WHERE user_id = $1 AND organization_id = $2
          AND book = $3 AND chapter = $4 AND verse = $5
        `,
        [userId, orgId, ref.book, ref.chapter, ref.verse]
      );
      return res.json({ success: true, highlight: null });
    }

    if (!ALLOWED_COLORS.has(colorKey)) {
      return res.status(400).json({ success: false, error: 'Invalid color_key' });
    }

    const result = await db.query(
      `
      INSERT INTO ct_user_scripture_highlights (user_id, organization_id, book, chapter, verse, color_key, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      ON CONFLICT (user_id, organization_id, book, chapter, verse)
      DO UPDATE SET color_key = EXCLUDED.color_key, updated_at = NOW()
      RETURNING color_key
      `,
      [userId, orgId, ref.book, ref.chapter, ref.verse, colorKey]
    );

    return res.json({ success: true, highlight: { ...ref, color_key: result.rows?.[0]?.color_key || colorKey } });
  } catch (error) {
    console.error('Error setting scripture highlight:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

module.exports = router;

