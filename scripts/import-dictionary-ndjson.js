// Import exported MyBible dictionary NDJSON into Postgres.
// Usage:
//   DATABASE_URL=... node scripts/import-dictionary-ndjson.js --dir exports/mybible/eastons.dct --source-key eastons.dct
//   DATABASE_URL=... node scripts/import-dictionary-ndjson.js --all --base-dir exports/mybible

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
    else if (a === '--source-key') out.sourceKey = args[++i];
    else if (a === '--database-url') out.databaseUrl = args[++i];
    else if (a === '--schema') out.schema = args[++i];
    else if (a === '--fail-fast') out.continueOnError = false;
  }
  if (!out.all && !out.dir) {
    throw new Error('Missing --dir (e.g. --dir exports/mybible/eastons.dct) or pass --all');
  }
  return out;
}

function hasPlaceholderUrl(url) {
  if (!url) return false;
  return /USER:PASSWORD@HOST:PORT\/DBNAME/i.test(url);
}

function buildPgConfig({ databaseUrl }) {
  const url = databaseUrl || process.env.DATABASE_URL;
  if (url && hasPlaceholderUrl(url)) {
    throw new Error('DATABASE_URL looks like a placeholder. Set it to your real Postgres URL.');
  }
  if (url) {
    try {
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
    return { connectionString: url, ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined };
  }
  const host = process.env.PGHOST;
  const database = process.env.PGDATABASE;
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD;
  const port = process.env.PGPORT ? Number(process.env.PGPORT) : undefined;
  if (!host || !database || !user) {
    throw new Error('DATABASE_URL is required (or set PGHOST/PGDATABASE/PGUSER[/PGPASSWORD]).');
  }
  const sslMode = (process.env.PGSSLMODE || '').toLowerCase();
  const shouldUseSsl =
    process.env.NODE_ENV === 'production' ||
    sslMode === 'require' ||
    sslMode === 'prefer' ||
    sslMode === 'no-verify';
  return { host, database, user, password, port, ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined };
}

function qname(schema, table) {
  const safeSchema = String(schema || 'public').replace(/"/g, '""');
  const safeTable = String(table).replace(/"/g, '""');
  return `"${safeSchema}"."${safeTable}"`;
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

async function preflight(client, schema) {
  await client.query(`SET search_path TO "${String(schema).replace(/"/g, '""')}", public`);
  const chk = await client.query(
    `SELECT to_regclass($1) AS sources, to_regclass($2) AS entries`,
    [`${schema}.ct_dictionary_sources`, `${schema}.ct_dictionary_entries`]
  );
  const { sources, entries } = chk.rows?.[0] || {};
  if (!sources || !entries) {
    throw new Error(`Missing dictionary tables. Run migration 030_create_dictionary_tables.sql first.`);
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
    righttoleft: details.righttoleft ?? null,
    customcss: details.customcss ?? null,
  };
  const strongFlag = details.strong === 1 || details.strong === true;
  const sql = `
    INSERT INTO ${qname(schema, 'ct_dictionary_sources')}
      (source_key, title, abbreviation, description, author, version, language, is_strongs, metadata, updated_at)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW())
    ON CONFLICT (source_key) DO UPDATE SET
      title = EXCLUDED.title,
      abbreviation = EXCLUDED.abbreviation,
      description = EXCLUDED.description,
      author = EXCLUDED.author,
      version = EXCLUDED.version,
      language = EXCLUDED.language,
      is_strongs = EXCLUDED.is_strongs,
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
    strongFlag,
    JSON.stringify(metadata),
  ]);
  return res.rows[0].id;
}

async function flushEntries(client, sourceId, batch, schema) {
  if (!batch.length) return;
  const values = [];
  const params = [];
  let p = 1;
  for (const row of batch) {
    values.push(`($${p++}, $${p++}, $${p++}, $${p++})`);
    params.push(sourceId, row.word, row.relative_order, row.content);
  }
  const sql = `
    INSERT INTO ${qname(schema, 'ct_dictionary_entries')}
      (source_id, word, relative_order, content)
    VALUES
      ${values.join(',\n      ')}
    ON CONFLICT (source_id, word, COALESCE(relative_order, 0))
    DO UPDATE SET
      content = EXCLUDED.content,
      updated_at = NOW()
  `;
  await client.query(sql, params);
}

async function importFromDir(client, dirPath, opts) {
  const { schema, sourceKey: sourceKeyArg } = opts;
  const detailsPath = path.join(dirPath, 'details.json');
  const dictionaryPath = path.join(dirPath, 'dictionary.ndjson');
  if (!isFile(detailsPath) || !isFile(dictionaryPath)) {
    console.log(`Skipping ${dirPath} (missing details.json or dictionary.ndjson)`);
    return { ok: true, skipped: true, dir: dirPath };
  }
  const details = JSON.parse(fs.readFileSync(detailsPath, 'utf8'));
  const folderName = path.basename(dirPath);
  const sourceKey = sourceKeyArg || folderName;

  await client.query('BEGIN');
  try {
    const sourceId = await upsertSource(client, details, sourceKey, schema);
    console.log(`Upserted dictionary source ${sourceKey} (id=${sourceId})`);

    let batch = [];
    let total = 0;
    const batchSize = 1000;
    const rl = readline.createInterface({
      input: fs.createReadStream(dictionaryPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const row = JSON.parse(trimmed);
      batch.push({
        word: String(row.word ?? ''),
        relative_order: row.relative_order === null || row.relative_order === undefined ? null : Number(row.relative_order),
        content: String(row.content ?? ''),
      });
      if (batch.length >= batchSize) {
        await flushEntries(client, sourceId, batch, schema);
        total += batch.length;
        batch = [];
        if (total % 20000 === 0) console.log(`… ${sourceKey}: imported ${total} rows`);
      }
    }
    if (batch.length) {
      await flushEntries(client, sourceId, batch, schema);
      total += batch.length;
    }

    await client.query('COMMIT');
    console.log(`${sourceKey}: imported ${total} dictionary rows`);
    return { ok: true, skipped: false, dir: dirPath, sourceKey };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

async function main() {
  const { dir, all, baseDir, sourceKey, databaseUrl, schema, continueOnError } = parseArgs();

  const client = new Client(buildPgConfig({ databaseUrl }));
  await client.connect();
  try {
    await preflight(client, schema);

    if (all) {
      const dirs = listImportDirs(baseDir);
      console.log(`Bulk dictionary import: scanning ${dirs.length} folders under ${baseDir}`);
      const failures = [];
      let imported = 0;
      let skipped = 0;
      for (const d of dirs) {
        try {
          const res = await importFromDir(client, d, { schema, sourceKey: null });
          if (res.skipped) skipped += 1;
          else imported += 1;
        } catch (e) {
          failures.push({ dir: d, error: e?.message || String(e) });
          console.error(`❌ Failed importing ${d}:`, e?.message || e);
          if (!continueOnError) throw e;
        }
      }
      console.log(`Bulk dictionary import complete: imported=${imported}, skipped=${skipped}, failed=${failures.length}`);
      if (failures.length) {
        console.log('Failures:');
        for (const f of failures) console.log(`- ${f.dir}: ${f.error}`);
      }
      return;
    }

    const absDir = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
    await importFromDir(client, absDir, { schema, sourceKey });
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('❌ Dictionary import failed:', e?.message || e);
    process.exitCode = 1;
  });
}

