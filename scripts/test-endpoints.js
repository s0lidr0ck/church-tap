// Simple test script to verify key endpoints are working
require('dotenv').config();

async function testEndpoints() {
  console.log('🧪 Testing key endpoints...\n');

  const baseUrl = 'http://localhost:3000';
  
  // Test basic verse endpoint
  try {
    const today = new Date().toISOString().split('T')[0];
    const response = await fetch(`${baseUrl}/api/verse/${today}`);
    const data = await response.json();
    
    if (data.success) {
      console.log('✅ Verse API working');
      console.log(`   - Reference: ${data.verse?.bible_reference || 'N/A'}`);
      console.log(`   - Content: ${(data.verse?.verse_text || 'Image verse').substring(0, 50)}...`);
    } else {
      console.log('⚠️  Verse API returned no data (expected for new setup)');
    }
  } catch (error) {
    console.log('❌ Verse API failed:', error.message);
  }

  // Test search endpoint
  try {
    const response = await fetch(`${baseUrl}/api/verses/search?q=faith`);
    const data = await response.json();
    
    if (data.success) {
      console.log('✅ Search API working');
      console.log(`   - Found ${data.verses.length} results for "faith"`);
    } else {
      console.log('⚠️  Search API working but no results found');
    }
  } catch (error) {
    console.log('❌ Search API failed:', error.message);
  }

  // Test master admin check session
  try {
    const response = await fetch(`${baseUrl}/api/master/check-session`);
    const data = await response.json();
    
    if (data.success) {
      console.log('✅ Master admin API working');
      console.log(`   - Authenticated: ${data.authenticated ? 'Yes' : 'No'}`);
    } else {
      console.log('❌ Master admin API failed');
    }
  } catch (error) {
    console.log('❌ Master admin API failed:', error.message);
  }

  // Test admin check session
  try {
    const response = await fetch(`${baseUrl}/api/admin/check-session`);
    const data = await response.json();
    
    if (data.success) {
      console.log('✅ Admin API working');
      console.log(`   - Authenticated: ${data.authenticated ? 'Yes' : 'No'}`);
    } else {
      console.log('❌ Admin API failed');
    }
  } catch (error) {
    console.log('❌ Admin API failed:', error.message);
  }

  // Test image generation
  try {
    const response = await fetch(`${baseUrl}/api/verse/generate-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        verse_text: 'Test verse text for generation',
        bible_reference: 'Test 1:1'
      })
    });
    const data = await response.json();
    
    if (data.success) {
      console.log('✅ Image generation working');
      console.log(`   - Generated: ${data.image_path}`);
    } else {
      console.log('❌ Image generation failed:', data.error);
    }
  } catch (error) {
    console.log('❌ Image generation failed:', error.message);
  }

  console.log('\n🎉 Endpoint testing complete!');
  console.log('\n📖 Manual Testing URLs:');
  console.log(`   Main App: ${baseUrl}/`);
  console.log(`   Admin Panel: ${baseUrl}/admin`);
  console.log(`   Master Panel: ${baseUrl}/master`);
  console.log('\n🔑 Login Credentials:');
  console.log('   Master Admin: master / master123');
  console.log('   Organization Admin: admin / admin123');
}

// Add delay to ensure server is ready
setTimeout(testEndpoints, 2000);