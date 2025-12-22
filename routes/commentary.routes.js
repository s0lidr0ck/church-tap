const express = require('express');
const { db } = require('../config/database');
const { requireOrgFeature } = require('../middleware/featureGate');

const router = express.Router();

router.get('/sources', requireOrgFeature('verseCommentary'), async (req, res) => {
  try {
    const result = await db.query(
      `
      SELECT source_key, title, abbreviation
      FROM ct_commentary_sources
      ORDER BY COALESCE(title, source_key) ASC
      `
    );
    return res.json({ success: true, sources: result.rows || [] });
  } catch (e) {
    console.error('Commentary sources error:', e);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

function parseBibleReference(ref) {
  // Accepts references like "John 3:16", "1 Corinthians 13:4-8"
  // Returns { bookName, chapter, verse } or null.
  const s = String(ref || '').trim();
  if (!s) return null;
  const m = s.match(/^(.+?)\s+(\d+):(\d+)(?:-\d+)?$/i);
  if (!m) return null;
  return {
    bookName: m[1].toLowerCase().replace(/\s+/g, ' ').trim(),
    chapter: parseInt(m[2], 10),
    verse: parseInt(m[3], 10)
  };
}

function bookNameToNumber(bookName) {
  // Minimal map matching the client’s reference parser.
  const map = {
    'genesis': 1, 'gen': 1,
    'exodus': 2, 'exo': 2, 'exod': 2,
    'leviticus': 3, 'lev': 3,
    'numbers': 4, 'num': 4,
    'deuteronomy': 5, 'deut': 5, 'deu': 5,
    'joshua': 6, 'josh': 6, 'jos': 6,
    'judges': 7, 'judg': 7, 'jdg': 7,
    'ruth': 8, 'rut': 8,
    '1 samuel': 9, '1samuel': 9, '1sam': 9, '1sa': 9,
    '2 samuel': 10, '2samuel': 10, '2sam': 10, '2sa': 10,
    '1 kings': 11, '1kings': 11, '1kgs': 11, '1ki': 11,
    '2 kings': 12, '2kings': 12, '2kgs': 12, '2ki': 12,
    '1 chronicles': 13, '1chronicles': 13, '1chron': 13, '1chr': 13, '1ch': 13,
    '2 chronicles': 14, '2chronicles': 14, '2chron': 14, '2chr': 14, '2ch': 14,
    'ezra': 15, 'ezr': 15,
    'nehemiah': 16, 'neh': 16,
    'esther': 17, 'est': 17,
    'job': 18,
    'psalm': 19, 'psalms': 19, 'psa': 19, 'ps': 19,
    'proverbs': 20, 'prov': 20, 'pro': 20,
    'ecclesiastes': 21, 'eccl': 21, 'ecc': 21,
    'song of solomon': 22, 'song': 22, 'sos': 22,
    'isaiah': 23, 'isa': 23,
    'jeremiah': 24, 'jer': 24,
    'lamentations': 25, 'lam': 25,
    'ezekiel': 26, 'ezek': 26, 'eze': 26,
    'daniel': 27, 'dan': 27,
    'hosea': 28, 'hos': 28,
    'joel': 29, 'joe': 29,
    'amos': 30, 'amo': 30,
    'obadiah': 31, 'obad': 31, 'oba': 31,
    'jonah': 32, 'jon': 32,
    'micah': 33, 'mic': 33,
    'nahum': 34, 'nah': 34,
    'habakkuk': 35, 'hab': 35,
    'zephaniah': 36, 'zeph': 36, 'zep': 36,
    'haggai': 37, 'hag': 37,
    'zechariah': 38, 'zech': 38, 'zec': 38,
    'malachi': 39, 'mal': 39,
    'matthew': 40, 'matt': 40, 'mat': 40,
    'mark': 41, 'mar': 41,
    'luke': 42, 'luk': 42,
    'john': 43, 'joh': 43,
    'acts': 44, 'act': 44,
    'romans': 45, 'rom': 45,
    '1 corinthians': 46, '1corinthians': 46, '1cor': 46, '1co': 46,
    '2 corinthians': 47, '2corinthians': 47, '2cor': 47, '2co': 47,
    'galatians': 48, 'gal': 48,
    'ephesians': 49, 'eph': 49,
    'philippians': 50, 'phil': 50, 'php': 50,
    'colossians': 51, 'col': 51,
    '1 thessalonians': 52, '1thessalonians': 52, '1thess': 52, '1th': 52,
    '2 thessalonians': 53, '2thessalonians': 53, '2thess': 53, '2th': 53,
    '1 timothy': 54, '1timothy': 54, '1tim': 54, '1ti': 54,
    '2 timothy': 55, '2timothy': 55, '2tim': 55, '2ti': 55,
    'titus': 56, 'tit': 56,
    'philemon': 57, 'phlm': 57, 'phm': 57,
    'hebrews': 58, 'heb': 58,
    'james': 59, 'jas': 59,
    '1 peter': 60, '1peter': 60, '1pet': 60, '1pe': 60,
    '2 peter': 61, '2peter': 61, '2pet': 61, '2pe': 61,
    '1 john': 62, '1john': 62, '1joh': 62, '1jn': 62,
    '2 john': 63, '2john': 63, '2joh': 63, '2jn': 63,
    '3 john': 64, '3john': 64, '3joh': 64, '3jn': 64,
    'jude': 65, 'jud': 65,
    'revelation': 66, 'rev': 66
  };
  return map[String(bookName || '').trim().toLowerCase()] || null;
}

// Commentary lookup for a verse reference (Study Mode UI).
router.get('/lookup', requireOrgFeature('verseCommentary'), async (req, res) => {
  const ref = String(req.query.ref || '').trim();
  const sourceKey = String(req.query.source || req.query.source_key || '').trim();
  if (!ref) return res.status(400).json({ success: false, error: 'Missing ref' });

  const parsed = parseBibleReference(ref);
  if (!parsed || !Number.isFinite(parsed.chapter) || !Number.isFinite(parsed.verse)) {
    return res.status(400).json({ success: false, error: 'Invalid reference format (try e.g. John 3:16)' });
  }

  const book = bookNameToNumber(parsed.bookName);
  if (!book) {
    return res.status(400).json({ success: false, error: 'Unknown book name' });
  }

  try {
    const params = sourceKey
      ? [book, parsed.chapter, parsed.verse, sourceKey]
      : [book, parsed.chapter, parsed.verse];

    const sql = sourceKey
      ? `
      SELECT e.content,
             s.title AS source_title,
             s.source_key,
             e.book,
             e.chapter,
             e.from_verse,
             e.to_verse
      FROM ct_commentary_entries e
      JOIN ct_commentary_sources s ON s.id = e.source_id
      WHERE e.book = $1
        AND e.chapter = $2
        AND $3 BETWEEN e.from_verse AND e.to_verse
        AND s.source_key = $4
      ORDER BY (e.to_verse - e.from_verse) ASC, e.from_verse ASC
      LIMIT 1
      `
      : `
      SELECT e.content,
             s.title AS source_title,
             s.source_key,
             e.book,
             e.chapter,
             e.from_verse,
             e.to_verse
      FROM ct_commentary_entries e
      JOIN ct_commentary_sources s ON s.id = e.source_id
      WHERE e.book = $1
        AND e.chapter = $2
        AND $3 BETWEEN e.from_verse AND e.to_verse
      ORDER BY s.id ASC, (e.to_verse - e.from_verse) ASC, e.from_verse ASC
      LIMIT 1
      `;

    const result = await db.query(
      sql,
      params
    );

    if (!result.rows || result.rows.length === 0) {
      return res.json({ success: true, entry: null });
    }

    const row = result.rows[0];
    return res.json({
      success: true,
      entry: {
        reference: ref,
        content: row.content,
        source_key: row.source_key,
        source_name: row.source_title || row.source_key
      }
    });
  } catch (e) {
    console.error('Commentary lookup error:', e);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

module.exports = router;

