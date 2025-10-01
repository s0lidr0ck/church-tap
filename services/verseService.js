const { db } = require('../config/database');

/**
 * Verse of the Day list - curated popular verses
 * This list cycles through to provide daily verses
 * Using book numbers that bolls.life API expects
 */
const VERSE_OF_DAY_LIST = [
  { book: 43, bookName: 'John', chapter: 3, verse: 16, reference: 'John 3:16' },
  { book: 50, bookName: 'Philippians', chapter: 4, verse: 13, reference: 'Philippians 4:13' },
  { book: 24, bookName: 'Jeremiah', chapter: 29, verse: 11, reference: 'Jeremiah 29:11' },
  { book: 20, bookName: 'Proverbs', chapter: 3, verse: 5, reference: 'Proverbs 3:5-6' },
  { book: 45, bookName: 'Romans', chapter: 8, verse: 28, reference: 'Romans 8:28' },
  { book: 19, bookName: 'Psalm', chapter: 23, verse: 1, reference: 'Psalm 23:1' },
  { book: 23, bookName: 'Isaiah', chapter: 40, verse: 31, reference: 'Isaiah 40:31' },
  { book: 40, bookName: 'Matthew', chapter: 6, verse: 33, reference: 'Matthew 6:33' },
  { book: 6, bookName: 'Joshua', chapter: 1, verse: 9, reference: 'Joshua 1:9' },
  { book: 19, bookName: 'Psalm', chapter: 46, verse: 1, reference: 'Psalm 46:1' },
  { book: 45, bookName: 'Romans', chapter: 12, verse: 2, reference: 'Romans 12:2' },
  { book: 47, bookName: '2 Corinthians', chapter: 5, verse: 17, reference: '2 Corinthians 5:17' },
  { book: 49, bookName: 'Ephesians', chapter: 2, verse: 8, reference: 'Ephesians 2:8-9' },
  { book: 20, bookName: 'Proverbs', chapter: 16, verse: 3, reference: 'Proverbs 16:3' },
  { book: 59, bookName: 'James', chapter: 1, verse: 2, reference: 'James 1:2-3' },
  { book: 62, bookName: '1 John', chapter: 4, verse: 19, reference: '1 John 4:19' },
  { book: 48, bookName: 'Galatians', chapter: 2, verse: 20, reference: 'Galatians 2:20' },
  { book: 51, bookName: 'Colossians', chapter: 3, verse: 23, reference: 'Colossians 3:23' },
  { book: 58, bookName: 'Hebrews', chapter: 11, verse: 1, reference: 'Hebrews 11:1' },
  { book: 40, bookName: 'Matthew', chapter: 11, verse: 28, reference: 'Matthew 11:28' },
  { book: 19, bookName: 'Psalm', chapter: 119, verse: 105, reference: 'Psalm 119:105' },
  { book: 46, bookName: '1 Corinthians', chapter: 13, verse: 13, reference: '1 Corinthians 13:13' },
  { book: 20, bookName: 'Proverbs', chapter: 22, verse: 6, reference: 'Proverbs 22:6' },
  { book: 23, bookName: 'Isaiah', chapter: 41, verse: 10, reference: 'Isaiah 41:10' },
  { book: 45, bookName: 'Romans', chapter: 5, verse: 8, reference: 'Romans 5:8' },
  { book: 19, bookName: 'Psalm', chapter: 37, verse: 4, reference: 'Psalm 37:4' },
  { book: 40, bookName: 'Matthew', chapter: 28, verse: 20, reference: 'Matthew 28:20' },
  { book: 50, bookName: 'Philippians', chapter: 4, verse: 6, reference: 'Philippians 4:6-7' },
  { book: 20, bookName: 'Proverbs', chapter: 18, verse: 10, reference: 'Proverbs 18:10' },
  { book: 43, bookName: 'John', chapter: 14, verse: 6, reference: 'John 14:6' },
  { book: 19, bookName: 'Psalm', chapter: 27, verse: 1, reference: 'Psalm 27:1' }
];

/**
 * Service for importing verses from various sources
 */
class VerseImportService {
  constructor() {
    this.importInProgress = false;
  }

  /**
   * Map our Bible version codes to bolls.life API translation codes
   */
  getBollsTranslationId(version) {
    const mapping = {
      'NIV': 'NIV',
      'NLT': 'NLT',
      'ESV': 'ESV',
      'KJV': 'KJV',
      'NASB': 'NASB',
      'NASB1995': 'NASB',  // NASB1995 maps to NASB on bolls.life
      'CSB': 'CSB',
      'MSG': 'MSG',
      'AMP': 'AMP'
    };
    return mapping[version] || 'NIV';
  }

  /**
   * Get a verse reference for a specific date (cycles through verse list)
   */
  getVerseForDate(date) {
    // Convert date to day of year to get consistent verse selection
    const dateObj = new Date(date);
    const startOfYear = new Date(dateObj.getFullYear(), 0, 0);
    const diff = dateObj - startOfYear;
    const oneDay = 1000 * 60 * 60 * 24;
    const dayOfYear = Math.floor(diff / oneDay);
    
    // Use modulo to cycle through our verse list
    const index = dayOfYear % VERSE_OF_DAY_LIST.length;
    return VERSE_OF_DAY_LIST[index];
  }

  /**
   * Fetch verse text from bolls.life API
   * @param {number|string} book - Book number (1-66) or name
   * @param {number} chapter - Chapter number
   * @param {number|string} verse - Verse number
   * @param {string} version - Bible version code
   * @param {string} bookName - Optional book name for reference display
   */
  async fetchVerseFromAPI(book, chapter, verse, version = 'NIV', bookName = null) {
    try {
      const bollsVersion = this.getBollsTranslationId(version);
      // bolls.life API expects book numbers, not names
      const apiUrl = `https://bolls.life/get-verse/${bollsVersion}/${book}/${chapter}/${verse}/`;
      
      console.log(`📖 Fetching verse from bolls.life: ${apiUrl}`);
      
      const response = await fetch(apiUrl);
      
      if (!response.ok) {
        throw new Error(`API returned status ${response.status}`);
      }
      
      const data = await response.json();
      
      // bolls.life returns the verse text in the 'text' field
      const displayBookName = bookName || data.book_name || book;
      return {
        text: data.text || data.verse_text || '',
        reference: `${displayBookName} ${chapter}:${verse}`,
        version: version,
        book_name: displayBookName
      };
    } catch (error) {
      console.error(`❌ Failed to fetch verse from API:`, error);
      throw error;
    }
  }

  /**
   * Import a verse for a specific date
   */
  async importVerseForDate(organizationId, date, version = 'NIV') {
    try {
      console.log(`📚 Importing verse for date ${date}, org ${organizationId}, version ${version}`);
      
      // Check if verse already exists for this date
      const checkResult = await db.query(
        `SELECT id FROM ct_verses WHERE date = $1 AND organization_id = $2`,
        [date, organizationId]
      );
      
      if (checkResult.rows && checkResult.rows.length > 0) {
        throw new Error('A verse already exists for this date');
      }
      
      // Get verse reference for this date
      const verseRef = this.getVerseForDate(date);
      
      // Fetch verse text from API using book number and book name
      const verseData = await this.fetchVerseFromAPI(
        verseRef.book,        // Book number (e.g., 43 for John)
        verseRef.chapter,
        verseRef.verse,
        version,
        verseRef.bookName     // Book name for display (e.g., "John")
      );
      
      // Insert into database
      const insertResult = await db.query(
        `INSERT INTO ct_verses (
          date, content_type, verse_text, bible_reference, 
          context, tags, published, organization_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          date,
          'text',
          verseData.text,
          verseData.reference,
          `Daily verse automatically imported from ${version}`,
          `daily, ${version.toLowerCase()}, auto-import`,
          true,
          organizationId
        ]
      );
      
      const importedVerse = insertResult.rows[0];
      
      console.log(`✅ Successfully imported verse for ${date}: ${verseData.reference}`);
      
      return {
        id: importedVerse.id,
        reference: verseData.reference,
        text: verseData.text,
        date: date,
        version: version
      };
    } catch (error) {
      console.error('❌ Verse import failed:', error);
      throw error;
    }
  }

  /**
   * Check if a verse exists for a date, and import one if missing
   */
  async checkAndImportMissingVerse(organizationId, date) {
    try {
      console.log(`🔍 Checking for verse on ${date} for org ${organizationId}`);
      
      // Check if verse exists
      const checkResult = await db.query(
        `SELECT id FROM ct_verses WHERE date = $1 AND organization_id = $2 AND published = TRUE`,
        [date, organizationId]
      );
      
      if (checkResult.rows && checkResult.rows.length > 0) {
        console.log(`✓ Verse already exists for ${date}`);
        return null; // Verse already exists
      }
      
      // Check if auto-import is enabled for this organization
      const settingsResult = await db.query(
        `SELECT enabled, bible_version FROM CT_verse_import_settings WHERE organization_id = $1`,
        [organizationId]
      );
      
      let bibleVersion = 'NIV'; // Default
      
      if (settingsResult.rows && settingsResult.rows.length > 0) {
        const settings = settingsResult.rows[0];
        
        if (!settings.enabled) {
          console.log(`⚠️ Auto-import disabled for org ${organizationId}`);
          return null;
        }
        
        bibleVersion = settings.bible_version || 'NIV';
      }
      
      // Import the verse
      console.log(`📥 Auto-importing verse for ${date}...`);
      return await this.importVerseForDate(organizationId, date, bibleVersion);
      
    } catch (error) {
      console.error('❌ Check and import failed:', error);
      throw error;
    }
  }

  /**
   * Import verses from a CSV file
   */
  async importFromCSV(filePath, organizationId = 1) {
    try {
      console.log('📚 Starting verse import from CSV:', filePath);
      this.importInProgress = true;
      
      // This is a placeholder implementation
      // In the future, this could parse CSV files and import verses
      console.log('⚠️ CSV import not implemented yet');
      
      return {
        success: true,
        message: 'Verse import service is available but CSV import is not implemented yet',
        imported: 0
      };
    } catch (error) {
      console.error('❌ Verse import failed:', error);
      return {
        success: false,
        error: error.message
      };
    } finally {
      this.importInProgress = false;
    }
  }

  /**
   * Import verses from an external API
   */
  async importFromAPI(source, organizationId = 1) {
    try {
      console.log('📚 Starting verse import from API:', source);
      this.importInProgress = true;
      
      // This is a placeholder implementation
      // In the future, this could fetch verses from APIs like bolls.life
      console.log('⚠️ API import not implemented yet');
      
      return {
        success: true,
        message: 'Verse import service is available but API import is not implemented yet',
        imported: 0
      };
    } catch (error) {
      console.error('❌ API verse import failed:', error);
      return {
        success: false,
        error: error.message
      };
    } finally {
      this.importInProgress = false;
    }
  }

  /**
   * Check if import is in progress
   */
  isImporting() {
    return this.importInProgress;
  }

  /**
   * Get import status
   */
  getStatus() {
    return {
      importing: this.importInProgress,
      lastImport: null,
      totalVerses: 0
    };
  }
}

module.exports = {
  VerseImportService
};
