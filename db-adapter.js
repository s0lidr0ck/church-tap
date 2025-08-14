// PostgreSQL adapter with table name translation
// - Maps legacy table names to CT_ prefixed equivalents for multi-tenant support
// - Converts '?' placeholders to $1, $2, ... for PostgreSQL compatibility
// - Exposes get/all/run methods with sqlite-like callback interface

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!DATABASE_URL) {
  throw new Error('[db-adapter] DATABASE_URL is required. Set it to your PostgreSQL connection string.');
}

// Initialize PostgreSQL connection pool
const pool = new Pool({ 
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

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
  const text = translate(sql);
  return pool.query(text, params || []);
}

module.exports = {
  get(sql, params, cb) {
    query(sql, params)
      .then((res) => cb(null, res.rows[0]))
      .catch((err) => cb(err));
  },
  all(sql, params, cb) {
    query(sql, params)
      .then((res) => cb(null, res.rows))
      .catch((err) => cb(err));
  },
  run(sql, params, cb) {
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
  },
  // Expose direct query for advanced cases
  _query: query,
  _pool: pool
};


