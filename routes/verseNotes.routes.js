const express = require('express');
const { db } = require('../config/database');
const { authenticateUser } = require('../middleware/userAuth');
const { requireActiveGroupMembership } = require('../middleware/membershipGate');

const router = express.Router();

function clampNoteTitle(value) {
  const t = String(value ?? '').trim();
  if (!t) return null;
  return t.length > 120 ? t.slice(0, 120) : t;
}

function normalizeMarkdown(value) {
  const md = String(value ?? '').replace(/\r\n/g, '\n').trim();
  return md;
}

// List notes for a verse (private to user)
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
      SELECT id, verse_id, title, body_markdown, created_at, updated_at
      FROM ct_user_verse_notes
      WHERE user_id = $1 AND organization_id = $2 AND verse_id = $3
      ORDER BY created_at DESC
      `,
      [userId, orgId, verseId]
    );

    return res.json({ success: true, notes: result.rows || [] });
  } catch (error) {
    console.error('Error listing verse notes:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Create a note for a verse (private to user)
router.post('/verse/:verse_id', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;
    const verseId = Number(req.params.verse_id);
    const title = clampNoteTitle(req.body?.title);
    const body = normalizeMarkdown(req.body?.body_markdown);

    if (!verseId || Number.isNaN(verseId)) {
      return res.status(400).json({ success: false, error: 'Invalid verse id' });
    }
    if (!body) {
      return res.status(400).json({ success: false, error: 'body_markdown is required' });
    }
    if (body.length > 20000) {
      return res.status(400).json({ success: false, error: 'Note too long (max 20000 characters)' });
    }

    // Ensure verse belongs to this org
    const verseCheck = await db.query(
      `SELECT id FROM ct_verses WHERE id = $1 AND organization_id = $2`,
      [verseId, orgId]
    );
    if ((verseCheck.rows || []).length === 0) {
      return res.status(404).json({ success: false, error: 'Verse not found for this group' });
    }

    const result = await db.query(
      `
      INSERT INTO ct_user_verse_notes (user_id, organization_id, verse_id, title, body_markdown, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING id, verse_id, title, body_markdown, created_at, updated_at
      `,
      [userId, orgId, verseId, title, body]
    );

    return res.json({ success: true, note: result.rows[0] });
  } catch (error) {
    console.error('Error creating verse note:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Update a note (private to user)
router.put('/:id', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;
    const noteId = Number(req.params.id);
    const title = clampNoteTitle(req.body?.title);
    const bodyRaw = req.body?.body_markdown;
    const body = bodyRaw === undefined ? undefined : normalizeMarkdown(bodyRaw);

    if (!noteId || Number.isNaN(noteId)) {
      return res.status(400).json({ success: false, error: 'Invalid id' });
    }

    if (body !== undefined) {
      if (!body) {
        return res.status(400).json({ success: false, error: 'body_markdown cannot be empty' });
      }
      if (body.length > 20000) {
        return res.status(400).json({ success: false, error: 'Note too long (max 20000 characters)' });
      }
    }

    // Update only fields provided; keep it simple.
    const nextTitle = title; // explicit (null allowed)
    const nextBody = body !== undefined ? body : null;

    const sql = body !== undefined
      ? `
        UPDATE ct_user_verse_notes
        SET title = $1,
            body_markdown = $2,
            updated_at = NOW()
        WHERE id = $3 AND user_id = $4 AND organization_id = $5
        RETURNING id, verse_id, title, body_markdown, created_at, updated_at
      `
      : `
        UPDATE ct_user_verse_notes
        SET title = $1,
            updated_at = NOW()
        WHERE id = $2 AND user_id = $3 AND organization_id = $4
        RETURNING id, verse_id, title, body_markdown, created_at, updated_at
      `;

    const params = body !== undefined
      ? [nextTitle, nextBody, noteId, userId, orgId]
      : [nextTitle, noteId, userId, orgId];

    const result = await db.query(sql, params);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Note not found' });
    }

    return res.json({ success: true, note: result.rows[0] });
  } catch (error) {
    console.error('Error updating verse note:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Delete a note (private to user)
router.delete('/:id', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;
    const noteId = Number(req.params.id);

    if (!noteId || Number.isNaN(noteId)) {
      return res.status(400).json({ success: false, error: 'Invalid id' });
    }

    const result = await db.query(
      `DELETE FROM ct_user_verse_notes WHERE id = $1 AND user_id = $2 AND organization_id = $3`,
      [noteId, userId, orgId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Note not found' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting verse note:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

module.exports = router;

