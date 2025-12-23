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

function parseRefParams(req) {
  const book = Number(req.params.book);
  const chapter = Number(req.params.chapter);
  const verse = Number(req.params.verse);
  if (!book || Number.isNaN(book) || !chapter || Number.isNaN(chapter) || !verse || Number.isNaN(verse)) return null;
  return { book, chapter, verse };
}

// List notes for a scripture verse (private to user)
router.get('/:book/:chapter/:verse', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const ref = parseRefParams(req);
    if (!ref) return res.status(400).json({ success: false, error: 'Invalid reference' });

    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;

    const result = await db.query(
      `
      SELECT id, title, body_markdown, created_at, updated_at
      FROM ct_user_scripture_notes
      WHERE user_id = $1 AND organization_id = $2
        AND book = $3 AND chapter = $4 AND verse = $5
      ORDER BY created_at DESC
      `,
      [userId, orgId, ref.book, ref.chapter, ref.verse]
    );

    return res.json({ success: true, ref, notes: result.rows || [] });
  } catch (error) {
    console.error('Error listing scripture notes:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Create a note for a scripture verse (private to user)
router.post('/:book/:chapter/:verse', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const ref = parseRefParams(req);
    if (!ref) return res.status(400).json({ success: false, error: 'Invalid reference' });

    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;
    const title = clampNoteTitle(req.body?.title);
    const body = normalizeMarkdown(req.body?.body_markdown);

    if (!body) return res.status(400).json({ success: false, error: 'body_markdown is required' });
    if (body.length > 20000) return res.status(400).json({ success: false, error: 'Note too long (max 20000 characters)' });

    const result = await db.query(
      `
      INSERT INTO ct_user_scripture_notes (user_id, organization_id, book, chapter, verse, title, body_markdown, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING id, title, body_markdown, created_at, updated_at
      `,
      [userId, orgId, ref.book, ref.chapter, ref.verse, title, body]
    );

    return res.json({ success: true, ref, note: result.rows[0] });
  } catch (error) {
    console.error('Error creating scripture note:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Update a note (private to user)
router.put('/:id', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;
    const noteId = Number(req.params.id);
    if (!noteId || Number.isNaN(noteId)) return res.status(400).json({ success: false, error: 'Invalid id' });

    const title = clampNoteTitle(req.body?.title);
    const bodyRaw = req.body?.body_markdown;
    const body = bodyRaw === undefined ? undefined : normalizeMarkdown(bodyRaw);

    if (body !== undefined) {
      if (!body) return res.status(400).json({ success: false, error: 'body_markdown cannot be empty' });
      if (body.length > 20000) return res.status(400).json({ success: false, error: 'Note too long (max 20000 characters)' });
    }

    const sql = body !== undefined
      ? `
        UPDATE ct_user_scripture_notes
        SET title = $1,
            body_markdown = $2,
            updated_at = NOW()
        WHERE id = $3 AND user_id = $4 AND organization_id = $5
        RETURNING id, book, chapter, verse, title, body_markdown, created_at, updated_at
      `
      : `
        UPDATE ct_user_scripture_notes
        SET title = $1,
            updated_at = NOW()
        WHERE id = $2 AND user_id = $3 AND organization_id = $4
        RETURNING id, book, chapter, verse, title, body_markdown, created_at, updated_at
      `;

    const params = body !== undefined
      ? [title, body, noteId, userId, orgId]
      : [title, noteId, userId, orgId];

    const result = await db.query(sql, params);
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Note not found' });

    return res.json({ success: true, note: result.rows[0] });
  } catch (error) {
    console.error('Error updating scripture note:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Delete a note (private to user)
router.delete('/:id', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;
    const noteId = Number(req.params.id);
    if (!noteId || Number.isNaN(noteId)) return res.status(400).json({ success: false, error: 'Invalid id' });

    const result = await db.query(
      `DELETE FROM ct_user_scripture_notes WHERE id = $1 AND user_id = $2 AND organization_id = $3`,
      [noteId, userId, orgId]
    );
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Note not found' });

    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting scripture note:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

module.exports = router;

