// Pure helpers behind the external read API (/api/v1/*): flatten the
// dashboard payload into one row per metric, build a per-day series from the
// normalised datasets, serialise rows as RFC 4180 CSV, and validate a
// from/to range. No I/O, no clock: `today` is always passed in.

import { SECTIONS, ALL_ROW_IDS, ROW_BY_ID } from './catalog.js';
import { sectionValues } from './compute.js';
import { isISODate, addDays, daysBetween, eachDay } from './dates.js';

/** Range ids copied onto every flat row, in column order. */
export const FLAT_RANGE_IDS = ['today', 'yesterday', 'l7d', 'l30d', 'mtd', 'lastMonth', 'w1', 'w2', 'w3', 'w4', 'w5'];

/** Column order of the flat rows shape. */
export const FLAT_COLUMNS = ['section', 'id', 'label', 'unit', ...FLAT_RANGE_IDS, 'target', 'pace', 'status'];

/** Section ids a caller may ask for with ?section= (the CEO section included). */
export const SECTION_IDS = SECTIONS.map(s => s.id);

/** Row ids that only exist in the CEO section (hidden when the CEO section is locked). */
export const CEO_ONLY_IDS = (() => {
  const elsewhere = new Set(SECTIONS.filter(s => !s.ceoOnly).flatMap(s => s.rows.map(r => r.id)));
  return SECTIONS.filter(s => s.ceoOnly).flatMap(s => s.rows.map(r => r.id)).filter(id => !elsewhere.has(id));
})();

/**
 * Extra ids sectionValues() computes that are not catalog rows but are useful
 * in a daily export (totals the CEO rows are built from).
 */
export const EXTRA_DAILY_IDS = ['ad_spend_total', 'business_costs', 'uncategorised_costs'];

/** Every id /api/v1/daily accepts, in catalog order. */
export const DAILY_IDS = [...ALL_ROW_IDS, ...EXTRA_DAILY_IDS];

/** Column order of the per-client export (payload.tables.clients). */
export const CLIENT_COLUMNS = [
  'name', 'airtable', 'windsor', 'health', 'spend', 'leads', 'billed', 'free', 'replacement', 'prepay', 'unbilled',
  'billedValue', 'retainer', 'cplBilled', 'profit', 'margin', 'lastLeadDate', 'daysSinceLastLead',
];

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Strict calendar-date check: YYYY-MM-DD that round-trips (rejects 2026-09-31,
 * which Date.parse silently rolls into October).
 * @param {*} s
 * @returns {boolean}
 */
export function isCalendarDate(s) {
  return isISODate(s) && addDays(s, 0) === s;
}
const numOrNull = (v) => (isFiniteNum(v) ? v : null);

/**
 * Split a comma list query value into trimmed, de-duplicated, non-empty items.
 * Accepts a string, an array of strings (repeated query params) or nothing.
 * @param {string|string[]|undefined} raw
 * @returns {string[]}
 */
export function parseList(raw) {
  const parts = (Array.isArray(raw) ? raw : [raw]).flatMap(v => String(v ?? '').split(','));
  const out = [];
  for (const p of parts) {
    const s = p.trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * Validate a ?section= list against the catalog.
 * @param {string|string[]|undefined} raw
 * @returns {{ sections: string[]|null, unknown: string[] }}  sections is null when nothing was asked (= all)
 */
export function parseSections(raw) {
  const list = parseList(raw);
  if (!list.length) return { sections: null, unknown: [] };
  const unknown = list.filter(s => !SECTION_IDS.includes(s));
  return { sections: list.filter(s => SECTION_IDS.includes(s)), unknown };
}

/**
 * Validate a ?ids= list for /api/v1/daily.
 * @param {string|string[]|undefined} raw
 * @param {{ allowed?: string[] }} [opts]  defaults to DAILY_IDS
 * @returns {{ ids: string[], unknown: string[] }}  ids defaults to every allowed id when nothing was asked
 */
export function parseIds(raw, { allowed = DAILY_IDS } = {}) {
  const list = parseList(raw);
  if (!list.length) return { ids: [...allowed], unknown: [] };
  const unknown = list.filter(id => !allowed.includes(id));
  return { ids: list.filter(id => allowed.includes(id)), unknown };
}

/**
 * One flat row per catalog row of the payload, in section order.
 * The CEO section is included only when the payload carries its rows
 * (i.e. it was built with ceoUnlocked). Missing week columns are null.
 * @param {object} payload   buildDashboard()/loadDashboard() output
 * @param {{ sections?: string[]|null }} [opts]  section ids to keep (null/empty = all)
 * @returns {{ generatedAt: string|null, today: string, tz: string, rows: Array<object> }}
 */
export function flattenPayload(payload, { sections = null } = {}) {
  if (!payload || typeof payload !== 'object') throw new TypeError('flattenPayload: payload must be an object');
  const keep = sections && sections.length ? new Set(sections) : null;
  const list = [];
  if (payload.ceo && !payload.ceo.locked && Array.isArray(payload.ceo.rows)) {
    list.push({ id: payload.ceo.id || 'ceo', rows: payload.ceo.rows });
  }
  for (const s of payload.sections || []) list.push(s);

  const rows = [];
  for (const s of list) {
    if (keep && !keep.has(s.id)) continue;
    for (const r of s.rows || []) {
      const out = { section: s.id, id: r.id, label: r.label, unit: r.unit };
      const values = r.values || {};
      for (const rid of FLAT_RANGE_IDS) out[rid] = numOrNull(values[rid]);
      out.target = numOrNull(r.target);
      out.pace = numOrNull(r.pace);
      out.status = r.status ?? null;
      rows.push(out);
    }
  }
  return { generatedAt: payload.generatedAt ?? null, today: payload.today, tz: payload.tz, rows };
}

/**
 * Per-day values of the requested metric ids, one row per calendar day from
 * `from` to `to` inclusive. Each day is computed with sectionValues() over a
 * single-day range, so rates are that day's rates and sums are that day's
 * sums. Ids whose datasets are marked unavailable come back null (not 0).
 * @param {{ datasets: object, from: string, to: string, ids?: string[], availability?: Record<string, boolean> }} p
 * @returns {Array<{ date: string } & Record<string, number|null>>}
 */
export function dailyRows({ datasets, from, to, ids = DAILY_IDS, availability = {} } = {}) {
  if (!datasets || typeof datasets !== 'object') throw new TypeError('dailyRows: datasets must be an object');
  if (!isCalendarDate(from) || !isCalendarDate(to)) throw new RangeError('dailyRows: from and to must be YYYY-MM-DD');
  if (from > to) throw new RangeError('dailyRows: from must not be after to');
  const unavailable = (id) => {
    const row = ROW_BY_ID[id];
    if (!row) return false;
    return row.needs.some(k => availability[k] === false);
  };
  const nulled = new Set(ids.filter(unavailable));
  const out = [];
  for (const d of eachDay(from, to)) {
    const v = sectionValues(datasets, { from: d, to: d });
    const row = { date: d };
    for (const id of ids) row[id] = nulled.has(id) ? null : numOrNull(v[id]);
    out.push(row);
  }
  return out;
}

/**
 * Serialise one cell per RFC 4180: numbers unformatted, null/undefined empty,
 * anything containing a comma, a double quote, CR or LF wrapped in quotes
 * with inner quotes doubled.
 * @param {*} v
 * @returns {string}
 */
export function csvCell(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Rows to CSV text with a header row. Columns default to the union of the
 * rows' keys in first-seen order. Lines end with CRLF per RFC 4180.
 * @param {Array<object>} rows
 * @param {string[]} [columns]
 * @returns {string}
 */
export function toCsv(rows, columns) {
  const list = Array.isArray(rows) ? rows : [];
  let cols = Array.isArray(columns) && columns.length ? columns : null;
  if (!cols) {
    cols = [];
    for (const r of list) for (const k of Object.keys(r || {})) if (!cols.includes(k)) cols.push(k);
  }
  const lines = [cols.map(csvCell).join(',')];
  for (const r of list) lines.push(cols.map(c => csvCell(r ? r[c] : null)).join(','));
  return lines.join('\r\n') + '\r\n';
}

/**
 * Validate and default a from/to pair for the daily export.
 *   - both optional: `to` defaults to today, `from` to `to − (defaultDays − 1)`
 *   - a `to` after today is clamped to today (future days have no data)
 *   - errors: bad format, from after to, span longer than maxDays
 * @param {string|undefined} from
 * @param {string|undefined} to
 * @param {string} today   YYYY-MM-DD in the business timezone
 * @param {{ maxDays?: number, defaultDays?: number }} [opts]
 * @returns {{ from: string, to: string, days: number, clamped: boolean } | { error: string }}
 */
export function clampRange(from, to, today, { maxDays = 92, defaultDays = 30 } = {}) {
  if (!isCalendarDate(today)) return { error: 'today must be YYYY-MM-DD' };
  const f = from == null || from === '' ? null : String(from).trim();
  const t = to == null || to === '' ? null : String(to).trim();
  if (f != null && !isCalendarDate(f)) return { error: `from must be a date formatted YYYY-MM-DD (got "${f}")` };
  if (t != null && !isCalendarDate(t)) return { error: `to must be a date formatted YYYY-MM-DD (got "${t}")` };

  let end = t ?? today;
  let clamped = false;
  if (end > today) { end = today; clamped = true; }
  let start = f ?? addDays(end, -(defaultDays - 1));
  if (start > end) {
    if (f != null && t == null && f > today) return { error: `from (${f}) is after today (${today})` };
    return { error: `from (${start}) is after to (${end})` };
  }
  const days = daysBetween(start, end);
  if (days > maxDays) return { error: `Range spans ${days} days; the maximum is ${maxDays}. Ask for a shorter window (for example from=${addDays(end, -(maxDays - 1))}&to=${end}).` };
  return { from: start, to: end, days, clamped };
}
