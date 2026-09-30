// Shared plumbing for every data connector: errors, fetch with timeout,
// and a small Airtable client. Server-only.

export class SourceError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'SourceError';
    this.missingConfig = !!detail.missingConfig;
    this.hint = detail.hint || '';
    this.status = detail.status || 0;
    this.detail = detail;
  }
}

export const unconfigured = (what, hint) => new SourceError(`${what} is not connected.`, { missingConfig: true, hint });

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * fetch() that gives up after `timeoutMs`, parses JSON and throws SourceError
 * on non-2xx. A 429 or 5xx is retried up to `retries` times with backoff
 * (Retry-After honoured, capped at 10s) so one rate-limit hit does not blank
 * a whole source. Only idempotent GETs are retried unless `retryAll` is set.
 */
export async function fetchJson(url, { headers = {}, timeoutMs = 25000, method = 'GET', body, label = 'upstream', retries = 2, retryAll = false, _sleep = sleep } = {}) {
  let attempt = 0;
  for (;;) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, { method, headers, body, signal: ctrl.signal, cache: 'no-store' });
    } catch (e) {
      clearTimeout(timer);
      const timedOut = e && e.name === 'AbortError';
      throw new SourceError(`${label}: ${timedOut ? `timed out after ${Math.round(timeoutMs / 1000)}s` : (e.message || 'network error')}`, { timedOut });
    }
    clearTimeout(timer);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (res.ok) return json;
    const retryable = RETRY_STATUSES.has(res.status) && (method === 'GET' || retryAll) && attempt < retries;
    if (retryable) {
      const ra = Number(res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : 0);
      const wait = Math.min(10000, (Number.isFinite(ra) && ra > 0 ? ra * 1000 : 400 * 2 ** attempt));
      attempt++;
      await _sleep(wait);
      continue;
    }
    const msg = json?.error?.message || json?.error?.type || json?.message || text.slice(0, 300) || `${res.status}`;
    throw new SourceError(`${label}: ${res.status} ${msg}${attempt ? ` (after ${attempt} retr${attempt === 1 ? 'y' : 'ies'})` : ''}`, { status: res.status, body: json ?? text.slice(0, 500) });
  }
}

/* ---------------------------------------------------------------------------
 * Airtable
 * ------------------------------------------------------------------------ */

const AT = 'https://api.airtable.com/v0';

export function airtableToken(envNames = ['AIRTABLE_API_KEY']) {
  for (const n of envNames) if (process.env[n]) return process.env[n];
  return '';
}

/**
 * List records, following pagination. `params` may include fields (array),
 * filterByFormula, sort (array of {field, direction}), view, maxRecords, pageSize.
 * Caps at 200 pages (20k rows) so a runaway table can never hang a request.
 */
export async function airtableList({ token, baseId, table, params = {}, label = 'Airtable', maxPages = 200 }) {
  if (!token) throw unconfigured(label, 'Set the Airtable token in Vercel.');
  if (!baseId) throw unconfigured(label, 'Set the Airtable base id in Vercel.');
  const rows = [];
  let offset;
  let pages = 0;
  do {
    const qs = new URLSearchParams();
    qs.set('pageSize', String(params.pageSize || 100));
    if (params.maxRecords) qs.set('maxRecords', String(params.maxRecords));
    if (params.filterByFormula) qs.set('filterByFormula', params.filterByFormula);
    if (params.view) qs.set('view', params.view);
    if (params.cellFormat) qs.set('cellFormat', params.cellFormat);
    if (params.timeZone) qs.set('timeZone', params.timeZone);
    if (params.userLocale) qs.set('userLocale', params.userLocale);
    for (const f of params.fields || []) qs.append('fields[]', f);
    (params.sort || []).forEach((s, i) => {
      qs.set(`sort[${i}][field]`, s.field);
      if (s.direction) qs.set(`sort[${i}][direction]`, s.direction);
    });
    if (offset) qs.set('offset', offset);
    const body = await fetchJson(`${AT}/${baseId}/${encodeURIComponent(table)}?${qs}`, {
      headers: { Authorization: `Bearer ${token}` }, label,
    });
    rows.push(...(body.records || []));
    offset = body.offset;
    pages++;
  } while (offset && pages < maxPages);
  return rows;
}

/** Like airtableList but a missing table (404/403) resolves to null instead of throwing. */
export async function airtableListOptional(opts) {
  try {
    return await airtableList(opts);
  } catch (e) {
    if (e instanceof SourceError && (e.status === 404 || e.status === 403 || e.status === 422)) return null;
    throw e;
  }
}

/** Base schema: [{ id, name, fields: [{ id, name, type, options }] }]. */
export async function airtableTables({ token, baseId, label = 'Airtable' }) {
  const body = await fetchJson(`${AT}/meta/bases/${baseId}/tables`, { headers: { Authorization: `Bearer ${token}` }, label });
  return body.tables || [];
}

/** Create a table in a base (needs schema.bases:write on the token). */
export async function airtableCreateTable({ token, baseId, name, description, fields, label = 'Airtable' }) {
  return fetchJson(`${AT}/meta/bases/${baseId}/tables`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, fields }),
    label,
  });
}

/** Create records in chunks of 10. */
export async function airtableCreate({ token, baseId, table, records, label = 'Airtable', typecast = true }) {
  const out = [];
  for (let i = 0; i < records.length; i += 10) {
    const body = await fetchJson(`${AT}/${baseId}/${encodeURIComponent(table)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: records.slice(i, i + 10), typecast }),
      label,
    });
    out.push(...(body.records || []));
  }
  return out;
}

/** Escape a string for use inside an Airtable formula string literal. */
export const formulaString = (s) => `"${String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** A single-select / lookup value as plain text. */
export const selectText = (v) => (v == null ? '' : typeof v === 'object' ? (v.name ?? '') : Array.isArray(v) ? String(v[0] ?? '') : String(v));

export const asNumber = (v) => (v == null || v === '' ? 0 : Number(v) || 0);
