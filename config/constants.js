const BIBLE_VERSIONS = [
  { code: 'NIV', name: 'New International Version' },
  { code: 'NLT', name: 'New Living Translation' },
  { code: 'ESV', name: 'English Standard Version' },
  { code: 'KJV', name: 'King James Version' },
  { code: 'NASB', name: 'New American Standard Bible' },
  { code: 'CSB', name: 'Christian Standard Bible' },
  { code: 'MSG', name: 'The Message' },
  { code: 'AMP', name: 'Amplified Bible' }
];

module.exports = {
  PORT: process.env.PORT || 3000,
  JWT_SECRET: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this',
  SESSION_SECRET: process.env.SESSION_SECRET || 'your-secret-key-change-this',
  NODE_ENV: process.env.NODE_ENV || 'development',
  BIBLE_VERSIONS
};
