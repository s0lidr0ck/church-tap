/**
 * Test script for verse import functionality
 * Run with: node scripts/test-verse-import.js
 */

const { VerseImportService } = require('../services/verseService');
const { db } = require('../config/database');

async function testVerseImport() {
  const verseService = new VerseImportService();
  
  console.log('🧪 Testing Verse Import Service...\n');
  
  try {
    // Test 1: Get verse for a specific date
    const today = new Date().toISOString().split('T')[0];
    console.log(`📅 Testing verse selection for date: ${today}`);
    const verseRef = verseService.getVerseForDate(today);
    console.log(`✅ Selected verse: ${verseRef.reference}`);
    console.log(`   Book: ${verseRef.book}, Chapter: ${verseRef.chapter}, Verse: ${verseRef.verse}\n`);
    
    // Test 2: Try to fetch verse from API
    console.log('🌐 Testing API fetch...');
    try {
      const verseData = await verseService.fetchVerseFromAPI(
        verseRef.book,        // Book number
        verseRef.chapter, 
        verseRef.verse, 
        'NIV',
        verseRef.bookName     // Book name for display
      );
      console.log(`✅ Successfully fetched from API:`);
      console.log(`   Reference: ${verseData.reference}`);
      console.log(`   Text preview: ${verseData.text.substring(0, 100)}...\n`);
    } catch (error) {
      console.error(`❌ API fetch failed:`, error.message);
      console.log('   (This might be expected if offline or API is down)\n');
    }
    
    // Test 3: Check and import for organization 1 (default org)
    console.log('📥 Testing check and import for organization 1...');
    try {
      const result = await verseService.checkAndImportMissingVerse(1, today);
      
      if (result) {
        console.log(`✅ Successfully imported verse:`);
        console.log(`   ID: ${result.id}`);
        console.log(`   Reference: ${result.reference}`);
        console.log(`   Date: ${result.date}`);
        console.log(`   Version: ${result.version}`);
      } else {
        console.log(`ℹ️  Verse already exists for today, or auto-import is disabled`);
      }
    } catch (error) {
      console.error(`❌ Import failed:`, error.message);
      if (error.message.includes('already exists')) {
        console.log('   (This is expected if verse already exists for today)');
      }
    }
    
    console.log('\n✅ All tests completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    // Close database connection
    process.exit(0);
  }
}

// Run the test
testVerseImport();
