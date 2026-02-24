require('dotenv').config();
const { Pool } = require('pg');
const { S3Client, ListBucketsCommand } = require('@aws-sdk/client-s3');

async function testSystemLinking() {
  console.log('🔍 Testing System Linking Status...\n');
  
  let allLinked = true;
  
  // Test 1: PostgreSQL Connection
  console.log('1️⃣ Testing PostgreSQL Connection...');
  try {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as current_time');
    console.log('   ✅ PostgreSQL Connected!');
    console.log(`   📅 Server Time: ${result.rows[0].current_time}`);
    
    // Check if tables exist
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    console.log(`   📊 Tables Found: ${tablesResult.rows.length}`);
    if (tablesResult.rows.length > 0) {
      console.log(`   📋 Sample Tables: ${tablesResult.rows.slice(0, 5).map(r => r.table_name).join(', ')}`);
    }
    
    client.release();
    await pool.end();
  } catch (err) {
    console.log('   ❌ PostgreSQL Connection Failed!');
    console.log(`   Error: ${err.message}`);
    allLinked = false;
  }
  
  console.log('');
  
  // Test 2: S3 Connection
  console.log('2️⃣ Testing AWS S3 Connection...');
  try {
    const s3Client = new S3Client({
      region: process.env.S3_REGION || 'us-east-1'
    });
    
    const command = new ListBucketsCommand({});
    const response = await s3Client.send(command);
    
    console.log('   ✅ S3 Connected!');
    console.log(`   🪣 Buckets Accessible: ${response.Buckets ? response.Buckets.length : 0}`);
    
    const targetBucket = process.env.S3_BUCKET_NAME || 'churchtap';
    const bucketExists = response.Buckets?.some(b => b.Name === targetBucket);
    
    if (bucketExists) {
      console.log(`   ✅ Target Bucket "${targetBucket}" Found!`);
    } else {
      console.log(`   ⚠️  Target Bucket "${targetBucket}" Not Found`);
      console.log(`   Available: ${response.Buckets?.map(b => b.Name).join(', ') || 'None'}`);
    }
  } catch (err) {
    console.log('   ❌ S3 Connection Failed!');
    console.log(`   Error: ${err.message}`);
    allLinked = false;
  }
  
  console.log('');
  console.log('━'.repeat(50));
  
  if (allLinked) {
    console.log('🎉 YES! WE ARE LINKED! 🎉');
    console.log('All systems are connected and ready!');
  } else {
    console.log('⚠️  NOT FULLY LINKED YET');
    console.log('Some connections failed. Check errors above.');
  }
  
  console.log('━'.repeat(50));
  
  process.exit(allLinked ? 0 : 1);
}

testSystemLinking().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
