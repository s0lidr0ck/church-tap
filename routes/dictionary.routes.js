const express = require('express');
const { db } = require('../config/database');
const { requireOrgFeature } = require('../middleware/featureGate');

const router = express.Router();

router.get('/sources', requireOrgFeature('verseCommentary'), async (req, res) => {
  try {
    const result = await db.query(
      `
      SELECT source_key, title, abbreviation, is_strongs
      FROM ct_dictionary_sources
      ORDER BY COALESCE(title, source_key) ASC
      `
    );
    return res.json({ success: true, sources: result.rows || [] });
  } catch (e) {
    console.error('Dictionary sources error:', e);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Dictionary lookup (Study Mode UI). Returns the best match from available sources.
// For now, we gate this behind the same org flag as verse commentary (study tools).
router.get('/lookup', requireOrgFeature('verseCommentary'), async (req, res) => {
  const term = String(req.query.term || '').trim();
  const sourceKey = String(req.query.source || req.query.source_key || '').trim();
  if (!term) {
    return res.status(400).json({ success: false, error: 'Missing term' });
  }

  try {
    // Prefer exact matches (case-insensitive), then prefix matches.
    const exactParams = sourceKey ? [term, sourceKey] : [term];
    const exactSql = sourceKey
      ? `
      SELECT e.word, e.content, s.title AS source_title, s.source_key
      FROM ct_dictionary_entries e
      JOIN ct_dictionary_sources s ON s.id = e.source_id
      WHERE LOWER(e.word) = LOWER($1) AND s.source_key = $2
      ORDER BY COALESCE(e.relative_order, 0) ASC, e.id ASC
      LIMIT 1
      `
      : `
      SELECT e.word, e.content, s.title AS source_title, s.source_key
      FROM ct_dictionary_entries e
      JOIN ct_dictionary_sources s ON s.id = e.source_id
      WHERE LOWER(e.word) = LOWER($1)
      ORDER BY s.id ASC, COALESCE(e.relative_order, 0) ASC, e.id ASC
      LIMIT 1
      `;
    const exact = await db.query(
      exactSql,
      exactParams
    );

    if (exact.rows && exact.rows.length > 0) {
      const row = exact.rows[0];
      return res.json({
        success: true,
        entry: {
          headword: row.word,
          definition: row.content,
          source_key: row.source_key,
          source_name: row.source_title || row.source_key
        }
      });
    }

    const prefixParams = sourceKey ? [`${term}%`, sourceKey] : [`${term}%`];
    const prefixSql = sourceKey
      ? `
      SELECT e.word, e.content, s.title AS source_title, s.source_key
      FROM ct_dictionary_entries e
      JOIN ct_dictionary_sources s ON s.id = e.source_id
      WHERE e.word ILIKE $1 AND s.source_key = $2
      ORDER BY LENGTH(e.word) ASC, COALESCE(e.relative_order, 0) ASC, e.id ASC
      LIMIT 1
      `
      : `
      SELECT e.word, e.content, s.title AS source_title, s.source_key
      FROM ct_dictionary_entries e
      JOIN ct_dictionary_sources s ON s.id = e.source_id
      WHERE e.word ILIKE $1
      ORDER BY s.id ASC, LENGTH(e.word) ASC, COALESCE(e.relative_order, 0) ASC, e.id ASC
      LIMIT 1
      `;
    const prefix = await db.query(
      prefixSql,
      prefixParams
    );

    if (prefix.rows && prefix.rows.length > 0) {
      const row = prefix.rows[0];
      return res.json({
        success: true,
        entry: {
          headword: row.word,
          definition: row.content,
          source_key: row.source_key,
          source_name: row.source_title || row.source_key
        }
      });
    }

    return res.json({ success: true, entry: null });
  } catch (e) {
    console.error('Dictionary lookup error:', e);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

module.exports = router;

