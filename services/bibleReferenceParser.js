// Simple Bible reference parsing for admin-configured Topic verses.
// Supports references like:
// - "John 3:16"
// - "1 John 4:19"
// - "Song of Solomon 2:1"
// Notes:
// - We support single verses and same-chapter ranges (e.g. "John 3:16-18").

const BOOKS = [
  // 1..66 (bolls.life numbering)
  { n: 1, names: ['genesis', 'gen'] },
  { n: 2, names: ['exodus', 'exo', 'ex'] },
  { n: 3, names: ['leviticus', 'lev', 'le'] },
  { n: 4, names: ['numbers', 'num', 'nu'] },
  { n: 5, names: ['deuteronomy', 'deut', 'dt'] },
  { n: 6, names: ['joshua', 'josh', 'jos'] },
  { n: 7, names: ['judges', 'judg', 'jdg', 'jg'] },
  { n: 8, names: ['ruth', 'rut'] },
  { n: 9, names: ['1 samuel', '1samuel', '1 sam', '1sam'] },
  { n: 10, names: ['2 samuel', '2samuel', '2 sam', '2sam'] },
  { n: 11, names: ['1 kings', '1kings', '1 kgs', '1kgs', '1 ki', '1ki'] },
  { n: 12, names: ['2 kings', '2kings', '2 kgs', '2kgs', '2 ki', '2ki'] },
  { n: 13, names: ['1 chronicles', '1chronicles', '1 chron', '1chron', '1 chr', '1chr'] },
  { n: 14, names: ['2 chronicles', '2chronicles', '2 chron', '2chron', '2 chr', '2chr'] },
  { n: 15, names: ['ezra', 'ezr'] },
  { n: 16, names: ['nehemiah', 'neh'] },
  { n: 17, names: ['esther', 'est'] },
  { n: 18, names: ['job'] },
  { n: 19, names: ['psalms', 'psalm', 'ps', 'psa'] },
  { n: 20, names: ['proverbs', 'prov', 'prv', 'pr'] },
  { n: 21, names: ['ecclesiastes', 'eccles', 'ecc', 'ec'] },
  { n: 22, names: ['song of solomon', 'song of songs', 'song', 'songs', 'sos'] },
  { n: 23, names: ['isaiah', 'isa', 'is'] },
  { n: 24, names: ['jeremiah', 'jer', 'je'] },
  { n: 25, names: ['lamentations', 'lam', 'la'] },
  { n: 26, names: ['ezekiel', 'ezek', 'eze', 'ez'] },
  { n: 27, names: ['daniel', 'dan', 'da'] },
  { n: 28, names: ['hosea', 'hos', 'ho'] },
  { n: 29, names: ['joel', 'jl'] },
  { n: 30, names: ['amos', 'am'] },
  { n: 31, names: ['obadiah', 'obad', 'ob'] },
  { n: 32, names: ['jonah', 'jon'] },
  { n: 33, names: ['micah', 'mic', 'mi'] },
  { n: 34, names: ['nahum', 'nah', 'na'] },
  { n: 35, names: ['habakkuk', 'hab', 'hb'] },
  { n: 36, names: ['zephaniah', 'zeph', 'zep', 'zp'] },
  { n: 37, names: ['haggai', 'hag', 'hg'] },
  { n: 38, names: ['zechariah', 'zech', 'zec', 'zc'] },
  { n: 39, names: ['malachi', 'mal', 'ml'] },
  { n: 40, names: ['matthew', 'matt', 'mt'] },
  { n: 41, names: ['mark', 'mrk', 'mk'] },
  { n: 42, names: ['luke', 'luk', 'lk'] },
  { n: 43, names: ['john', 'jn', 'jhn'] },
  { n: 44, names: ['acts', 'act'] },
  { n: 45, names: ['romans', 'rom', 'ro'] },
  { n: 46, names: ['1 corinthians', '1corinthians', '1 cor', '1cor'] },
  { n: 47, names: ['2 corinthians', '2corinthians', '2 cor', '2cor'] },
  { n: 48, names: ['galatians', 'gal', 'ga'] },
  { n: 49, names: ['ephesians', 'eph', 'ep'] },
  { n: 50, names: ['philippians', 'phil', 'php'] },
  { n: 51, names: ['colossians', 'col', 'co'] },
  { n: 52, names: ['1 thessalonians', '1thessalonians', '1 thess', '1thess', '1 th', '1th'] },
  { n: 53, names: ['2 thessalonians', '2thessalonians', '2 thess', '2thess', '2 th', '2th'] },
  { n: 54, names: ['1 timothy', '1timothy', '1 tim', '1tim'] },
  { n: 55, names: ['2 timothy', '2timothy', '2 tim', '2tim'] },
  { n: 56, names: ['titus', 'tit'] },
  { n: 57, names: ['philemon', 'phlm', 'phm'] },
  { n: 58, names: ['hebrews', 'heb'] },
  { n: 59, names: ['james', 'jas', 'jm'] },
  { n: 60, names: ['1 peter', '1peter', '1 pet', '1pet'] },
  { n: 61, names: ['2 peter', '2peter', '2 pet', '2pet'] },
  { n: 62, names: ['1 john', '1john', '1 jn', '1jn'] },
  { n: 63, names: ['2 john', '2john', '2 jn', '2jn'] },
  { n: 64, names: ['3 john', '3john', '3 jn', '3jn'] },
  { n: 65, names: ['jude', 'jud'] },
  { n: 66, names: ['revelation', 'rev', 're'] }
];

const BOOK_LOOKUP = (() => {
  const m = new Map();
  for (const b of BOOKS) {
    for (const nm of b.names) {
      m.set(nm, b.n);
    }
  }
  return m;
})();

function normalizeBookName(bookPart) {
  return (bookPart || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Parse a bible reference (single verse or same-chapter range).
 * Returns: { book_number, chapter, verse_start, verse_end, normalized_reference }
 */
function parseVerseReference(input) {
  const raw = (input || '').toString().trim();
  if (!raw) throw new Error('Bible reference is required');

  // Split into book + chapter:verse
  const match = raw.match(/^(.+?)\s+(\d+)\s*:\s*(\d+)(?:\s*-\s*(\d+))?\s*$/);
  if (!match) {
    throw new Error('Invalid reference format. Use something like "John 3:16" or "John 3:16-18".');
  }

  const bookName = normalizeBookName(match[1]);
  const chapter = parseInt(match[2], 10);
  const verse_start = parseInt(match[3], 10);
  const verse_end = match[4] ? parseInt(match[4], 10) : verse_start;

  const book_number = BOOK_LOOKUP.get(bookName);
  if (!book_number) {
    throw new Error(`Unknown Bible book: "${match[1]}".`);
  }
  if (!Number.isFinite(chapter) || chapter < 1) throw new Error('Invalid chapter number');
  if (!Number.isFinite(verse_start) || verse_start < 1) throw new Error('Invalid verse number');
  if (!Number.isFinite(verse_end) || verse_end < verse_start) throw new Error('Invalid verse range');

  const normalized_reference = verse_end === verse_start
    ? `${match[1].trim()} ${chapter}:${verse_start}`
    : `${match[1].trim()} ${chapter}:${verse_start}-${verse_end}`;

  return {
    book_number,
    chapter,
    verse_start,
    verse_end,
    normalized_reference
  };
}

module.exports = {
  parseVerseReference
};


