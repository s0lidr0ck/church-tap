# Church Tap - NFC Engagement Platform

A comprehensive web application for delivering daily engagement through NFC-enabled bracelets, with a powerful admin dashboard and user engagement features.

## Features

### Phase 1 (Current)
- ✅ **Mobile-first PWA** - Works without app installation
- ✅ **Daily verse system** - Auto-publish at midnight Central Time
- ✅ **Text & image verses** - Support for both formats (9:16 images)
- ✅ **2-week history** - Browse previous verses with smooth navigation
- ✅ **User engagement** - Heart counters, favorites, sharing
- ✅ **Admin dashboard** - Complete verse management system
- ✅ **Analytics** - Track views, engagement, popular verses
- ✅ **Advanced features** - QR codes, themes, text sizing, offline support

### Phase 2 (Planned)
- 🔲 **Daily prayer requests** - Anonymous community prayers
- 🔲 **Praise reports** - Daily celebration sharing
- 🔲 **Enhanced study** - Full chapters, commentaries, related verses

### Phase 3 (Planned)
- 🔲 **User accounts** - Personal profiles and authentication
- 🔲 **Personalization** - Customized verses based on interests/struggles
- 🔲 **Community features** - Advanced social interactions

## Quick Start

### 1. Installation
```bash
npm install
```

### 2. Build CSS
```bash
npx tailwindcss -i ./public/src/input.css -o ./public/css/style.css
```

### 3. Start Server
```bash
npm start
```

### 4. Access the App
- **Public App**: http://localhost:3000/verse
- **Admin Dashboard**: http://localhost:3000/admin
- **Default Admin Login**: admin / admin123

## NFC Setup

1. **Purchase NFC Tags**: Get blank NFC tags/stickers for bracelets
2. **Program Tags**: Use an NFC writing app to program tags with your URL:
   - Simple: `https://yoursite.com/verse`
   - Unique: `https://yoursite.com/verse/tag123` (for tracking)
3. **Test**: Tap programmed tag with phone to verify it opens your app

## Admin Dashboard

### Verse Management
- Create text or image verses
- Schedule verses for auto-publishing
- Add Bible references, context, and tags
- Bulk operations and templates
- Version history and backups

### Analytics
- Daily view counts and unique visitors
- Most popular verses
- Engagement metrics (hearts, shares)
- Usage heatmaps

### Features
- Drag-and-drop verse reordering
- Multi-admin support with permissions
- Auto-save and keyboard shortcuts
- Mobile-responsive design

## Technical Architecture

### Frontend
- **Framework**: Vanilla JavaScript (no complex dependencies)
- **Styling**: Tailwind CSS with custom animations
- **PWA**: Service worker, offline support, installable
- **Mobile**: Touch gestures, haptic feedback, responsive design

### Backend
- **Server**: Node.js with Express
- **Database**: SQLite (easily upgradeable to PostgreSQL)
- **File Storage**: Local uploads with Sharp image processing
- **Sessions**: Express sessions for admin authentication

### Key Features
- **Auto-publish**: Cron job for midnight Central Time publishing
- **Image Processing**: Auto-resize to 9:16 aspect ratio
- **Analytics**: Real-time tracking without user accounts
- **Security**: BCrypt password hashing, session management
- **Performance**: Image optimization, caching, lazy loading

## Deployment Options

### Simple Hosting
- Upload to any web hosting service with Node.js support
- Configure environment variables for production
- Set up SSL certificate for HTTPS (required for NFC on some devices)

### Cloud Platforms
- **Vercel/Netlify**: Frontend + serverless functions
- **Railway/Render**: Full-stack deployment
- **DigitalOcean/AWS**: VPS deployment

### Custom Domain
- Point domain to your hosting service
- Update NFC tags with new domain
- Configure domain in admin settings

## Customization

### Church Branding
- Update colors in `tailwind.config.js`
- Replace logo/icons in `/public/icons/`
- Modify church name in admin dashboard
- Customize footer attribution

### Content Management
- Import verses from CSV files
- Connect to Bible APIs for automatic content
- Set up automated backups
- Configure multiple admin accounts

## Scaling Considerations

### For Multiple Churches
- White-label configuration
- Multi-tenant database structure
- Church-specific subdomains
- Centralized management dashboard

### High Traffic
- Database upgrade to PostgreSQL
- CDN for image delivery
- Redis for session storage
- Load balancing for multiple servers

## Support

- **Documentation**: See `/docs` folder for detailed guides
- **Issues**: Report bugs via GitHub issues
- **Features**: Submit feature requests for future phases

## License

MIT License - Feel free to modify and distribute for your church's needs.

---

**Built with ❤️ for spiritual communities worldwide**