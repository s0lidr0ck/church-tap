# S3 Setup Guide for Church Tap

Your Church Tap application is now configured to use AWS S3 for file storage. This guide will help you set up the S3 bucket with the correct permissions.

## ✅ What's Already Done

- AWS SDK integrated into the application
- Upload handlers updated to use S3 instead of local storage
- Image generation saves directly to S3
- Environment configuration ready for S3

## 🪣 S3 Bucket Configuration

### Bucket Name
Your app is configured to use: `churchtap`

### Required Bucket Settings

1. **Region**: `us-east-1` (already configured)
2. **Public Access**: Enabled for uploaded files
3. **Versioning**: Optional (recommended for production)
4. **Encryption**: Optional (recommended for production)

## 🔒 Setting Up Bucket Permissions

### Option 1: Bucket Policy (Recommended)

Add this bucket policy to make uploaded files publicly readable:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "PublicReadGetObject",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::churchtap/*"
        }
    ]
}
```

### Option 2: Public Access Settings

If you prefer not to use a bucket policy:

1. Go to S3 Console → churchtap bucket → Permissions
2. Edit "Block public access" settings:
   - Uncheck "Block all public access"
   - Keep other settings as needed for security

## 🔐 IAM Permissions

### For Development (Local Testing)

You can use AWS credentials in your `.env` file:

```bash
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
```

### For Production (Recommended)

Use IAM roles instead of credentials:

#### Required IAM Policy for Church Tap:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:PutObject",
                "s3:DeleteObject",
                "s3:GetObject"
            ],
            "Resource": "arn:aws:s3:::churchtap/*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "s3:ListBucket"
            ],
            "Resource": "arn:aws:s3:::churchtap"
        }
    ]
}
```

## 📁 File Organization

Your app organizes files in S3 as follows:

```
churchtap/
├── uploads/           # Verse images uploaded by admins
│   └── verse-*.jpg    # Processed 9:16 aspect ratio images
├── generated/         # AI-generated verse images
│   └── generated-verse-*.png
└── [future folders]   # Room for expansion
```

## 🧪 Testing Your Setup

### 1. Test Upload Functionality

```bash
# Run the test script
node scripts/test-s3.js
```

### 2. Test Image Generation

```bash
# Start your server
npm start

# In another terminal, test image generation
node scripts/test-image-generation.js
```

### 3. Verify Public Access

After uploading files, check that they're accessible:
- Visit: `https://churchtap.s3.us-east-1.amazonaws.com/generated/[filename]`
- Should return the image, not an access denied error

## 🚀 Deployment Considerations

### Environment Variables

Set these in your production environment:

```bash
S3_BUCKET_NAME=churchtap
S3_REGION=us-east-1
S3_BASE_URL=https://churchtap.s3.us-east-1.amazonaws.com
```

### CDN Setup (Optional)

For better performance, consider setting up CloudFront:

1. Create CloudFront distribution pointing to your S3 bucket
2. Update `S3_BASE_URL` to your CloudFront domain
3. Configure caching rules for images (long TTL)

### Cost Optimization

- Set up S3 lifecycle policies to archive old files
- Monitor usage through AWS Cost Explorer
- Consider using S3 Intelligent Tiering for automatic cost optimization

## 🔧 Troubleshooting

### Common Issues

1. **403 Forbidden when accessing images**
   - Check bucket policy is correctly applied
   - Verify public access settings
   - Ensure files are actually uploaded

2. **Upload failures**
   - Verify IAM permissions
   - Check AWS credentials/role configuration
   - Confirm bucket exists in specified region

3. **Slow uploads**
   - Consider using S3 Transfer Acceleration
   - Check network connectivity
   - Verify region is optimal for your deployment

### Debug Commands

```bash
# Test AWS CLI access
aws s3 ls s3://churchtap/

# Test file upload
aws s3 cp test.png s3://churchtap/test.png

# Check public accessibility
curl -I https://churchtap.s3.us-east-1.amazonaws.com/test.png
```

## 📈 Monitoring

Set up CloudWatch monitoring for:
- S3 request metrics
- Error rates
- Storage usage
- Cost tracking

## 🎯 Next Steps

1. ✅ **Files upload to S3** - Already working
2. ⚠️ **Make bucket public** - Need to configure permissions
3. 🔄 **Test admin interface** - Upload images through admin panel
4. 🌐 **Deploy to production** - Use IAM roles, not credentials
5. 📊 **Monitor usage** - Set up CloudWatch alerts

Your S3 integration is technically complete and ready for production use!