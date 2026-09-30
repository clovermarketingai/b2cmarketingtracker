// Tax B2B CRM connector (Airtable: Prospects + Clients).
//
// A port of the funnel logic in the HQ app (smartleadz-command-center
// api/_lib/airtable.js fetchFunnel) so both apps count the same lead as
// booked / showed / closed on the same day. Output shape, as compute.js
// documents it:
//   fetchFunnel -> b2b.rows [{ date, booked, showed, closed, disqualified, upfrontCash, stage, status, grade, id }]
//
// Outcomes are cohorted to the lead's own date ("Date Added", falling back to
// the record's createdTime in the business timezone), so the spend that
// produced a lead and the close it eventually became sit in the same bucket.
//
// Environment (same names as the HQ app so values copy across):
//   AIRTABLE_TOKEN (or AIRTABLE_API_KEY)   token with data.records:read on the CRM base
//   AIRTABLE_CRM_BASE                      the CRM base id (app...)
//   AIRTABLE_TABLE_PROSPECTS               default 'Prospects'
//   AIRTABLE_TABLE_CLIENTS                 default 'Clients'
//   AIRTABLE_FIELD_APPOINTMENT             default 'Appointment'
//   AIRTABLE_FIELD_AD_SET                  default 'Ad Set' (not used by the funnel, kept for parity)

import { localDateOf } from '../dates.js';
import {
  SourceError, unconfigured, airtableList, airtableToken, formulaString, selectText,
} from './_shared.js';

/* ---------------------------------------------------------------------------
 * Configuration
 * ------------------------------------------------------------------------ */

export const DEFAULTS = Object.freeze({
  prospectsTable: 'Prospects',
  clientsTable: 'Clients',
  appointmentField: 'Appointment',
  adSetField: 'Ad Set',
});

const LABEL = 'Tax B2B CRM (Airtable)';
const TOKEN_ENVS = ['AIRTABLE_TOKEN', 'AIRTABLE_API_KEY'];
const MAX_PAGES = 200;
const PAGE_SIZE = 100;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

const env = (name, fallback) => {
  const v = (process.env[name] || '').trim();
  return v || fallback;
};

/** Resolved token / base / table / field names (env overrides applied). */
export function config() {
  return {
    token: airtableToken(TOKEN_ENVS),
    base: env('AIRTABLE_CRM_BASE', ''),
    prospectsTable: env('AIRTABLE_TABLE_PROSPECTS', DEFAULTS.prospectsTable),
    clientsTable: env('AIRTABLE_TABLE_CLIENTS', DEFAULTS.clientsTable),
    appointmentField: env('AIRTABLE_FIELD_APPOINTMENT', DEFAULTS.appointmentField),
    adSetField: env('AIRTABLE_FIELD_AD_SET', DEFAULTS.adSetField),
  };
}

/** True when a token and the CRM base id are both set. */
export function isConfigured() {
  const c = config();
  return !!(c.token && c.base);
}

/** Human hint shown on the dashboard's source panel when not configured. */
export function setupHint() {
  return 'Set AIRTABLE_TOKEN (or AIRTABLE_API_KEY) and AIRTABLE_CRM_BASE in Vercel. Optional: AIRTABLE_TABLE_PROSPECTS (Prospects), AIRTABLE_TABLE_CLIENTS (Clients), AIRTABLE_FIELD_APPOINTMENT (Appointment), AIRTABLE_FIELD_AD_SET (Ad Set).';
}

function requireConfig() {
  const c = config();
  if (!c.token) throw unconfigured(LABEL, 'Set AIRTABLE_TOKEN (or AIRTABLE_API_KEY) in Vercel.');
  if (!c.base) throw unconfigured(LABEL, 'Set AIRTABLE_CRM_BASE in Vercel (the CRM base id, app...).');
  return c;
}

/* ---------------------------------------------------------------------------
 * Vocabulary (verbatim from the HQ app)
 * ------------------------------------------------------------------------ */

/** Prospects.Stage vocabulary. Mirrors GoHighLevel. */
export const STAGE = Object.freeze({
  NEW: 'New Lead', REPLIED: 'Replied', BOOKED: 'Booked', CONFIRMED: 'Confirmed',
  SHOWED: 'Showed', WON: 'Won', NO_SHOW: 'No Show', NURTURE: 'Nurture', DISQUALIFIED: 'Disqualified',
});

/** Any stage that means the call was put on the calendar at some point. */
export const EVER_BOOKED = new Set([STAGE.BOOKED, STAGE.CONFIRMED, STAGE.SHOWED, STAGE.WON, STAGE.NO_SHOW]);
export const EVER_SHOWED = new Set([STAGE.SHOWED, STAGE.WON]);
export const CLOSED = new Set([STAGE.WON]);

/* The team works the CRM's own Status field; Stage is the tracker's
 * vocabulary. Status wins where it is unambiguous, because it is the field a
 * human actually touched. A close implies the demo happened, so a close also
 * counts as a show. Compared lower-cased and trimmed. */
export const STATUS_WON = new Set(['closed', 'closed won', 'won', 'client', 'signed']);
export const STATUS_DISQUALIFIED = new Set(['disqualified', 'dq', 'not a fit', 'closed lost', 'lost']);
export const STATUS_SHOWED = new Set(['showed', 'demo taken', 'presented']);
export const STATUS_NO_SHOW = new Set(['no show', 'noshow']);

const norm = (v) => String(v ?? '').trim().toLowerCase();

/* ---------------------------------------------------------------------------
 * Small pure helpers
 * ------------------------------------------------------------------------ */

/** First 10 chars of a date/datetime value, or null when blank. */
const isoDate = (v) => {
  if (v == null || v === '') return null;
  const s = String(v).trim().slice(0, 10);
  return ISO_RE.test(s) ? s : null;
};

function assertISO(name, v) {
  if (!ISO_RE.test(String(v || ''))) throw new SourceError(`${LABEL}: ${name} must be YYYY-MM-DD, got ${JSON.stringify(v)}`);
  return String(v);
}

/** ISO date one day before `iso` (input already validated). */
function dayBefore(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

const isAfter = (expr, iso) => `IS_AFTER(${expr}, DATETIME_PARSE(${formulaString(iso)}))`;

/**
 * filterByFormula for the Prospects pull: anything whose "Date Added" OR
 * createdTime is after `since`. The Date Added half is guarded with IF() so a
 * blank cell evaluates to false instead of an #ERROR that would hide the row.
 * `fallback` (used when Airtable rejects the Date Added field) keys on
 * CREATED_TIME() only.
 */
export function prospectFormulas(since) {
  return {
    primary: `OR(IF({Date Added}, ${isAfter('{Date Added}', since)}, 0), ${isAfter('CREATED_TIME()', since)})`,
    fallback: isAfter('CREATED_TIME()', since),
  };
}

/** Warn when the page cap could have hidden rows. */
function truncationWarning(rows, what) {
  return rows.length >= MAX_PAGES * PAGE_SIZE
    ? `${what}: hit the ${MAX_PAGES * PAGE_SIZE}-record cap; older rows may be missing.`
    : null;
}

/* ---------------------------------------------------------------------------
 * Normaliser (pure)
 * ------------------------------------------------------------------------ */

/**
 * Index Clients records by the Prospect they converted from.
 * @param {object[]} clientRecords Airtable records with "Prospect" (links) and "Paid Up Front".
 * @returns {Map<string, { id: string, status: string, upfrontCash: number }>}
 */
export function indexClientsByProspect(clientRecords) {
  const byProspect = new Map();
  for (const c of clientRecords || []) {
    const f = (c && c.fields) || {};
    const raw = f['Prospect'];
    const links = Array.isArray(raw) ? raw : (typeof raw === 'string' && raw ? [raw] : []);
    const entry = {
      id: c.id,
      status: selectText(f['Status']),
      upfrontCash: Number(f['Paid Up Front']) || 0,
    };
    for (const pid of links) if (pid) byProspect.set(String(pid), entry);
  }
  return byProspect;
}

/**
 * Prospect + Client records -> { rows, meta } in the b2b dataset shape.
 *
 * Per prospect, EXACTLY the HQ derivation:
 *   booked       = appointment field truthy OR stage in {Booked, Confirmed, Showed, Won, No Show}
 *   closed       = stage Won OR status in STATUS_WON OR a linked Client exists
 *   showed       = stage in {Showed, Won} OR status in STATUS_SHOWED OR closed
 *   disqualified = stage Disqualified OR status in STATUS_DISQUALIFIED
 *   upfrontCash  = closed ? Number(client['Paid Up Front']) || 0 : 0
 *   date         = "Date Added" (first 10 chars) || localDateOf(createdTime, tz)
 *
 * meta.showSignalSeen is true when ANY prospect carries an explicit show or
 * no-show signal (stage/status), deliberately NOT a show inferred from a
 * close; without it a 0% show rate is untracked rather than zero, and a
 * warning says so.
 *
 * @param {object[]} prospectRecords Airtable Prospects records.
 * @param {object[]} clientRecords   Airtable Clients records.
 * @param {{ tz?: string, appointmentField?: string }} opts
 * @returns {{ rows: object[], meta: object }}
 */
export function normaliseFunnel(prospectRecords, clientRecords, { tz, appointmentField = DEFAULTS.appointmentField } = {}) {
  const clientByProspect = indexClientsByProspect(clientRecords);
  const rows = [];
  let showSignalSeen = false;
  let noDate = 0;
  let malformed = 0;
  let linkedClients = 0;
  const counts = { booked: 0, showed: 0, closed: 0, disqualified: 0, noShow: 0 };

  for (const p of prospectRecords || []) {
    try {
      const f = (p && p.fields) || {};
      const stage = selectText(f['Stage']).trim();
      const status = selectText(f['Status']);
      const st = norm(status);
      const grade = selectText(f['Lead Grade']).trim();

      const client = clientByProspect.get(String(p.id));
      if (client) linkedClients++;
      const wonByStatus = STATUS_WON.has(st);

      const booked = Boolean(f[appointmentField]) || EVER_BOOKED.has(stage);
      const closed = CLOSED.has(stage) || wonByStatus || Boolean(client);
      const showedExplicit = EVER_SHOWED.has(stage) || STATUS_SHOWED.has(st);
      const showed = showedExplicit || closed;
      const noShow = stage === STAGE.NO_SHOW || STATUS_NO_SHOW.has(st);
      const disqualified = stage === STAGE.DISQUALIFIED || STATUS_DISQUALIFIED.has(st);

      showSignalSeen = showSignalSeen || showedExplicit || noShow;

      const date = isoDate(f['Date Added']) || localDateOf(p.createdTime, tz);
      if (!date) { noDate++; continue; }

      if (booked) counts.booked++;
      if (showed) counts.showed++;
      if (closed) counts.closed++;
      if (disqualified) counts.disqualified++;
      if (noShow) counts.noShow++;

      rows.push({
        date,
        booked,
        showed,
        closed,
        disqualified,
        upfrontCash: closed ? (client ? client.upfrontCash : 0) : 0,
        stage,
        status,
        grade,
        id: p.id,
      });
    } catch {
      malformed++;
    }
  }

  const warnings = [];
  if (rows.length && !showSignalSeen) {
    warnings.push('no prospect has ever been marked Showed/No Show, so shows are inferred from closes only.');
  }
  if (noDate) warnings.push(`${noDate} prospect${noDate === 1 ? '' : 's'} had neither Date Added nor createdTime and were skipped.`);
  if (malformed) warnings.push(`${malformed} prospect record${malformed === 1 ? '' : 's'} could not be read and were skipped.`);

  return {
    rows,
    meta: {
      prospects: (prospectRecords || []).length,
      clients: (clientRecords || []).length,
      linkedClients,
      showSignalSeen,
      counts,
      noDate,
      malformed,
      warnings,
    },
  };
}

/* ---------------------------------------------------------------------------
 * Fetcher
 * ------------------------------------------------------------------------ */

async function listProspects(c, since) {
  const { primary, fallback } = prospectFormulas(since);
  const base = { token: c.token, baseId: c.base, table: c.prospectsTable, label: `${LABEL} prospects`, maxPages: MAX_PAGES };
  try {
    const records = await airtableList({ ...base, params: { filterByFormula: primary, pageSize: PAGE_SIZE } });
    return { records, formula: primary, warning: null };
  } catch (e) {
    // Airtable answers 422 INVALID_FILTER_BY_FORMULA when "Date Added" does
    // not exist in this base. Fall back to createdTime and say so.
    if (e instanceof SourceError && e.status === 422) {
      const records = await airtableList({ ...base, params: { filterByFormula: fallback, pageSize: PAGE_SIZE } });
      return { records, formula: fallback, warning: 'the Prospects table has no "Date Added" field; leads are dated by their Airtable createdTime instead.' };
    }
    throw e;
  }
}

/**
 * Pull Prospects (dated on or after from-1) and the whole Clients table and
 * normalise them into the b2b dataset. Returns a little more than the window
 * (compute.js slices by range).
 * @param {{ from: string, to?: string, tz?: string }} args ISO dates already widened by the loader.
 * @returns {Promise<{ rows: object[], meta: object }>}
 */
export async function fetchFunnel({ from, to, tz } = {}) {
  const c = requireConfig();
  assertISO('from', from);
  if (to != null) assertISO('to', to);
  const since = dayBefore(from);

  const [prospects, clientRecs] = await Promise.all([
    listProspects(c, since),
    airtableList({
      token: c.token, baseId: c.base, table: c.clientsTable, label: `${LABEL} clients`,
      params: { pageSize: PAGE_SIZE }, maxPages: MAX_PAGES,
    }),
  ]);

  const out = normaliseFunnel(prospects.records, clientRecs, { tz, appointmentField: c.appointmentField });
  if (prospects.warning) out.meta.warnings.push(prospects.warning);
  for (const w of [truncationWarning(prospects.records, 'Prospects'), truncationWarning(clientRecs, 'Clients')]) {
    if (w) out.meta.warnings.push(w);
  }
  out.meta.since = since;
  out.meta.formula = prospects.formula;
  out.meta.tables = { prospects: c.prospectsTable, clients: c.clientsTable };
  return out;
}
