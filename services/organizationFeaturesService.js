const { db } = require('../config/database');
const { BIBLE_VERSIONS } = require('../config/constants');

const DEFAULTS = Object.freeze({
  prayer_requests_enabled: true,
  praise_reports_enabled: true,
  insights_enabled: true,
  verse_commentary_enabled: true,
  anonymous_posts_enabled: true,
  group_calendar_enabled: true,
  group_links_enabled: true,
  topics_enabled: true,
  enabled_translations: null // null => all enabled
});

function normalizeEnabledTranslations(value) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return null;
  const cleaned = value
    .map(v => (typeof v === 'string' ? v.trim().toUpperCase() : ''))
    .filter(Boolean);
  // Allow empty array (meaning none enabled)
  return Array.from(new Set(cleaned));
}

function getAllTranslationCodes() {
  return (BIBLE_VERSIONS || []).map(v => v.code).filter(Boolean);
}

async function ensureRow(organizationId) {
  await db.query(
    `INSERT INTO ct_organization_features (organization_id)
     VALUES ($1)
     ON CONFLICT (organization_id) DO NOTHING`,
    [organizationId]
  );
}

async function getOrganizationFeatures(organizationId) {
  if (!organizationId) return { ...DEFAULTS };
  await ensureRow(organizationId);

  let result;
  try {
    result = await db.query(
      `SELECT organization_id,
              prayer_requests_enabled,
              praise_reports_enabled,
              insights_enabled,
              verse_commentary_enabled,
              anonymous_posts_enabled,
              group_calendar_enabled,
              group_links_enabled,
              topics_enabled,
              enabled_translations
       FROM ct_organization_features
       WHERE organization_id = $1`,
      [organizationId]
    );
  } catch (e) {
    // Backwards-compatible: older DBs may not have topics_enabled yet.
    // If so, re-query without it and fail-open to DEFAULTS.
    if (e && e.code === '42703') {
      result = await db.query(
        `SELECT organization_id,
                prayer_requests_enabled,
                praise_reports_enabled,
                insights_enabled,
                verse_commentary_enabled,
                anonymous_posts_enabled,
                group_calendar_enabled,
                group_links_enabled,
                enabled_translations
         FROM ct_organization_features
         WHERE organization_id = $1`,
        [organizationId]
      );
    } else {
      throw e;
    }
  }

  const row = result.rows[0];
  if (!row) return { ...DEFAULTS };

  return {
    ...DEFAULTS,
    ...row,
    enabled_translations: normalizeEnabledTranslations(row.enabled_translations)
  };
}

async function updateOrganizationFeatures(organizationId, patch) {
  if (!organizationId) throw new Error('organizationId is required');
  await ensureRow(organizationId);

  const allowedKeys = [
    'prayer_requests_enabled',
    'praise_reports_enabled',
    'insights_enabled',
    'verse_commentary_enabled',
    'anonymous_posts_enabled',
    'group_calendar_enabled',
    'group_links_enabled',
    // topics_enabled may not exist on older schemas; only update if present.
    'topics_enabled',
    'enabled_translations'
  ];

  const next = {};
  for (const k of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(patch || {}, k)) next[k] = patch[k];
  }

  if (Object.prototype.hasOwnProperty.call(next, 'enabled_translations')) {
    next.enabled_translations = normalizeEnabledTranslations(next.enabled_translations);
    // If a group submits translations not in our catalog, keep them (future-proof),
    // but UI will only surface known codes.
  }

  const sets = [];
  const values = [];
  let idx = 1;
  for (const [k, v] of Object.entries(next)) {
    sets.push(`${k} = $${idx++}`);
    values.push(v);
  }

  if (sets.length === 0) {
    return await getOrganizationFeatures(organizationId);
  }

  values.push(organizationId);
  try {
    await db.query(
      `UPDATE ct_organization_features
       SET ${sets.join(', ')}, updated_at = NOW()
       WHERE organization_id = $${idx}`,
      values
    );
  } catch (e) {
    // If schema doesn't have topics_enabled yet, strip it and retry.
    if (e && e.code === '42703' && Object.prototype.hasOwnProperty.call(next, 'topics_enabled')) {
      const retryNext = { ...next };
      delete retryNext.topics_enabled;
      const retrySets = [];
      const retryValues = [];
      let retryIdx = 1;
      for (const [k, v] of Object.entries(retryNext)) {
        retrySets.push(`${k} = $${retryIdx++}`);
        retryValues.push(v);
      }
      if (retrySets.length === 0) return await getOrganizationFeatures(organizationId);
      retryValues.push(organizationId);
      await db.query(
        `UPDATE ct_organization_features
         SET ${retrySets.join(', ')}, updated_at = NOW()
         WHERE organization_id = $${retryIdx}`,
        retryValues
      );
    } else {
      throw e;
    }
  }

  return await getOrganizationFeatures(organizationId);
}

function isTranslationEnabled(features, translationCode) {
  const code = (translationCode || '').toString().trim().toUpperCase();
  if (!code) return false;
  const enabled = features?.enabled_translations;
  if (enabled === null || enabled === undefined) return true;
  return Array.isArray(enabled) ? enabled.includes(code) : true;
}

function getTranslationCatalog() {
  return (BIBLE_VERSIONS || []).map(v => ({ code: v.code, name: v.name }));
}

function getEffectiveEnabledTranslations(features) {
  const all = getAllTranslationCodes();
  const enabled = features?.enabled_translations;
  if (enabled === null || enabled === undefined) return all;
  return Array.isArray(enabled) ? enabled.filter(c => all.includes(c)) : all;
}

module.exports = {
  DEFAULTS,
  getOrganizationFeatures,
  updateOrganizationFeatures,
  isTranslationEnabled,
  getTranslationCatalog,
  getEffectiveEnabledTranslations
};


