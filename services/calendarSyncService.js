const ical = require('node-ical');
const { db } = require('../config/database');

function normalizeBase64UrlToBase64(input) {
  return String(input || '')
    .trim()
    .replace(/-/g, '+')
    .replace(/_/g, '/');
}

function decodeCidToCalendarId(cid) {
  const raw = normalizeBase64UrlToBase64(cid);
  // pad base64 (length % 4)
  const padLen = raw.length % 4 === 0 ? 0 : (4 - (raw.length % 4));
  const padded = raw + '='.repeat(padLen);
  try {
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch (e) {
    return null;
  }
}

function normalizeGoogleIcsUrl(input) {
  const raw = (input || '').toString().trim();
  if (!raw) return null;

  // Already a direct ICS URL
  if (/^https?:\/\/calendar\.google\.com\/calendar\/ical\//i.test(raw) && /\.ics(\?.*)?$/i.test(raw)) {
    return raw;
  }

  // Try parse as URL to find ?cid=
  try {
    const u = new URL(raw);
    const cid = u.searchParams.get('cid');
    if (cid) {
      const calendarId = decodeCidToCalendarId(cid);
      if (!calendarId) return null;
      return `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
    }
  } catch (e) {
    // Not a URL, fallthrough
  }

  // If they paste a calendarId like c_xxx@group.calendar.google.com
  if (raw.includes('@') && !raw.includes('://')) {
    return `https://calendar.google.com/calendar/ical/${encodeURIComponent(raw)}/public/basic.ics`;
  }

  return null;
}

function toIsoMinuteKey(d) {
  // Stable enough for per-occurrence ids, avoids seconds jitter.
  const dt = new Date(d);
  if (!Number.isFinite(dt.getTime())) return null;
  dt.setSeconds(0, 0);
  return dt.toISOString();
}

async function fetchIcs(url, { etag, lastModified } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const headers = {};
    if (etag) headers['If-None-Match'] = etag;
    if (lastModified) headers['If-Modified-Since'] = lastModified;

    const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    if (res.status === 304) {
      return { status: 304, icsText: null, etag: etag || null, lastModified: lastModified || null };
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`ICS fetch failed (${res.status}): ${txt || res.statusText}`);
    }
    const icsText = await res.text();
    return {
      status: res.status,
      icsText,
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified')
    };
  } finally {
    clearTimeout(timeout);
  }
}

function collectEventsFromIcs(components, { windowStart, windowEnd }) {
  const items = [];
  const processedRecurringUids = new Set();

  const withinWindow = (d) => {
    const t = d?.getTime?.();
    if (!Number.isFinite(t)) return false;
    return t >= windowStart.getTime() && t <= windowEnd.getTime();
  };

  for (const key of Object.keys(components || {})) {
    const ev = components[key];
    if (!ev || ev.type !== 'VEVENT') continue;
    if (!ev.uid) continue;

    // Google public/basic.ics often comes "pre-expanded": a single VEVENT per UID with a
    // `recurrences` map (but no `rrule`). Expand those into individual occurrences.
    if (!ev.rrule && ev.recurrences && Object.keys(ev.recurrences).length > 0) {
      processedRecurringUids.add(ev.uid);

      const durationMs = (ev.end && ev.start) ? (new Date(ev.end).getTime() - new Date(ev.start).getTime()) : 0;
      const recurrences = ev.recurrences || {};
      const exdate = ev.exdate || {};

      for (const occKey of Object.keys(recurrences)) {
        const occ = recurrences[occKey];
        if (!occ) continue;
        const start = occ.start ? new Date(occ.start) : null;
        if (!start || !withinWindow(start)) continue;

        const k = toIsoMinuteKey(occ.recurrenceid || start) || occKey;
        if (exdate[k]) continue;

        const end = occ.end
          ? new Date(occ.end)
          : (durationMs ? new Date(start.getTime() + durationMs) : null);

        items.push({
          uid: `${ev.uid}::${k}`,
          parentUid: ev.uid,
          summary: (occ.summary ?? ev.summary ?? '').toString(),
          description: (occ.description ?? ev.description ?? '').toString(),
          location: (occ.location ?? ev.location ?? '').toString(),
          url: (occ.url ?? ev.url ?? '').toString(),
          start,
          end,
          allDay: !!(occ.datetype === 'date' || ev.datetype === 'date')
        });
      }

      continue;
    }

    // If this is an override VEVENT (RECURRENCE-ID) and we *also* have the RRULE parent,
    // we'll skip it here (it will be applied during expansion).
    if (ev.recurrenceid && processedRecurringUids.has(ev.uid)) {
      continue;
    }

    // Recurring parent (RRULE present)
    if (ev.rrule) {
      processedRecurringUids.add(ev.uid);

      const durationMs = (ev.end && ev.start) ? (new Date(ev.end).getTime() - new Date(ev.start).getTime()) : 0;
      const occurrences = ev.rrule.between(windowStart, windowEnd, true) || [];

      // node-ical stores overrides in ev.recurrences keyed by ISO string.
      const recurrences = ev.recurrences || {};
      const exdate = ev.exdate || {};

      for (const occStart of occurrences) {
        if (!withinWindow(occStart)) continue;
        const occKey = toIsoMinuteKey(occStart);
        if (!occKey) continue;

        if (exdate[occKey]) continue;

        const override = recurrences[occKey];
        const start = override?.start ? new Date(override.start) : new Date(occStart);
        const end = override?.end
          ? new Date(override.end)
          : (durationMs ? new Date(start.getTime() + durationMs) : null);

        const summary = (override?.summary ?? ev.summary ?? '').toString();
        const description = (override?.description ?? ev.description ?? '').toString();
        const location = (override?.location ?? ev.location ?? '').toString();
        const url = (override?.url ?? ev.url ?? '').toString();

        items.push({
          uid: `${ev.uid}::${occKey}`,
          parentUid: ev.uid,
          summary,
          description,
          location,
          url,
          start,
          end,
          allDay: !!(override?.datetype === 'date' || ev.datetype === 'date')
        });
      }

      continue;
    }

    // If feed is already expanded (Google basic.ics often emits RECURRENCE-ID instances),
    // treat RECURRENCE-ID entries as individual instances.
    if (ev.recurrenceid) {
      const start = new Date(ev.start);
      if (!withinWindow(start)) continue;
      items.push({
        uid: `${ev.uid}::${toIsoMinuteKey(ev.recurrenceid) || toIsoMinuteKey(start) || start.toISOString()}`,
        parentUid: ev.uid,
        summary: (ev.summary || '').toString(),
        description: (ev.description || '').toString(),
        location: (ev.location || '').toString(),
        url: (ev.url || '').toString(),
        start,
        end: ev.end ? new Date(ev.end) : null,
        allDay: !!(ev.datetype === 'date')
      });
      continue;
    }

    // One-off VEVENT
    const start = new Date(ev.start);
    if (!withinWindow(start)) continue;
    items.push({
      uid: ev.uid,
      parentUid: null,
      summary: (ev.summary || '').toString(),
      description: (ev.description || '').toString(),
      location: (ev.location || '').toString(),
      url: (ev.url || '').toString(),
      start,
      end: ev.end ? new Date(ev.end) : null,
      allDay: !!(ev.datetype === 'date')
    });
  }

  return items;
}

async function upsertExternalEvents({
  organizationId,
  integrationId,
  externalSource,
  externalEvents,
  syncStartedAt,
  windowStart,
  windowEnd
}) {
  let upserted = 0;

  for (const ev of externalEvents) {
    const title = (ev.summary || '').toString().trim() || 'Event';
    const description = (ev.description || '').toString().trim() || null;
    const location = (ev.location || '').toString().trim() || null;
    const link = (ev.url || '').toString().trim() || null;

    const startAt = ev.start;
    const endAt = ev.end || null;

    const externalUid = ev.uid;
    const externalParentUid = ev.parentUid || null;

    await db.query(
      `
      INSERT INTO ct_events (
        organization_id,
        title, description, location, address,
        start_at, end_at, all_day, link,
        is_active, notify_lead_minutes,
        is_recurring, recurrence_type, recurrence_interval, recurrence_days, recurrence_end_date,
        parent_event_id, instance_date, is_instance,
        external_source, external_uid, external_parent_uid, external_integration_id, external_last_seen_at,
        created_at, updated_at
      )
      VALUES (
        $1,
        $2, $3, $4, NULL,
        $5, $6, $7, $8,
        TRUE, 120,
        FALSE, NULL, 1, NULL, NULL,
        NULL, NULL, FALSE,
        $9, $10, $11, $12, $13,
        NOW(), NOW()
      )
      ON CONFLICT (organization_id, external_source, external_uid) WHERE external_uid IS NOT NULL
      DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        location = EXCLUDED.location,
        start_at = EXCLUDED.start_at,
        end_at = EXCLUDED.end_at,
        all_day = EXCLUDED.all_day,
        link = EXCLUDED.link,
        is_active = TRUE,
        external_parent_uid = EXCLUDED.external_parent_uid,
        external_integration_id = EXCLUDED.external_integration_id,
        external_last_seen_at = EXCLUDED.external_last_seen_at,
        updated_at = NOW()
      `,
      [
        organizationId,
        title,
        description,
        location,
        startAt,
        endAt,
        !!ev.allDay,
        link,
        externalSource,
        externalUid,
        externalParentUid,
        integrationId,
        syncStartedAt
      ]
    );
    upserted += 1;
  }

  // Deactivate previously-synced events in-window that were not seen this run
  const deactivatedResult = await db.query(
    `
    UPDATE ct_events
    SET is_active = FALSE, updated_at = NOW()
    WHERE organization_id = $1
      AND external_integration_id = $2
      AND start_at >= $3
      AND start_at <= $4
      AND (external_last_seen_at IS NULL OR external_last_seen_at < $5)
    `,
    [organizationId, integrationId, windowStart, windowEnd, syncStartedAt]
  );

  return { upserted, deactivated: deactivatedResult.rowCount || 0 };
}

async function syncCalendarIntegration(integrationRow) {
  const integration = integrationRow;
  if (!integration || integration.is_enabled === false) {
    return { success: true, skipped: true, reason: 'disabled' };
  }

  const provider = (integration.provider || 'google_ics').toString();
  const externalSource = provider; // keep same string for now
  const now = new Date();

  const windowBack = Math.max(0, parseInt(integration.sync_window_days_back ?? 14, 10) || 14);
  const windowAhead = Math.max(1, parseInt(integration.sync_window_days_ahead ?? 180, 10) || 180);
  const windowStart = new Date(now.getTime() - windowBack * 24 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + windowAhead * 24 * 60 * 60 * 1000);

  const syncStartedAt = new Date();

  try {
    const fetched = await fetchIcs(integration.ics_url, {
      etag: integration.last_etag,
      lastModified: integration.last_modified
    });

    if (fetched.status === 304) {
      await db.query(
        `
        UPDATE ct_organization_calendar_integrations
        SET last_synced_at = NOW(),
            last_sync_status = 'ok',
            last_sync_error = NULL,
            updated_at = NOW()
        WHERE id = $1
        `,
        [integration.id]
      );
      return { success: true, not_modified: true };
    }

    const components = ical.parseICS(fetched.icsText || '');
    const externalEvents = collectEventsFromIcs(components, { windowStart, windowEnd });

    const { upserted, deactivated } = await upsertExternalEvents({
      organizationId: integration.organization_id,
      integrationId: integration.id,
      externalSource,
      externalEvents,
      syncStartedAt,
      windowStart,
      windowEnd
    });

    await db.query(
      `
      UPDATE ct_organization_calendar_integrations
      SET last_synced_at = NOW(),
          last_sync_status = 'ok',
          last_sync_error = NULL,
          last_etag = $2,
          last_modified = $3,
          updated_at = NOW()
      WHERE id = $1
      `,
      [integration.id, fetched.etag || null, fetched.lastModified || null]
    );

    return {
      success: true,
      upserted,
      deactivated,
      fetched_events: externalEvents.length,
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString()
    };
  } catch (e) {
    const msg = (e && e.message) ? e.message : 'Calendar sync failed';
    console.error('Calendar sync error:', {
      integration_id: integration.id,
      organization_id: integration.organization_id,
      provider: integration.provider,
      error: msg
    });
    await db.query(
      `
      UPDATE ct_organization_calendar_integrations
      SET last_synced_at = NOW(),
          last_sync_status = 'error',
          last_sync_error = $2,
          updated_at = NOW()
      WHERE id = $1
      `,
      [integration.id, msg]
    );
    return { success: false, error: msg };
  }
}

async function syncAllEnabledCalendarIntegrations(limit = 25) {
  // Small limit to avoid long locks if many orgs are enabled.
  const result = await db.query(
    `
    SELECT *
    FROM ct_organization_calendar_integrations
    WHERE is_enabled = TRUE
    ORDER BY updated_at ASC
    LIMIT $1
    `,
    [limit]
  );

  const integrations = result.rows || [];
  const outcomes = [];
  for (const row of integrations) {
    // eslint-disable-next-line no-await-in-loop
    const out = await syncCalendarIntegration(row);
    outcomes.push({ id: row.id, organization_id: row.organization_id, provider: row.provider, ...out });
  }
  return { success: true, synced: outcomes.length, outcomes };
}

module.exports = {
  normalizeGoogleIcsUrl,
  syncCalendarIntegration,
  syncAllEnabledCalendarIntegrations
};

