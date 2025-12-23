// Import exported MyBible commentary NDJSON into Postgres.
// Usage:
//   DATABASE_URL=... node scripts/import-commentary-ndjson.js --dir exports/mybible/clarke.cmt
//   DATABASE_URL=... node scripts/import-commentary-ndjson.js --all --base-dir exports/mybible
//
// Files expected in --dir:
//   - details.json
//   - commentary.ndjson
// Optional:
//   - assets.ndjson (only if you exported with --include-assets)

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Client } = require('pg');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    dir: null,
    all: false,
    baseDir: 'exports/mybible',
    includeAssets: false,
    sourceKey: null,
    databaseUrl: null,
    schema: 'public',
    continueOnError: true,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dir') out.dir = args[++i];
    else if (a === '--all') out.all = true;
    else if (a === '--base-dir') out.baseDir = args[++i];
    else if (a === '--include-assets') out.includeAssets = true;
    else if (a === '--source-key') out.sourceKey = args[++i];
    else if (a === '--database-url') out.databaseUrl = args[++i];
    else if (a === '--schema') out.schema = args[++i];
    else if (a === '--fail-fast') out.continueOnError = false;
  }
  if (!out.all && !out.dir) {
    throw new Error('Missing --dir (e.g. --dir exports/mybible/clarke.cmt) or pass --all');
  }
  return out;
}

function hasPlaceholderUrl(url) {
  if (!url) return false;
  return /USER:PASSWORD@HOST:PORT\/DBNAME/i.test(url);
}

function buildPgConfig({ databaseUrl }) {
  // Prefer DATABASE_URL / --database-url, but give a clear error if the value is a placeholder.
  const url = databaseUrl || process.env.DATABASE_URL;
  if (url && hasPlaceholderUrl(url)) {
    throw new Error(
      'DATABASE_URL looks like a placeholder. Set it to your real Postgres URL from DbGate (host/user/db/password).'
    );
  }

  // If a full URL is provided, pass it through as connectionString, but force SSL in production-ish cases.
  if (url) {
    // Validate early with WHATWG URL so we fail with a helpful message instead of a pg-connection-string crash.
    try {
      // Allow both postgres:// and postgresql://
      // eslint-disable-next-line no-new
      new URL(url.replace(/^postgresql:\/\//i, 'postgres://'));
    } catch (e) {
      throw new Error(`Invalid DATABASE_URL: ${e.message}`);
    }

    const sslModeMatch = url.match(/[?&]sslmode=([^&]+)/i);
    const sslMode = (sslModeMatch?.[1] || '').toLowerCase();
    const shouldUseSsl =
      process.env.NODE_ENV === 'production' ||
      sslMode === 'require' ||
      sslMode === 'prefer' ||
      sslMode === 'no-verify';

    return {
      connectionString: url,
      ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined,
    };
  }

  // Fallback to libpq-style env vars (useful if you don't want a URL):
  // PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD, PGSSLMODE
  const host = process.env.PGHOST;
  const database = process.env.PGDATABASE;
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD;
  const port = process.env.PGPORT ? Number(process.env.PGPORT) : undefined;

  if (!host || !database || !user) {
    throw new Error(
      'DATABASE_URL is required (or set PGHOST/PGDATABASE/PGUSER[/PGPASSWORD]).'
    );
  }

  const sslMode = (process.env.PGSSLMODE || '').toLowerCase();
  const shouldUseSsl =
    process.env.NODE_ENV === 'production' ||
    sslMode === 'require' ||
    sslMode === 'prefer' ||
    sslMode === 'no-verify';

  return {
    host,
    database,
    user,
    password,
    port,
    ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined,
  };
}

function qname(schema, table) {
  const safeSchema = String(schema || 'public').replace(/"/g, '""');
  const safeTable = String(table).replace(/"/g, '""');
  return `"${safeSchema}"."${safeTable}"`;
}

async function preflight(client, schema) {
  const res = await client.query(`
    SELECT
      current_database() AS db,
      current_user AS "user",
      current_schema() AS schema,
      current_setting('search_path') AS search_path
  `);
  const info = res.rows?.[0] || {};
  console.log(`Connected to db=${info.db} user=${info.user} schema=${info.schema}`);
  console.log(`search_path=${info.search_path}`);

  // Force search_path to include chosen schema first (helps when role has a custom search_path).
  await client.query(`SET search_path TO "${String(schema).replace(/"/g, '""')}", public`);

  const chk = await client.query(
    `SELECT to_regclass($1) AS sources, to_regclass($2) AS entries`,
    [`${schema}.ct_commentary_sources`, `${schema}.ct_commentary_entries`]
  );
  const { sources, entries } = chk.rows?.[0] || {};
  if (!sources || !entries) {
    const where = await client.query(
      `SELECT table_schema, table_name
       FROM information_schema.tables
       WHERE table_name IN ('ct_commentary_sources','ct_commentary_entries')
       ORDER BY table_schema, table_name`
    );
    console.log('Found tables:', where.rows);
    throw new Error(
      `Could not resolve ${schema}.ct_commentary_sources or ${schema}.ct_commentary_entries. ` +
        `Try --schema public (or the schema shown above).`
    );
  }
}

async function upsertSource(client, details, sourceKey, schema) {
  const metadata = {
    comments: details.comments ?? null,
    creator: details.creator ?? null,
    source: details.source ?? null,
    publisher: details.publisher ?? null,
    publishdate: details.publishdate ?? null,
    versiondate: details.versiondate ?? null,
    editorialcomments: details.editorialcomments ?? null,
    righttoleft: details.righttoleft ?? null,
    customcss: details.customcss ?? null,
  };

  const sql = `
    INSERT INTO ${qname(schema, 'ct_commentary_sources')}
      (source_key, title, abbreviation, description, author, version, language, metadata, updated_at)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
    ON CONFLICT (source_key) DO UPDATE SET
      title = EXCLUDED.title,
      abbreviation = EXCLUDED.abbreviation,
      description = EXCLUDED.description,
      author = EXCLUDED.author,
      version = EXCLUDED.version,
      language = EXCLUDED.language,
      metadata = EXCLUDED.metadata,
      updated_at = NOW()
    RETURNING id
  `;

  const res = await client.query(sql, [
    sourceKey,
    details.title ?? null,
    details.abbreviation ?? null,
    details.description ?? null,
    details.author ?? null,
    details.version ?? null,
    details.language ?? null,
    JSON.stringify(metadata),
  ]);
  return res.rows[0].id;
}

async function flushEntries(client, sourceId, batch, schema) {
  if (!batch.length) return;

  // Build VALUES list with parameter placeholders
  // (source_id, book, chapter, from_verse, to_verse, content)
  const values = [];
  const params = [];
  let p = 1;
  for (const row of batch) {
    values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
    params.push(sourceId, row.book, row.chapter, row.from_verse, row.to_verse, row.content);
  }

  const sql = `
    INSERT INTO ${qname(schema, 'ct_commentary_entries')}
      (source_id, book, chapter, from_verse, to_verse, content)
    VALUES
      ${values.join(',\n      ')}
    ON CONFLICT (source_id, book, chapter, from_verse, to_verse)
    DO UPDATE SET
      content = EXCLUDED.content,
      updated_at = NOW()
  `;

  await client.query(sql, params);
}

async function flushAssets(client, sourceId, batch, schema) {
  if (!batch.length) return;

  const values = [];
  const params = [];
  let p = 1;
  for (const row of batch) {
    values.push(`($${p++}, $${p++}, $${p++}, CASE WHEN $${p} IS NULL THEN NULL ELSE decode($${p}, 'base64') END)`);
    params.push(sourceId, row.asset_key ?? null, row.filename ?? null, row.content_b64 ?? null);
    p += 1;
  }

  const sql = `
    INSERT INTO ${qname(schema, 'ct_commentary_assets')}
      (source_id, asset_key, filename, content)
    VALUES
      ${values.join(',\n      ')}
    ON CONFLICT (source_id, asset_key)
    DO UPDATE SET
      filename = EXCLUDED.filename,
      content = EXCLUDED.content
  `;

  await client.query(sql, params);
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function listImportDirs(baseDir) {
  const absBase = path.isAbsolute(baseDir) ? baseDir : path.join(process.cwd(), baseDir);
  if (!fs.existsSync(absBase)) return [];
  return fs
    .readdirSync(absBase, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(absBase, d.name))
    .sort((a, b) => a.localeCompare(b));
}

async function importFromDir(client, dirPath, opts) {
  const { includeAssets, schema, sourceKey: sourceKeyArg } = opts;

  const detailsPath = path.join(dirPath, 'details.json');
  const commentaryPath = path.join(dirPath, 'commentary.ndjson');
  const assetsPath = path.join(dirPath, 'assets.ndjson');

  if (!isFile(detailsPath) || !isFile(commentaryPath)) {
    console.log(`Skipping ${dirPath} (missing details.json or commentary.ndjson)`);
    return { ok: true, skipped: true, dir: dirPath };
  }

  const details = JSON.parse(fs.readFileSync(detailsPath, 'utf8'));
  const folderName = path.basename(dirPath);
  const sourceKey = sourceKeyArg || folderName;

  await client.query('BEGIN');
  try {
    const sourceId = await upsertSource(client, details, sourceKey, schema);
    console.log(`Upserted source ${sourceKey} (id=${sourceId}) from ${folderName}`);

    // Import commentary entries in batches
    let batch = [];
    let total = 0;
    const batchSize = 500;
    const rl = readline.createInterface({
      input: fs.createReadStream(commentaryPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const row = JSON.parse(trimmed);
      batch.push({
        book: Number(row.book),
        chapter: Number(row.chapter),
        from_verse: Number(row.from_verse),
        to_verse: Number(row.to_verse),
        content: String(row.content ?? ''),
      });
      if (batch.length >= batchSize) {
        await flushEntries(client, sourceId, batch, schema);
        total += batch.length;
        batch = [];
        if (total % 5000 === 0) console.log(`… ${sourceKey}: imported ${total} rows`);
      }
    }
    if (batch.length) {
      await flushEntries(client, sourceId, batch, schema);
      total += batch.length;
    }
    console.log(`${sourceKey}: imported ${total} commentary rows`);

    if (includeAssets && isFile(assetsPath)) {
      let assetsBatch = [];
      let assetsTotal = 0;
      const assetsBatchSize = 200;
      const rl2 = readline.createInterface({
        input: fs.createReadStream(assetsPath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
      });
      for await (const line of rl2) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const row = JSON.parse(trimmed);
        assetsBatch.push({
          asset_key: row.asset_key ?? null,
          filename: row.filename ?? null,
          content_b64: row.content_b64 ?? null,
        });
        if (assetsBatch.length >= assetsBatchSize) {
          await flushAssets(client, sourceId, assetsBatch, schema);
          assetsTotal += assetsBatch.length;
          assetsBatch = [];
        }
      }
      if (assetsBatch.length) {
        await flushAssets(client, sourceId, assetsBatch, schema);
        assetsTotal += assetsBatch.length;
      }
      console.log(`${sourceKey}: imported ${assetsTotal} asset rows`);
    }

    await client.query('COMMIT');
    return { ok: true, skipped: false, dir: dirPath, sourceKey };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

async function main() {
  const {
    dir,
    all,
    baseDir,
    includeAssets,
    sourceKey: sourceKeyArg,
    databaseUrl,
    schema,
    continueOnError,
  } = parseArgs();

  const client = new Client(buildPgConfig({ databaseUrl }));
  await client.connect();

  try {
    await preflight(client, schema);

    if (all) {
      const dirs = listImportDirs(baseDir);
      if (!dirs.length) throw new Error(`No directories found under base dir: ${baseDir}`);

      console.log(`Bulk import: scanning ${dirs.length} folders under ${baseDir}`);
      const failures = [];
      let imported = 0;
      let skipped = 0;

      for (const d of dirs) {
        try {
          const res = await importFromDir(client, d, { includeAssets, schema, sourceKey: null });
          if (res.skipped) skipped += 1;
          else imported += 1;
        } catch (e) {
          failures.push({ dir: d, error: e?.message || String(e) });
          console.error(`❌ Failed importing ${d}:`, e?.message || e);
          if (!continueOnError) throw e;
        }
      }

      console.log(`Bulk import complete: imported=${imported}, skipped=${skipped}, failed=${failures.length}`);
      if (failures.length) {
        console.log('Failures:');
        for (const f of failures) console.log(`- ${f.dir}: ${f.error}`);
      }
      return;
    }

    // Single import
    const absDir = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
    await importFromDir(client, absDir, { includeAssets, schema, sourceKey: sourceKeyArg || null });
  } catch (err) {
    throw err;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    if (e?.code === '42P01') {
      console.error('❌ Import failed (missing table):', e.message);
      console.error('Make sure you ran the Postgres migration creating ct_commentary_sources/entries.');
    } else {
      console.error('❌ Import failed:', e);
    }
    process.exitCode = 1;
  });
}

