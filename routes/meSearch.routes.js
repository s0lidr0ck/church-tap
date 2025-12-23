const express = require('express');
const { db } = require('../config/database');
const { authenticateUser } = require('../middleware/userAuth');
const { requireActiveGroupMembership } = require('../middleware/membershipGate');

const router = express.Router();

function makeSnippet(text, maxLen = 180) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
}

// Search "my stuff" (private user-generated content)
// Returns mixed results across notes, collections, personal prayers.
router.get('/search', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;
    const q = String(req.query.q || '').trim();
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 25));

    if (!q || q.length < 2) {
      return res.status(400).json({ success: false, error: 'Search query must be at least 2 characters' });
    }

    const term = `%${q}%`;

    // Notes: search title/body and also allow matching bible_reference by joining ct_verses.
    const notes = await db.query(
      `
      SELECT
        n.id,
        n.verse_id,
        COALESCE(n.title, v.bible_reference, 'Note') AS title,
        n.body_markdown AS body,
        v.bible_reference,
        n.created_at
      FROM ct_user_verse_notes n
      JOIN ct_verses v
        ON v.id = n.verse_id
       AND v.organization_id = n.organization_id
      WHERE n.user_id = $1
        AND n.organization_id = $2
        AND (
          n.title ILIKE $3 OR
          n.body_markdown ILIKE $3 OR
          v.bible_reference ILIKE $3
        )
      ORDER BY n.created_at DESC
      LIMIT $4
      `,
      [userId, orgId, term, limit]
    );

    const collections = await db.query(
      `
      SELECT id, name, description, created_at
      FROM ct_user_collections
      WHERE user_id = $1
        AND organization_id = $2
        AND (
          name ILIKE $3 OR
          COALESCE(description, '') ILIKE $3
        )
      ORDER BY created_at DESC
      LIMIT $4
      `,
      [userId, orgId, term, limit]
    );

    const prayers = await db.query(
      `
      SELECT id, content, is_answered, created_at
      FROM ct_personal_prayer_requests
      WHERE user_id = $1
        AND organization_id = $2
        AND content ILIKE $3
      ORDER BY created_at DESC
      LIMIT $4
      `,
      [userId, orgId, term, limit]
    );

    const results = [];

    for (const r of notes.rows || []) {
      results.push({
        type: 'note',
        id: Number(r.id),
        verse_id: Number(r.verse_id),
        bible_reference: r.bible_reference || null,
        title: r.title || 'Note',
        snippet: makeSnippet(r.body),
        created_at: r.created_at
      });
    }

    for (const r of collections.rows || []) {
      results.push({
        type: 'collection',
        id: Number(r.id),
        title: r.name || 'Collection',
        snippet: makeSnippet(r.description || ''),
        created_at: r.created_at
      });
    }

    for (const r of prayers.rows || []) {
      results.push({
        type: 'prayer',
        id: Number(r.id),
        title: r.is_answered ? 'Prayer (answered)' : 'Prayer',
        snippet: makeSnippet(r.content || ''),
        created_at: r.created_at
      });
    }

    // Sort newest-first across types
    results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return res.json({ success: true, query: q, results });
  } catch (error) {
    console.error('Me search error:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

// List all of "my notes" (private)
router.get('/notes', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 500));

    const verseNotes = await db.query(
      `
      SELECT
        n.id,
        n.verse_id,
        n.title,
        n.body_markdown,
        n.created_at,
        n.updated_at,
        v.bible_reference,
        v.date
      FROM ct_user_verse_notes n
      JOIN ct_verses v
        ON v.id = n.verse_id
       AND v.organization_id = n.organization_id
      WHERE n.user_id = $1 AND n.organization_id = $2
      ORDER BY COALESCE(n.updated_at, n.created_at) DESC
      LIMIT $3
      `,
      [userId, orgId, limit]
    );

    const scriptureNotes = await db.query(
      `
      SELECT
        id,
        book,
        chapter,
        verse,
        title,
        body_markdown,
        created_at,
        updated_at
      FROM ct_user_scripture_notes
      WHERE user_id = $1 AND organization_id = $2
      ORDER BY COALESCE(updated_at, created_at) DESC
      LIMIT $3
      `,
      [userId, orgId, limit]
    );

    const notes = [];
    for (const r of verseNotes.rows || []) {
      notes.push({
        kind: 'daily',
        id: Number(r.id),
        verse_id: Number(r.verse_id),
        bible_reference: r.bible_reference || null,
        verse_date: r.date || null,
        title: r.title || null,
        body_markdown: r.body_markdown || '',
        created_at: r.created_at,
        updated_at: r.updated_at
      });
    }
    for (const r of scriptureNotes.rows || []) {
      notes.push({
        kind: 'scripture',
        id: Number(r.id),
        book: Number(r.book),
        chapter: Number(r.chapter),
        verse: Number(r.verse),
        title: r.title || null,
        body_markdown: r.body_markdown || '',
        created_at: r.created_at,
        updated_at: r.updated_at
      });
    }

    notes.sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime());
    return res.json({ success: true, notes });
  } catch (error) {
    console.error('Me notes error:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

// List all of "my highlights" (private)
router.get('/highlights', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 500));

    const verseHighlights = await db.query(
      `
      SELECT
        h.verse_id,
        h.color_key,
        h.created_at,
        h.updated_at,
        v.bible_reference,
        v.date
      FROM ct_user_verse_highlights h
      JOIN ct_verses v
        ON v.id = h.verse_id
       AND v.organization_id = h.organization_id
      WHERE h.user_id = $1 AND h.organization_id = $2
      ORDER BY COALESCE(h.updated_at, h.created_at) DESC
      LIMIT $3
      `,
      [userId, orgId, limit]
    );

    const scriptureHighlights = await db.query(
      `
      SELECT
        book,
        chapter,
        verse,
        color_key,
        created_at,
        updated_at
      FROM ct_user_scripture_highlights
      WHERE user_id = $1 AND organization_id = $2
      ORDER BY COALESCE(updated_at, created_at) DESC
      LIMIT $3
      `,
      [userId, orgId, limit]
    );

    const highlights = [];
    for (const r of verseHighlights.rows || []) {
      highlights.push({
        kind: 'daily',
        verse_id: Number(r.verse_id),
        bible_reference: r.bible_reference || null,
        verse_date: r.date || null,
        color_key: r.color_key,
        created_at: r.created_at,
        updated_at: r.updated_at
      });
    }
    for (const r of scriptureHighlights.rows || []) {
      highlights.push({
        kind: 'scripture',
        book: Number(r.book),
        chapter: Number(r.chapter),
        verse: Number(r.verse),
        color_key: r.color_key,
        created_at: r.created_at,
        updated_at: r.updated_at
      });
    }

    highlights.sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime());
    return res.json({ success: true, highlights });
  } catch (error) {
    console.error('Me highlights error:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

module.exports = router;

