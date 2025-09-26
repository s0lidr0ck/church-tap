const { Pool } = require('pg');

// Database configuration
const dbConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
};

// Create the database connection pool
const db = new Pool(dbConfig);

// Test the connection
db.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to PostgreSQL database:', err);
    process.exit(1);
  } else {
    console.log('✅ Connected to PostgreSQL database');
    release();
  }
});

// Database query helper function
const dbQuery = async (text, params) => {
  try {
    const result = await db.query(text, params);
    return result;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
};

// SQLite-style callback interface for compatibility
dbQuery.get = (query, params, callback) => {
  db.query(query, params)
    .then(result => {
      if (result.rows.length > 0) {
        callback(null, result.rows[0]);
      } else {
        callback(null, null);
      }
    })
    .catch(err => {
      callback(err, null);
    });
};

dbQuery.all = (query, params, callback) => {
  db.query(query, params)
    .then(result => {
      callback(null, result.rows);
    })
    .catch(err => {
      callback(err, null);
    });
};

dbQuery.run = (query, params, callback) => {
  db.query(query, params)
    .then(result => {
      callback(null, { changes: result.rowCount, lastID: result.insertId });
    })
    .catch(err => {
      callback(err, null);
    });
};

module.exports = { db, dbQuery };
