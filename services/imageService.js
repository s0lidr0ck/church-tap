const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const { uploadToS3 } = require('./s3Service');

/**
 * Generate a verse image with text overlay
 */
async function generateVerseImage(verseText, bibleReference) {
  try {
    console.log('🖼️ Generating verse image...', { verseText: verseText.substring(0, 50) + '...', bibleReference });
    
    // Image dimensions
    const width = 1080;
    const height = 1080;
    
    // Create SVG text overlay
    const fontSize = 48;
    const maxCharsPerLine = 35;
    
    // Split text into lines
    const words = verseText.split(' ');
    const lines = [];
    let currentLine = '';
    
    for (const word of words) {
      if ((currentLine + ' ' + word).length <= maxCharsPerLine) {
        currentLine = currentLine ? currentLine + ' ' + word : word;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
    
    // Calculate vertical positioning
    const lineHeight = fontSize * 1.4;
    const totalTextHeight = lines.length * lineHeight + 100; // Extra space for reference
    const startY = (height - totalTextHeight) / 2;
    
    // Create SVG text elements
    let textElements = '';
    lines.forEach((line, index) => {
      const y = startY + (index * lineHeight);
      textElements += `<text x="50%" y="${y}" text-anchor="middle" fill="white" font-size="${fontSize}" font-family="Arial, sans-serif" font-weight="600">${escapeXml(line)}</text>`;
    });
    
    // Add reference
    const refY = startY + (lines.length * lineHeight) + 60;
    textElements += `<text x="50%" y="${refY}" text-anchor="middle" fill="#e5e7eb" font-size="36" font-family="Arial, sans-serif" font-style="italic">${escapeXml(bibleReference)}</text>`;
    
    // Create gradient background SVG
    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#grad)" />
        <rect x="0" y="0" width="100%" height="100%" fill="url(#grad)" opacity="0.9"/>
        ${textElements}
      </svg>
    `;
    
    // Generate image using sharp
    const timestamp = Date.now();
    const filename = `generated-verse-${timestamp}.png`;
    const localPath = path.join('public', 'uploads', filename);
    
    // Ensure uploads directory exists
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    
    // Generate PNG from SVG
    await sharp(Buffer.from(svg))
      .png()
      .toFile(localPath);
    
    console.log('✅ Image generated locally:', localPath);
    
    // Upload to S3 if configured
    let imageUrl = `/uploads/${filename}`;
    try {
      if (process.env.AWS_S3_BUCKET) {
        const s3Result = await uploadToS3(localPath, `verses/${filename}`);
        if (s3Result.success) {
          imageUrl = s3Result.url;
          console.log('✅ Image uploaded to S3:', imageUrl);
          
          // Clean up local file after successful S3 upload
          try {
            await fs.unlink(localPath);
            console.log('🧹 Local file cleaned up');
          } catch (cleanupError) {
            console.warn('⚠️ Failed to clean up local file:', cleanupError.message);
          }
        } else {
          console.warn('⚠️ S3 upload failed, using local file:', s3Result.error);
        }
      } else {
        console.log('📁 S3 not configured, using local file');
      }
    } catch (s3Error) {
      console.warn('⚠️ S3 upload error, using local file:', s3Error.message);
    }
    
    return {
      success: true,
      image_url: imageUrl,
      image_path: localPath,
      filename: filename
    };
    
  } catch (error) {
    console.error('❌ Image generation failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Escape XML special characters
 */
function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  generateVerseImage
};
