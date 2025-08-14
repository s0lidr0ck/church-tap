// Lightweight DB adapter that supports both SQLite and PostgreSQL
// - For PostgreSQL: Rewrites table names to CT_ prefixed equivalents and converts placeholders
// - For SQLite: Uses direct SQLite3 with original table names
// - Exposes get/all/run with sqlite-like callbacks

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!DATABASE_URL) {
  throw new Error('[db-adapter] DATABASE_URL is required. Set it to your database connection string.');
}

// Detect database type
const isPostgreSQL = DATABASE_URL.startsWith('postgresql://') || DATABASE_URL.startsWith('postgres://');
const isSQLite = DATABASE_URL.startsWith('sqlite:');

let pool, sqlite3, db;

if (isPostgreSQL) {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: DATABASE_URL });
} else if (isSQLite) {
  sqlite3 = require('sqlite3').verbose();
  const dbPath = DATABASE_URL.replace('sqlite:', '');
  db = new sqlite3.Database(dbPath);
} else {
  throw new Error('[db-adapter] Unsupported database URL format. Use postgresql:// or sqlite: prefix.');
}

const tableMap = new Map([
  ['organizations', 'CT_organizations'],
  ['admin_users', 'CT_admin_users'],
  ['master_admins', 'CT_master_admins'],
  ['master_admin_activity', 'CT_master_admin_activity'],
  ['verses', 'CT_verses'],
  ['analytics', 'CT_analytics'],
  ['favorites', 'CT_favorites'],
  ['prayer_requests', 'CT_prayer_requests'],
  ['praise_reports', 'CT_praise_reports'],
  ['prayer_interactions', 'CT_prayer_interactions'],
  ['celebration_interactions', 'CT_celebration_interactions'],
  ['users', 'CT_users'],
  ['user_preferences', 'CT_user_preferences'],
  ['user_collections', 'CT_user_collections'],
  ['collection_verses', 'CT_collection_verses'],
  ['user_verse_history', 'CT_user_verse_history'],
  ['prayer_partnerships', 'CT_prayer_partnerships'],
  ['personal_prayer_requests', 'CT_personal_prayer_requests'],
  ['prayer_request_shares', 'CT_prayer_request_shares'],
  ['user_sessions', 'CT_user_sessions'],
]);

function translateTables(sql) {
  // Replace occurrences of table names when used as standalone identifiers
  // This is conservative: word boundary before and after and not part of quotes
  let out = sql;
  for (const [legacy, mapped] of tableMap.entries()) {
    const re = new RegExp(`\\b${legacy}\\b`, 'gi');
    out = out.replace(re, mapped);
  }
  return out;
}

function translatePlaceholders(sql) {
  // Replace each '?' with $1..$n, ignoring those inside single quotes
  let index = 0;
  let result = '';
  let inSingle = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      inSingle = !inSingle;
      result += ch;
      continue;
    }
    if (!inSingle && ch === '?') {
      index += 1;
      result += `$${index}`;
    } else {
      result += ch;
    }
  }
  return result;
}

function translate(sql) {
  return translatePlaceholders(translateTables(sql));
}

async function query(sql, params) {
  if (isPostgreSQL) {
    const text = translate(sql);
    return pool.query(text, params || []);
  } else {
    // For SQLite, use direct query without translation
    return new Promise((resolve, reject) => {
      const method = sql.trim().toLowerCase().startsWith('select') ? 'all' : 'run';
      db[method](sql, params || [], function(err, rows) {
        if (err) {
          reject(err);
        } else {
          resolve({
            rows: rows || [],
            rowCount: this ? this.changes : (rows ? rows.length : 0),
            lastID: this ? this.lastID : null
          });
        }
      });
    });
  }
}

module.exports = {
  get(sql, params, cb) {
    if (isSQLite) {
      // Direct SQLite query
      db.get(sql, params || [], cb);
    } else {
      // PostgreSQL query with translation
      query(sql, params)
        .then((res) => cb(null, res.rows[0]))
        .catch((err) => cb(err));
    }
  },
  all(sql, params, cb) {
    if (isSQLite) {
      // Direct SQLite query
      db.all(sql, params || [], cb);
    } else {
      // PostgreSQL query with translation
      query(sql, params)
        .then((res) => cb(null, res.rows))
        .catch((err) => cb(err));
    }
  },
  run(sql, params, cb) {
    if (isSQLite) {
      // Direct SQLite query
      db.run(sql, params || [], cb);
    } else {
      // PostgreSQL query with translation and RETURNING clause
      const isInsert = /^\s*insert\s+into/i.test(sql);
      const needsReturning = isInsert && !/returning\s+\w+/i.test(sql);
      const sqlWithReturning = needsReturning ? `${sql} RETURNING id` : sql;
      query(sqlWithReturning, params)
        .then((res) => {
          const context = {
            lastID: isInsert ? (res.rows?.[0]?.id ?? null) : null,
            changes: typeof res.rowCount === 'number' ? res.rowCount : null,
          };
          if (typeof cb === 'function') cb.call(context, null);
        })
        .catch((err) => {
          if (typeof cb === 'function') cb(err);
        });
    }
  },
  // Expose direct query for advanced cases
  _query: query,
  _pool: pool,
  _db: db
};


