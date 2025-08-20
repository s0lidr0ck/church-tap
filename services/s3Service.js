const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');

class S3Service {
  constructor() {
    this.bucketName = process.env.S3_BUCKET_NAME || 'churchtap';
    this.region = process.env.S3_REGION || 'us-east-1';
    this.baseUrl = process.env.S3_BASE_URL || `https://${this.bucketName}.s3.${this.region}.amazonaws.com`;
    
    // Initialize S3 client with error handling
    try {
      const clientConfig = {
        region: this.region,
      };

      // Add credentials if provided (for local development)
      if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
        clientConfig.credentials = {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        };
      }
      
      this.s3Client = new S3Client(clientConfig);
      this.isAvailable = true;
    } catch (error) {
      console.warn('S3 service unavailable:', error.message);
      this.isAvailable = false;
      this.s3Client = null;
    }
  }

  /**
   * Upload a file buffer to S3
   * @param {Buffer} buffer - File buffer
   * @param {string} originalName - Original filename
   * @param {string} mimeType - MIME type of the file
   * @param {string} folder - Folder within bucket (optional)
   * @returns {Promise<{key: string, url: string}>}
   */
  async uploadFile(buffer, originalName, mimeType, folder = 'uploads') {
    if (!this.isAvailable) {
      throw new Error('S3 service is not available. Please configure AWS credentials and S3 bucket.');
    }
    
    try {
      // Generate unique filename
      const timestamp = Date.now();
      const randomString = crypto.randomBytes(8).toString('hex');
      const extension = originalName.split('.').pop();
      const key = `${folder}/verse-${timestamp}-${randomString}.${extension}`;

      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        CacheControl: 'max-age=31536000' // 1 year cache
        // Note: ACL removed - bucket should have public read policy instead
      });

      await this.s3Client.send(command);

      const url = `${this.baseUrl}/${key}`;
      
      return {
        key,
        url,
        path: `/${key}` // Compatible with existing path format
      };
    } catch (error) {
      console.error('S3 upload error:', error);
      throw new Error(`Failed to upload file to S3: ${error.message}`);
    }
  }

  /**
   * Upload image with specific processing
   * @param {Buffer} buffer - Image buffer
   * @param {string} originalName - Original filename
   * @param {string} folder - Folder within bucket
   * @returns {Promise<{key: string, url: string}>}
   */
  async uploadImage(buffer, originalName = 'image.jpg', folder = 'uploads') {
    return this.uploadFile(buffer, originalName, 'image/jpeg', folder);
  }

  /**
   * Upload generated image
   * @param {Buffer} buffer - Image buffer
   * @param {string} filename - Custom filename
   * @returns {Promise<{key: string, url: string}>}
   */
  async uploadGeneratedImage(buffer, filename) {
    if (!this.isAvailable) {
      throw new Error('S3 service is not available. Please configure AWS credentials and S3 bucket.');
    }
    
    try {
      const timestamp = Date.now();
      const key = `generated/${filename || `generated-verse-${timestamp}.png`}`;

      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: 'image/png',
        CacheControl: 'max-age=31536000'
        // Note: ACL removed - bucket should have public read policy instead
      });

      await this.s3Client.send(command);

      const url = `${this.baseUrl}/${key}`;
      
      return {
        key,
        url,
        path: `/${key}`
      };
    } catch (error) {
      console.error('S3 generated image upload error:', error);
      throw new Error(`Failed to upload generated image to S3: ${error.message}`);
    }
  }

  /**
   * Delete a file from S3
   * @param {string} key - S3 object key
   * @returns {Promise<void>}
   */
  async deleteFile(key) {
    if (!this.isAvailable) {
      console.warn('S3 service not available - skipping file deletion');
      return;
    }
    
    try {
      // Remove leading slash if present
      const cleanKey = key.startsWith('/') ? key.substring(1) : key;
      
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: cleanKey,
      });

      await this.s3Client.send(command);
    } catch (error) {
      console.error('S3 delete error:', error);
      // Don't throw error for delete failures - log and continue
    }
  }

  /**
   * Extract S3 key from URL or path
   * @param {string} urlOrPath - Full URL or path
   * @returns {string} S3 key
   */
  extractKey(urlOrPath) {
    if (!urlOrPath) return null;
    
    // If it's a full URL
    if (urlOrPath.startsWith('http')) {
      const url = new URL(urlOrPath);
      return url.pathname.substring(1); // Remove leading slash
    }
    
    // If it's a path starting with /uploads or similar
    if (urlOrPath.startsWith('/')) {
      return urlOrPath.substring(1); // Remove leading slash
    }
    
    // If it's already a key
    return urlOrPath;
  }
}

module.exports = new S3Service();