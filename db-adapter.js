// PostgreSQL adapter for Church Tap
// - Converts '?' placeholders to $1, $2, ... for PostgreSQL compatibility
// - Exposes get/all/run methods with sqlite-like callback interface

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('[db-adapter] DATABASE_URL is required. Set it to your PostgreSQL connection string.');
}

// Initialize PostgreSQL connection pool
const pool = new Pool({ 
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});


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
  return translatePlaceholders(sql);
}

async function query(sql, params) {
  const text = translate(sql);
  return pool.query(text, params || []);
}

module.exports = {
  get(sql, params, cb) {
    if (typeof cb !== 'function') return;
    query(sql, params)
      .then((res) => cb(null, res.rows[0]))
      .catch((err) => cb(err));
  },
  all(sql, params, cb) {
    if (typeof cb !== 'function') return;
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


