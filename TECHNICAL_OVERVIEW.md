# Church Tap: Technical Architecture Overview

*A comprehensive technical guide for developers and system administrators*

---

## System Architecture

Church Tap is built as a modern, scalable web application using proven technologies and best practices for reliability, security, and performance.

### Technology Stack

**Frontend:**
- **Vanilla JavaScript**: Lightweight, fast-loading interface without complex framework dependencies
- **Tailwind CSS**: Utility-first styling for responsive, mobile-first design
- **Progressive Web App (PWA)**: Offline support, installable, app-like experience
- **Service Worker**: Background sync, caching, and offline functionality

**Backend:**
- **Node.js + Express**: Fast, efficient server-side application
- **PostgreSQL**: Robust, scalable database for production deployments
- **JWT Authentication**: Secure, stateless authentication system
- **Session Management**: Secure cookie-based sessions for admin interfaces

**Infrastructure:**
- **AWS S3**: Scalable file storage for images and media
- **Sharp**: High-performance image processing and optimization
- **Node-cron**: Automated task scheduling (daily content publishing)
- **Rate Limiting**: API protection against abuse and overload

---

## Database Schema

### Multi-Tenant Architecture
The platform supports multiple organizations (churches) through a comprehensive multi-tenant design:

**Core Tables:**
- `CT_organizations`: Church/organization management
- `CT_admin_users`: Administrative users per organization
- `CT_verses`: Daily content management
- `CT_nfc_tags`: NFC bracelet and tag tracking
- `CT_analytics`: Comprehensive usage and engagement tracking

**Community Features:**
- `ct_prayer_requests`: Anonymous prayer sharing
- `ct_praise_reports`: Celebration and testimony sharing
- `ct_verse_community_posts`: Community insights and reflections
- `ct_user_accounts`: Optional user registration system

**NFC & Device Management:**
- `ct_bracelet_memberships`: User-to-bracelet associations
- `ct_organization_requests`: New church signup management
- `ct_interaction_tracking`: Detailed user engagement analytics

### Data Flow
1. **Content Creation**: Admins create/schedule verses through dashboard
2. **Auto-Publishing**: Cron jobs publish content at midnight Central Time
3. **User Access**: NFC taps or direct web access serve content
4. **Analytics Collection**: All interactions tracked for insights
5. **Community Moderation**: User submissions reviewed before publication

---

## Security Implementation

### Authentication & Authorization
- **Bcrypt Password Hashing**: Industry-standard password protection
- **JWT Tokens**: Secure, scalable user authentication
- **Session Management**: HttpOnly cookies with secure flags
- **Role-Based Access**: Admin, master admin, and user permission levels

### Data Protection
- **SQL Injection Prevention**: Parameterized queries throughout
- **XSS Protection**: Content sanitization and CSP headers
- **Rate Limiting**: API endpoint protection against abuse
- **HTTPS Enforcement**: SSL/TLS encryption for all communications

### Privacy Considerations
- **Anonymous Community Features**: No personal data required for sharing
- **IP Address Anonymization**: Partial IP storage for analytics
- **GDPR Compliance**: User data export and deletion capabilities
- **Minimal Data Collection**: Only essential information stored

---

## API Architecture

### RESTful Endpoints
The application exposes well-structured REST APIs for all functionality:

**Public APIs:**
- `GET /api/verses/:date` - Retrieve daily verse content
- `GET /api/community/:date` - Get community content for date
- `POST /api/prayer` - Submit prayer request
- `POST /api/praise` - Submit praise report

**Admin APIs:**
- `GET /api/admin/verses` - Manage verse content
- `GET /api/admin/analytics` - Organization analytics
- `POST /api/admin/verses` - Create new verses
- `PUT /api/admin/community/moderate` - Content moderation

**Master Admin APIs:**
- `GET /api/master/organizations` - Multi-org management
- `POST /api/master/organizations` - Create new organizations
- `GET /api/master/analytics` - Cross-organization analytics

### Data Format
All APIs return JSON with consistent structure:
```json
{
  "success": true,
  "data": { /* response data */ },
  "message": "Optional status message",
  "pagination": { /* for paginated results */ }
}
```

---

## NFC Implementation

### NFC Tag Management
- **Unique Identifiers**: Each bracelet/tag has unique UID
- **Organization Association**: Tags linked to specific churches
- **Analytics Tracking**: Tap events recorded for usage analysis
- **Flexible URLs**: Support for both simple and tracked tag URLs

### URL Patterns
- **Simple**: `https://yourchurch.churchtap.com/verse`
- **Tracked**: `https://churchtap.com/t/[tag-uid]`
- **Organization-Specific**: `https://yourchurch.churchtap.com/t/[tag-uid]`

### Mobile Compatibility
- **Universal Support**: Works with all NFC-enabled devices
- **iOS/Android**: Compatible with all modern smartphones
- **Web Standards**: Uses standard NDEF record format
- **Fallback Support**: Manual URL entry for non-NFC devices

---

## Performance Optimization

### Frontend Performance
- **Lazy Loading**: Images and content loaded on demand
- **Service Worker Caching**: Offline content availability
- **Minified Assets**: Compressed CSS and JavaScript
- **WebP Images**: Modern image formats for faster loading

### Backend Optimization
- **Database Indexing**: Optimized queries for fast response times
- **Connection Pooling**: Efficient database connection management
- **Compression**: Gzip compression for all responses
- **Caching Headers**: Browser caching for static assets

### CDN Integration
- **AWS S3**: Global content delivery for images
- **Edge Caching**: Reduced latency for global users
- **Image Optimization**: Automatic resizing and format conversion
- **Asset Versioning**: Cache busting for updated content

---

## Analytics & Monitoring

### Data Collection
Comprehensive analytics without compromising privacy:
- **Page Views**: Track verse and content engagement
- **User Actions**: Heart, favorite, share interactions
- **Geographic Data**: General location analytics (city-level)
- **Device Info**: Browser and device type for optimization
- **NFC Scans**: Tag usage and popular access points

### Admin Dashboard Metrics
- **Daily Engagement**: Views, unique visitors, interaction rates
- **Content Performance**: Most popular verses and content types
- **Community Activity**: Prayer requests, praise reports, insights
- **Technical Metrics**: Load times, error rates, device compatibility

### Export Capabilities
- **CSV Export**: All analytics data exportable for external analysis
- **API Access**: Programmatic access to analytics data
- **Custom Reports**: Filtered date ranges and specific metrics
- **Privacy Controls**: Anonymized data for sensitive information

---

## Deployment Architecture

### Development Environment
```bash
# Local development setup
npm install
npm run build:css
npm run dev
```

### Production Deployment
**Recommended Platforms:**
- **Railway**: Automatic deployments from Git
- **Render**: Integrated PostgreSQL and file storage
- **DigitalOcean App Platform**: Scalable with managed databases
- **AWS/Vercel**: High-traffic enterprise deployments

**Environment Configuration:**
```bash
NODE_ENV=production
DATABASE_URL=postgresql://[connection-string]
JWT_SECRET=[secure-random-string]
SESSION_SECRET=[secure-random-string]
S3_BUCKET_NAME=[aws-s3-bucket]
S3_REGION=[aws-region]
```

### Scaling Considerations
- **Database**: PostgreSQL handles thousands of concurrent users
- **File Storage**: S3 provides unlimited scalable storage
- **Application**: Stateless design allows horizontal scaling
- **CDN**: Global content delivery for optimal performance

---

## Integration Capabilities

### Church Management Systems
The platform can integrate with existing church software:
- **API-First Design**: RESTful APIs for external integrations
- **Member Import**: CSV import for existing member databases
- **SSO Support**: Single sign-on integration capabilities
- **Webhook Support**: Real-time event notifications

### Third-Party Services
- **Bible APIs**: Integration with Bible Gateway, ESV API
- **Email Services**: SendGrid, Mailgun for notifications
- **SMS Services**: Twilio for text message features
- **Analytics**: Google Analytics integration support

### Custom Development
- **Open Architecture**: Extensible codebase for custom features
- **Plugin System**: Modular design for additional functionality
- **API Extensions**: Custom endpoints for specific needs
- **White-Label**: Complete customization for church branding

---

## Maintenance & Support

### Automated Systems
- **Database Backups**: Daily automated backups to secure storage
- **Security Updates**: Automated dependency updates and patching
- **Health Monitoring**: Application performance and uptime monitoring
- **Error Tracking**: Comprehensive error logging and alerting

### Admin Tools
- **Database Management**: Built-in tools for data management
- **Content Migration**: Import/export tools for content transfer
- **User Management**: Admin account creation and permission management
- **System Diagnostics**: Built-in health checks and system status

### Support Infrastructure
- **Documentation**: Comprehensive technical and user documentation
- **Video Tutorials**: Step-by-step setup and usage guides
- **Community Forum**: Church administrator community support
- **Direct Support**: Technical support for complex issues

---

## Future Roadmap

### Planned Enhancements
- **Advanced Personalization**: AI-driven content recommendations
- **Multi-Language Support**: Internationalization for global churches
- **Enhanced Bible Study**: Integrated study tools and commentaries
- **Mobile Apps**: Native iOS and Android applications
- **Advanced Analytics**: Predictive analytics and insights

### Scalability Improvements
- **Microservices Architecture**: Service decomposition for large scale
- **Real-Time Features**: WebSocket support for live interactions
- **Advanced Caching**: Redis integration for high-performance caching
- **API Rate Limiting**: Advanced rate limiting and API management

---

*This technical overview provides the foundation for understanding Church Tap's architecture and capabilities. For implementation details or custom development needs, contact our technical team.*
