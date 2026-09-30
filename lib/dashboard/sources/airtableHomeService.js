// Home Service Airtable connector (base appG9APSCkeYOQLbl by default).
//
// Four datasets come out of this base, all in the shapes compute.js documents:
//   fetchLeads      -> hsLeads.rows   [{ date, client, kind, price }]
//   fetchClients    -> clients.rows   [{ name, createdDate, id }]
//   fetchProspects  -> prospects.rows [{ date, closer, status, contacted, booked, appointmentDate, speedToLead, timeCalled }]
//   fetchCloserEod  -> closerEod.rows [{ date, closer, attempted, connected, offers, closes, energy, focus, submittedAt }]
//
// Every Airtable instant (createdTime, "Created At", "Appointment Date" with a
// time, "Submitted At") is converted to the business calendar day with
// localDateOf(value, tz). Date-only values ("2026-09-29") are used as-is so a
// UTC-midnight parse can never shift them a day west of Greenwich.
//
// Pure normalisers are exported so they can be unit-tested with fixture
// records; the fetch* functions are thin wrappers that pull records and call
// them. A single malformed record never throws: it is skipped and counted in
// meta.malformed.

import { localDateOf } from '../dates.js';
import { CLIENTS } from '../../clients.js';
import {
  SourceError, unconfigured, airtableList, airtableToken, formulaString, selectText, asNumber,
} from './_shared.js';

/* ---------------------------------------------------------------------------
 * Configuration
 * ------------------------------------------------------------------------ */

export const DEFAULTS = Object.freeze({
  base: 'appG9APSCkeYOQLbl',
  leadsTable: 'tblpbVnP4y7YlGcML',
  clientsTable: 'tblTEOPYFNgfE5NdU',
  prospectsTable: 'tblxy8uy1rn7YySk7',
  eodTable: 'tblZfN07lZJ6pG6sk',
});

/** Field ids used as fallbacks when the Prospect table is read by field id. */
export const PROSPECT_FIELD_IDS = Object.freeze({
  closer: 'fldRsOqpZHKrQ9evO',
  status: 'fldrEbJgggOdlQTCd',
  appointmentDate: 'fld8LGO8SxiQdCCMi',
  createdAt: 'fldAJyiB8nnyLKW9B',
  timeCalled: 'fldZNxCzwLAU0zmKV',
  speedToLead: 'fld5K3K1PhwGNp4qV',
});

const LEAD_FIELDS = ['Assigned Client', 'Lead Cost'];
const LABEL = 'Home Service Airtable';
const MAX_PAGES = 200;
const PAGE_SIZE = 100;

const env = (name, fallback) => {
  const v = (process.env[name] || '').trim();
  return v || fallback;
};

/** Resolved base / table ids (env overrides applied). */
export function config() {
  return {
    token: airtableToken(['AIRTABLE_API_KEY']),
    base: env('AIRTABLE_HS_BASE', DEFAULTS.base),
    leadsTable: env('AIRTABLE_HS_LEADS_TABLE', DEFAULTS.leadsTable),
    clientsTable: env('AIRTABLE_HS_CLIENTS_TABLE', DEFAULTS.clientsTable),
    prospectsTable: env('AIRTABLE_HS_PROSPECTS_TABLE', DEFAULTS.prospectsTable),
    eodTable: env('AIRTABLE_HS_EOD_TABLE', DEFAULTS.eodTable),
  };
}

/** True when the Home Service base can be reached (AIRTABLE_API_KEY is set). */
export function isConfigured() {
  return !!airtableToken(['AIRTABLE_API_KEY']);
}

/** Human hint shown on the dashboard's source panel when not configured. */
export function setupHint() {
  return `Set AIRTABLE_API_KEY (a token with data.records:read on base ${env('AIRTABLE_HS_BASE', DEFAULTS.base)}). Optional overrides: AIRTABLE_HS_BASE, AIRTABLE_HS_LEADS_TABLE, AIRTABLE_HS_CLIENTS_TABLE, AIRTABLE_HS_PROSPECTS_TABLE, AIRTABLE_HS_EOD_TABLE.`;
}

function requireConfig(what) {
  const c = config();
  if (!c.token) throw unconfigured(`${what} (Airtable)`, 'Set AIRTABLE_API_KEY in Vercel.');
  if (!c.base) throw unconfigured(`${what} (Airtable)`, 'Set AIRTABLE_HS_BASE in Vercel (defaults to appG9APSCkeYOQLbl).');
  return c;
}

/* ---------------------------------------------------------------------------
 * Small pure helpers
 * ------------------------------------------------------------------------ */

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const norm = (s) => String(s ?? '').trim().toLowerCase();

/**
 * Business calendar date of an Airtable value: a date-only string is returned
 * untouched, an instant is converted with localDateOf, anything else -> null.
 */
export function airtableDate(value, tz) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (DATE_ONLY_RE.test(s)) return s;
  return localDateOf(s, tz);
}

/** Number or null (never 0 for blank), so averages ignore missing values. */
export function numberOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Read a field by name, then by field id. */
const field = (f, name, id) => (f[name] !== undefined ? f[name] : (id ? f[id] : undefined));

/** ISO date one day before `iso` (input is validated by the caller). */
function dayBefore(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return dt.toISOString().slice(0, 10);
}

function assertISO(name, v) {
  if (!ISO_RE.test(String(v || ''))) throw new SourceError(`${LABEL}: ${name} must be YYYY-MM-DD, got ${JSON.stringify(v)}`);
  return String(v);
}

const isAfter = (expr, iso) => `IS_AFTER(${expr}, DATETIME_PARSE(${formulaString(iso)}))`;
/** IS_AFTER guarded so a blank field is false instead of an #ERROR. */
const isAfterIfSet = (fieldName, iso) => `IF({${fieldName}}, ${isAfter(`{${fieldName}}`, iso)}, 0)`;

/** Warn when the page cap could have hidden rows. */
function truncationWarning(rows, what) {
  return rows.length >= MAX_PAGES * PAGE_SIZE
    ? `${what}: hit the ${MAX_PAGES * PAGE_SIZE}-record cap; older rows may be missing.`
    : null;
}

/* ---------------------------------------------------------------------------
 * Lead Cost parsing
 * ------------------------------------------------------------------------ */

const PRICE_RE = /^\$?\s*[0-9]+(\.[0-9]+)?$/;
export const LEAD_KINDS = ['billed', 'free', 'replacement', 'prepay', 'unbilled', 'unknown'];

/**
 * Classify a "Lead Cost" select value.
 * "$85" / "85" / "85.5" -> { kind: 'billed', price: 85 }; Free / Replacement /
 * Prepay / Unbilled (case-insensitive) -> that kind with price 0; blank or
 * anything else -> 'unknown'.
 */
export function parseLeadCost(raw) {
  const text = selectText(raw).trim();
  if (!text) return { kind: 'unknown', price: 0, raw: text };
  if (PRICE_RE.test(text)) return { kind: 'billed', price: Number(text.replace(/^\$\s*/, '')), raw: text };
  const k = text.toLowerCase();
  if (k === 'free') return { kind: 'free', price: 0, raw: text };
  if (k === 'replacement') return { kind: 'replacement', price: 0, raw: text };
  if (k === 'prepay') return { kind: 'prepay', price: 0, raw: text };
  if (k === 'unbilled') return { kind: 'unbilled', price: 0, raw: text };
  return { kind: 'unknown', price: 0, raw: text };
}

/** Airtable names of active weekly-retainer clients (every lead counts as billed at $0). */
export function retainerClientNames(clients = CLIENTS) {
  const out = [];
  for (const [key, c] of Object.entries(clients || {})) {
    if (!c || c.paused) continue;
    if (c.rule && c.rule.type === 'weekly') out.push(c.airtable || key);
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Normalisers (pure)
 * ------------------------------------------------------------------------ */

/**
 * Clients records -> [{ name, createdDate, id }] plus a name map.
 * Primary field "Company Name", fallback "Name", fallback the record id.
 */
export function normaliseClients(records, { tz } = {}) {
  const rows = [];
  const nameById = {};
  let malformed = 0;
  for (const rec of records || []) {
    try {
      const f = rec.fields || {};
      const name = String(f['Company Name'] || f['Name'] || '').trim() || rec.id;
      nameById[rec.id] = name;
      rows.push({ name, createdDate: airtableDate(rec.createdTime, tz), id: rec.id });
    } catch {
      malformed++;
    }
  }
  return { rows, nameById, meta: { fetched: (records || []).length, malformed, warnings: [] } };
}

/**
 * Leads records -> [{ date, client, kind, price }].
 * @param {object[]} records Airtable records with "Assigned Client" / "Lead Cost".
 * @param {Record<string,string>} clientNameById record id -> client name.
 * @param {{ tz?: string, retainerClients?: string[] }} opts
 */
export function normaliseLeads(records, clientNameById = {}, { tz, retainerClients = [] } = {}) {
  const retainers = new Set((retainerClients || []).map(norm));
  const rows = [];
  const kinds = Object.fromEntries(LEAD_KINDS.map(k => [k, 0]));
  const unknownCostValues = {};
  const unknownClients = {};
  let unassigned = 0;
  let malformed = 0;
  let noDate = 0;
  for (const rec of records || []) {
    try {
      const f = rec.fields || {};
      const linked = f['Assigned Client'];
      const id = Array.isArray(linked) ? linked[0] : (typeof linked === 'string' ? linked : null);
      if (!id) { unassigned++; continue; }
      let client = clientNameById[id];
      if (!client) {
        client = `(unknown client ${id})`;
        unknownClients[id] = (unknownClients[id] || 0) + 1;
      }
      const date = airtableDate(rec.createdTime, tz);
      if (!date) { noDate++; continue; }
      let { kind, price, raw } = parseLeadCost(f['Lead Cost']);
      if (retainers.has(norm(client))) { kind = 'billed'; price = 0; }
      else if (kind === 'unknown') {
        const key = raw === '' ? '(blank)' : raw;
        unknownCostValues[key] = (unknownCostValues[key] || 0) + 1;
      }
      kinds[kind]++;
      rows.push({ date, client, kind, price });
    } catch {
      malformed++;
    }
  }
  const warnings = [];
  const unknownTotal = Object.values(unknownCostValues).reduce((a, b) => a + b, 0);
  if (unknownTotal) {
    const list = Object.entries(unknownCostValues).sort((a, b) => b[1] - a[1]).map(([v, n]) => `${JSON.stringify(v)} x${n}`).join(', ');
    warnings.push(`${unknownTotal} lead${unknownTotal === 1 ? ' has' : 's have'} a Lead Cost the dashboard does not recognise: ${list}.`);
  }
  const unknownClientTotal = Object.values(unknownClients).reduce((a, b) => a + b, 0);
  if (unknownClientTotal) warnings.push(`${unknownClientTotal} lead${unknownClientTotal === 1 ? '' : 's'} point at a client record that is not in the Clients table (${Object.keys(unknownClients).join(', ')}).`);
  if (noDate) warnings.push(`${noDate} lead${noDate === 1 ? '' : 's'} had no createdTime and were skipped.`);
  if (malformed) warnings.push(`${malformed} lead record${malformed === 1 ? '' : 's'} could not be read and were skipped.`);
  return {
    rows,
    meta: { fetched: (records || []).length, unassigned, kinds, unknownCostValues, unknownClients, noDate, malformed, warnings },
  };
}

const NOT_CONTACTED = new Set(['hotlist', 'follow up']);

/**
 * Prospect records -> [{ date, closer, status, contacted, booked, appointmentDate, speedToLead, timeCalled }].
 * `date` is the business day of "Created At" (fallback the record's createdTime).
 */
export function normaliseProspects(records, { tz } = {}) {
  const rows = [];
  const statuses = {};
  const closers = new Set();
  let malformed = 0;
  let noDate = 0;
  for (const rec of records || []) {
    try {
      const f = rec.fields || {};
      const createdRaw = field(f, 'Created At', PROSPECT_FIELD_IDS.createdAt) ?? rec.createdTime;
      const date = airtableDate(createdRaw, tz);
      if (!date) { noDate++; continue; }
      const closer = selectText(field(f, 'Closer', PROSPECT_FIELD_IDS.closer)).trim() || '(unassigned)';
      const status = selectText(field(f, 'Status', PROSPECT_FIELD_IDS.status)).trim();
      const apptRaw = field(f, 'Appointment Date', PROSPECT_FIELD_IDS.appointmentDate) ?? f['Call Time'];
      const appointmentDate = airtableDate(apptRaw, tz);
      const timeCalledRaw = field(f, 'Time Called', PROSPECT_FIELD_IDS.timeCalled);
      const speedRaw = field(f, 'Speed to Lead (sec)', PROSPECT_FIELD_IDS.speedToLead);
      const contacted = !!status && !NOT_CONTACTED.has(status.toLowerCase());
      statuses[status || '(blank)'] = (statuses[status || '(blank)'] || 0) + 1;
      closers.add(closer);
      rows.push({
        date,
        closer,
        status,
        contacted,
        booked: !!appointmentDate,
        appointmentDate,
        speedToLead: numberOrNull(speedRaw),
        timeCalled: timeCalledRaw == null || timeCalledRaw === '' ? null : String(timeCalledRaw),
      });
    } catch {
      malformed++;
    }
  }
  const warnings = [];
  if (noDate) warnings.push(`${noDate} prospect${noDate === 1 ? '' : 's'} had no Created At / createdTime and were skipped.`);
  if (malformed) warnings.push(`${malformed} prospect record${malformed === 1 ? '' : 's'} could not be read and were skipped.`);
  return {
    rows,
    meta: { fetched: (records || []).length, statuses, closers: [...closers].sort(), noDate, malformed, warnings },
  };
}

/**
 * Closer EOD records -> [{ date, closer, attempted, connected, offers, closes, energy, focus, submittedAt }],
 * one per (closer, date): the EOD form upserts, so duplicates keep the latest "Submitted At".
 */
export function normaliseEod(records, { tz } = {}) {
  const byKey = new Map();
  let malformed = 0;
  let noDate = 0;
  let duplicates = 0;
  const dupKeys = new Set();
  for (const rec of records || []) {
    try {
      const f = rec.fields || {};
      const date = f.Date == null || f.Date === '' ? null : String(f.Date).slice(0, 10);
      if (!date || !DATE_ONLY_RE.test(date)) { noDate++; continue; }
      const closer = selectText(f.Closer).trim() || '(unassigned)';
      const submittedAt = f['Submitted At'] == null || f['Submitted At'] === '' ? null : String(f['Submitted At']);
      const row = {
        date,
        closer,
        attempted: asNumber(f['Calls Attempted']),
        connected: asNumber(f['Calls Connected']),
        offers: asNumber(f['Offers Given']),
        closes: asNumber(f['Closes']),
        energy: numberOrNull(f.Energy),
        focus: numberOrNull(f.Focus),
        submittedAt,
      };
      const key = `${norm(closer)}|${date}`;
      const prev = byKey.get(key);
      if (!prev) { byKey.set(key, { row, order: submitOrder(row, rec) }); continue; }
      duplicates++;
      dupKeys.add(`${closer} ${date}`);
      const order = submitOrder(row, rec);
      if (order >= prev.order) byKey.set(key, { row, order });
    } catch {
      malformed++;
    }
  }
  const rows = [...byKey.values()].map(v => v.row).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.closer.localeCompare(b.closer)));
  const warnings = [];
  if (duplicates) warnings.push(`${duplicates} duplicate Closer EOD submission${duplicates === 1 ? '' : 's'} collapsed to the latest (${[...dupKeys].join(', ')}).`);
  if (noDate) warnings.push(`${noDate} Closer EOD record${noDate === 1 ? '' : 's'} had no Date and were skipped.`);
  if (malformed) warnings.push(`${malformed} Closer EOD record${malformed === 1 ? '' : 's'} could not be read and were skipped.`);
  return { rows, meta: { fetched: (records || []).length, duplicates, noDate, malformed, warnings } };
}

/** Sort key for "latest submission wins": Submitted At, else record createdTime, else 0. */
function submitOrder(row, rec) {
  const t = Date.parse(row.submittedAt || '') || Date.parse(rec.createdTime || '') || 0;
  return Number.isFinite(t) ? t : 0;
}

/* ---------------------------------------------------------------------------
 * Fetchers
 * ------------------------------------------------------------------------ */

async function listClients(c) {
  return airtableList({ token: c.token, baseId: c.base, table: c.clientsTable, label: `${LABEL} clients`, params: { pageSize: PAGE_SIZE }, maxPages: MAX_PAGES });
}

/**
 * Leads since `from` (minus a day) with their client resolved to a name.
 * @param {{ from: string, to: string, tz?: string }} args
 * @returns {Promise<{ rows: object[], meta: object }>}
 */
export async function fetchLeads({ from, to, tz } = {}) {
  const c = requireConfig('Home Service leads');
  assertISO('from', from);
  if (to != null) assertISO('to', to);
  const since = dayBefore(from);
  const [clientRecs, leadRecs] = await Promise.all([
    listClients(c),
    airtableList({
      token: c.token, baseId: c.base, table: c.leadsTable, label: `${LABEL} leads`,
      params: { fields: LEAD_FIELDS, filterByFormula: isAfter('CREATED_TIME()', since), pageSize: PAGE_SIZE },
      maxPages: MAX_PAGES,
    }),
  ]);
  const { nameById } = normaliseClients(clientRecs, { tz });
  const out = normaliseLeads(leadRecs, nameById, { tz, retainerClients: retainerClientNames() });
  const trunc = truncationWarning(leadRecs, 'Leads');
  if (trunc) out.meta.warnings.push(trunc);
  out.meta.since = since;
  return out;
}

/**
 * Every client in the Clients table.
 * @param {{ from?: string, to?: string, tz?: string }} args
 */
export async function fetchClients({ tz } = {}) {
  const c = requireConfig('Home Service clients');
  const recs = await listClients(c);
  const { rows, meta } = normaliseClients(recs, { tz });
  const trunc = truncationWarning(recs, 'Clients');
  if (trunc) meta.warnings.push(trunc);
  return { rows, meta };
}

/**
 * Candidate filter formulas for the Prospect table, most specific first. The
 * base's field names are not guaranteed, so each is tried in turn and a
 * formula Airtable rejects (422, unknown field) falls through to the next.
 */
export function prospectFormulas(since) {
  const created = isAfter('CREATED_TIME()', since);
  return [
    `OR(${created}, ${isAfterIfSet('Created At', since)}, ${isAfterIfSet('Appointment Date', since)})`,
    `OR(${created}, ${isAfterIfSet('Created At', since)}, ${isAfterIfSet('Call Time', since)})`,
    `OR(${created}, ${isAfterIfSet('Appointment Date', since)})`,
    `OR(${created}, ${isAfterIfSet('Call Time', since)})`,
    `OR(${created}, ${isAfterIfSet('Created At', since)})`,
    created,
  ];
}

/**
 * Prospects created since `from` (minus a day) or with an appointment since then.
 * @param {{ from: string, to: string, tz?: string }} args
 */
export async function fetchProspects({ from, to, tz } = {}) {
  const c = requireConfig('Prospects');
  assertISO('from', from);
  if (to != null) assertISO('to', to);
  const since = dayBefore(from);
  const formulas = prospectFormulas(since);
  let recs = null;
  let usedFormula = null;
  let lastErr = null;
  for (const formula of formulas) {
    try {
      recs = await airtableList({
        token: c.token, baseId: c.base, table: c.prospectsTable, label: `${LABEL} prospects`,
        params: { filterByFormula: formula, pageSize: PAGE_SIZE }, maxPages: MAX_PAGES,
      });
      usedFormula = formula;
      break;
    } catch (e) {
      if (e instanceof SourceError && e.status === 422) { lastErr = e; continue; }
      throw e;
    }
  }
  if (recs == null) throw lastErr || new SourceError(`${LABEL} prospects: no filter formula was accepted.`);
  const out = normaliseProspects(recs, { tz });
  const trunc = truncationWarning(recs, 'Prospects');
  if (trunc) out.meta.warnings.push(trunc);
  if (usedFormula !== formulas[0]) out.meta.warnings.push('Prospect table is missing "Created At" or "Appointment Date"; filtered on a narrower formula.');
  out.meta.since = since;
  out.meta.formula = usedFormula;
  return out;
}

/**
 * Closer EOD submissions dated since `from` (minus a day), one per closer per day.
 * @param {{ from: string, to: string, tz?: string }} args
 */
export async function fetchCloserEod({ from, to, tz } = {}) {
  const c = requireConfig('Closer EOD');
  assertISO('from', from);
  if (to != null) assertISO('to', to);
  const since = dayBefore(from);
  const recs = await airtableList({
    token: c.token, baseId: c.base, table: c.eodTable, label: `${LABEL} closer EOD`,
    params: { filterByFormula: isAfter('{Date}', since), pageSize: PAGE_SIZE }, maxPages: MAX_PAGES,
  });
  const out = normaliseEod(recs, { tz });
  const trunc = truncationWarning(recs, 'Closer EOD');
  if (trunc) out.meta.warnings.push(trunc);
  out.meta.since = since;
  return out;
}
