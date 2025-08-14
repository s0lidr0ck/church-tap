# Deployment Guide - Church Tap NFC Platform

This guide covers deploying your Church Tap application to production with custom domain support.

## Production Environment Setup

### 1. Environment Variables

Create a `.env` file for production settings:

```bash
# Server Configuration
PORT=3000
NODE_ENV=production

# Database
DATABASE_URL=sqlite:./database.db
# For PostgreSQL: DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Session Security
SESSION_SECRET=your-super-secure-random-string-change-this
JWT_SECRET=your-super-secure-jwt-secret-change-this

# Admin Configuration
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=change-this-secure-password

# Church Branding
CHURCH_NAME=Your Church Name
CHURCH_DOMAIN=yourchurch.com

# File Upload Limits
MAX_FILE_SIZE=10485760  # 10MB in bytes
UPLOAD_PATH=./public/uploads

# AWS S3 Configuration (for file uploads)
S3_BUCKET_NAME=churchtap
S3_REGION=us-east-1
S3_BASE_URL=https://churchtap.s3.us-east-1.amazonaws.com
# AWS_ACCESS_KEY_ID=your-access-key-id
# AWS_SECRET_ACCESS_KEY=your-secret-access-key

# Analytics
ENABLE_ANALYTICS=true
```

### 2. Update Server Configuration

Modify `server.js` for production:

```javascript
// Add at the top
require('dotenv').config();

// Update session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Add security headers
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
```

## Deployment Options

### Example .env file

```env
# Server Configuration
PORT=3000
NODE_ENV=production

# Secrets (use strong random values)
SESSION_SECRET=change-me-session-secret
JWT_SECRET=change-me-jwt-secret

# Database
DATABASE_URL=sqlite:./database.db

# File Uploads
MAX_FILE_SIZE=10485760
UPLOAD_PATH=./public/uploads

# Analytics
ENABLE_ANALYTICS=true

# Rate limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=30
```

### Option 1: Railway (Recommended)

1. **Prepare your app:**
   ```bash
   npm install dotenv
   ```

2. **Create railway.json:**
   ```json
   {
     "build": {
       "builder": "NIXPACKS"
     },
     "deploy": {
       "startCommand": "npm start",
       "healthcheckPath": "/verse",
       "healthcheckTimeout": 300
     }
   }
   ```

3. **Deploy:**
   - Install Railway CLI: `npm install -g @railway/cli`
   - Login: `railway login`
   - Deploy: `railway up`
   - Set environment variables in Railway dashboard

4. **Custom Domain:**
   - Go to Railway project → Settings → Domains
   - Add your custom domain
   - Configure DNS with provided CNAME record

### Option 2: Render

1. **Connect GitHub repo** to Render
2. **Configure build settings:**
   - Build Command: `npm install && npx tailwindcss -i ./public/src/input.css -o ./public/css/style.css`
   - Start Command: `npm start`
3. **Add environment variables** in Render dashboard
4. **Custom domain:** Add in Render → Settings → Custom Domains

### Option 3: DigitalOcean Droplet

1. **Create Ubuntu droplet** (minimum $4/month)
2. **Install Node.js:**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

3. **Install PM2:**
   ```bash
   sudo npm install -g pm2
   ```

4. **Clone and setup:**
   ```bash
    git clone https://github.com/yourusername/church-tap.git
    cd church-tap
   npm install
   npx tailwindcss -i ./public/src/input.css -o ./public/css/style.css
   ```

5. **Create PM2 config:**
   ```javascript
    // ecosystem.config.js
   module.exports = {
     apps: [{
        name: 'church-tap',
       script: 'server.js',
       instances: 'max',
       exec_mode: 'cluster',
       env: {
         NODE_ENV: 'development'
       },
       env_production: {
         NODE_ENV: 'production',
         PORT: 3000
       }
     }]
   };
   ```

6. **Start with PM2:**
   ```bash
   pm2 start ecosystem.config.js --env production
   pm2 save
   pm2 startup
   ```

7. **Setup Nginx reverse proxy:**
   ```nginx
   # /etc/nginx/sites-available/daily-verse
   server {
       listen 80;
       server_name yourchurch.com www.yourchurch.com;
       
       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

8. **Enable site and get SSL:**
   ```bash
   sudo ln -s /etc/nginx/sites-available/daily-verse /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   
   # Install Certbot for SSL
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d yourchurch.com -d www.yourchurch.com
   ```

## Database Upgrade (Optional)

### Migrate to PostgreSQL for Production

1. **Install PostgreSQL:**
   ```bash
   npm install pg
   ```

2. **Create migration script:**
   ```javascript
   // migrate-to-postgres.js
   const sqlite3 = require('sqlite3').verbose();
   const { Pool } = require('pg');
   
   const sqliteDb = new sqlite3.Database('./database.db');
   const pgPool = new Pool({
     connectionString: process.env.DATABASE_URL
   });
   
   // Migration code here...
   ```

3. **Update database connection in server.js:**
   ```javascript
   const { Pool } = require('pg');
   const pool = new Pool({
     connectionString: process.env.DATABASE_URL
   });
   ```

## NFC Tag Configuration

### Programming NFC Tags

1. **Download NFC Tools app** (Android/iOS)
2. **Choose URL record type**
3. **Program with your domain:**
   - Simple: `https://yourchurch.com/verse`
   - Unique tracking: `https://yourchurch.com/verse/tag-{unique-id}`

### Bulk NFC Programming

For programming many tags:
1. **Create URL list** in NFC Tools
2. **Use NFC TagInfo** for verification
3. **Test each tag** before distribution

## Domain Configuration

### DNS Setup

Point your domain to your hosting service:

**For Railway/Render/Vercel:**
```
CNAME www hosting-provider-url
CNAME @ hosting-provider-url
```

**For DigitalOcean/VPS:**
```
A @ your-server-ip
A www your-server-ip
```

### SSL Certificate

Most hosting services provide automatic SSL. For VPS:
- Use Let's Encrypt with Certbot
- Ensure HTTPS for NFC compatibility on iOS

## Performance Optimization

### Image Optimization

1. **Enable image compression:**
   ```javascript
   // Add to server.js
   const compression = require('compression');
   app.use(compression());
   ```

2. **CDN for images:** Consider Cloudinary or AWS S3

### Caching

```javascript
// Add caching headers
app.use('/uploads', express.static('public/uploads', {
  maxAge: '1y',
  etag: false
}));
```

## Monitoring

### Health Checks

Add health check endpoint:
```javascript
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});
```

### Analytics

Consider adding:
- **Google Analytics** for detailed user tracking
- **Umami** for privacy-focused analytics
- **Custom dashboard** using the built-in analytics API

## Backup Strategy

### Database Backups

**SQLite:**
```bash
# Daily backup script
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
cp database.db "backups/database_backup_$DATE.db"
find backups/ -name "database_backup_*.db" -mtime +30 -delete
```

**PostgreSQL:**
```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump $DATABASE_URL > "backups/postgres_backup_$DATE.sql"
```

### File Backups

Backup uploaded images to cloud storage:
- **AWS S3** with lifecycle policies
- **Google Cloud Storage**
- **DigitalOcean Spaces**

## Security Checklist

- [ ] Change default admin credentials
- [ ] Use strong session secret
- [ ] Enable HTTPS in production
- [ ] Set secure headers
- [ ] Regular security updates (`npm audit`)
- [ ] Firewall configuration (if using VPS)
- [ ] Regular backups
- [ ] Monitor for failed login attempts

## Scaling Considerations

### Multi-Church Setup

1. **Subdomain approach:**
   - `stpauls.yourplatform.com`
   - `bethany.yourplatform.com`

2. **Path-based approach:**
   - `yourplatform.com/stpauls`
   - `yourplatform.com/bethany`

3. **Database modifications:**
   ```sql
   ALTER TABLE verses ADD COLUMN church_id INTEGER;
   CREATE TABLE churches (
     id INTEGER PRIMARY KEY,
     name TEXT,
     subdomain TEXT,
     settings JSON
   );
   ```

### Load Balancing

For high traffic:
- Multiple server instances
- Redis for session storage
- CDN for static assets
- Database read replicas

## Troubleshooting

### Common Issues

1. **NFC not working:**
   - Ensure HTTPS is enabled
   - Test with different devices
   - Check URL format in NFC tag

2. **Images not uploading:**
   - Check file permissions
   - Verify upload directory exists
   - Check file size limits

3. **Database errors:**
   - Verify database permissions
   - Check disk space
   - Review connection strings

### Logs

Enable detailed logging:
```javascript
// Add to server.js
const winston = require('winston');
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});
```

## Support

For deployment support:
- Check the GitHub issues
- Review hosting service documentation
- Test locally before deploying
- Monitor application logs

Remember to test your deployment thoroughly with actual NFC tags before going live!