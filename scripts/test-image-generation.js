// Test image generation with S3 upload
require('dotenv').config();

async function testImageGeneration() {
  console.log('🖼️ Testing image generation with S3 upload...\n');

  try {
    const response = await fetch('http://localhost:3000/api/verse/generate-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        verse_text: 'For I know the plans I have for you, declares the Lord, plans for welfare and not for evil, to give you a future and a hope.',
        bible_reference: 'Jeremiah 29:11'
      })
    });

    const data = await response.json();
    
    if (data.success) {
      console.log('✅ Image generation successful!');
      console.log(`   S3 URL: ${data.image_url}`);
      console.log(`   Path: ${data.image_path}`);
      console.log('\n🔍 Testing image accessibility...');
      
      // Test if the image is accessible
      try {
        const imageResponse = await fetch(data.image_url);
        if (imageResponse.ok) {
          console.log('✅ Image is publicly accessible from S3');
          console.log(`   Status: ${imageResponse.status}`);
          console.log(`   Content-Type: ${imageResponse.headers.get('content-type')}`);
        } else {
          console.log('❌ Image is not accessible from S3');
          console.log(`   Status: ${imageResponse.status}`);
        }
      } catch (fetchError) {
        console.log('❌ Error accessing image:', fetchError.message);
      }
    } else {
      console.log('❌ Image generation failed:', data.error);
    }
  } catch (error) {
    console.log('❌ Test failed:', error.message);
  }
}

// Add delay to ensure server is ready
setTimeout(testImageGeneration, 2000);