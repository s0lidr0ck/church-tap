require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../db-adapter');

console.log('🔧 Setting up initial data for PostgreSQL database...');

async function setupInitialData() {
  console.log('🚀 Setting up initial data...');

  try {
    // Check if organizations exist
    const existingOrg = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM organizations LIMIT 1', [], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!existingOrg) {
      // Create default organization
      const orgId = await new Promise((resolve, reject) => {
        db.run(`
          INSERT INTO organizations (
            name, subdomain, contact_email, plan_type, is_active,
            settings, features, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [
          process.env.CHURCH_NAME || 'Church Tap Demo',
          'demo',
          'admin@church.local',
          'premium',
          1,
          JSON.stringify({
            theme: 'default',
            features: { community: true, analytics: true, users: true }
          }),
          JSON.stringify(['verses', 'community', 'analytics', 'users'])
        ], function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        });
      });

      console.log(`✅ Created default organization (ID: ${orgId})`);
    } else {
      console.log('✅ Organization already exists');
    }

    // Check if master admin exists
    const existingMaster = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM master_admins LIMIT 1', [], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!existingMaster) {
      // Create master admin
      const masterPassword = process.env.MASTER_ADMIN_PASSWORD || 'master123';
      const hashedPassword = await bcrypt.hash(masterPassword, 12);
      
      await new Promise((resolve, reject) => {
        db.run(`
          INSERT INTO master_admins (
            username, password_hash, email, role, is_active, created_at
          ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [
          process.env.MASTER_ADMIN_USERNAME || 'master',
          hashedPassword,
          'master@church.local',
          'master',
          1
        ], function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        });
      });

      console.log(`✅ Created master admin (username: ${process.env.MASTER_ADMIN_USERNAME || 'master'})`);
    } else {
      console.log('✅ Master admin already exists');
    }

    // Check if regular admin exists for the organization
    const existingAdmin = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM admin_users WHERE organization_id = 1 LIMIT 1', [], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!existingAdmin) {
      // Create default admin for the organization
      const adminPassword = 'admin123';
      const hashedAdminPassword = await bcrypt.hash(adminPassword, 12);
      
      await new Promise((resolve, reject) => {
        db.run(`
          INSERT INTO admin_users (
            username, password_hash, email, role, organization_id, is_active, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [
          'admin',
          hashedAdminPassword,
          'admin@church.local',
          'admin',
          1,
          1
        ], function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        });
      });

      console.log('✅ Created default admin (username: admin, password: admin123)');
    } else {
      console.log('✅ Organization admin already exists');
    }

    // Create sample verse if none exist
    const existingVerse = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM verses WHERE organization_id = 1 LIMIT 1', [], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!existingVerse) {
      const today = new Date().toISOString().split('T')[0];
      
      await new Promise((resolve, reject) => {
        db.run(`
          INSERT INTO verses (
            date, content_type, verse_text, bible_reference, context, tags, 
            published, organization_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [
          today,
          'text',
          'For I know the plans I have for you, declares the Lord, plans for welfare and not for evil, to give you a future and a hope.',
          'Jeremiah 29:11',
          'This verse reminds us that God has good plans for our lives, even when we face uncertainty.',
          'hope, future, trust, faith, comfort',
          1,
          1
        ], function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        });
      });

      console.log('✅ Created sample verse for today');
    } else {
      console.log('✅ Verses already exist');
    }

    console.log('\n🎉 Initial setup complete!');
    console.log('\n📝 Login Details:');
    console.log(`   Master Admin: ${process.env.MASTER_ADMIN_USERNAME || 'master'} / ${process.env.MASTER_ADMIN_PASSWORD || 'master123'}`);
    console.log('   Organization Admin: admin / admin123');
    console.log('\n🌐 Access URLs:');
    console.log('   App: http://localhost:3000/');
    console.log('   Admin: http://localhost:3000/admin');
    console.log('   Master: http://localhost:3000/master');

  } catch (error) {
    console.error('❌ Setup failed:', error);
    process.exit(1);
  }
}

// Run setup
setupInitialData().then(() => {
  console.log('\n✅ Setup completed successfully!');
  process.exit(0);
}).catch(error => {
  console.error('❌ Setup failed:', error);
  process.exit(1);
});