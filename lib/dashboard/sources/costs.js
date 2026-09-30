// Manual Airtable tables that feed the CEO section: "Dashboard Costs",
// "Dashboard Targets" and (optional, written by /api/cron/refresh)
// "Dashboard Snapshots". Server-only.
//
// They live in AIRTABLE_DASHBOARD_BASE (default: the Home Service base) and
// are created by POST /api/setup through ensureDashboardTables().
//
// Output shapes (see compute.js):
//   fetchCosts   -> { rows: [{ date, category, amount, period, note }], meta }
//   fetchTargets -> { rows: [{ metric, month, target, note }], byMetric: { [metric]: { [month]: target } }, meta }

import {
  SourceError, unconfigured, airtableListOptional, airtableTables, airtableCreateTable, airtableCreate, selectText,
} from './_shared.js';
import { COST_CATEGORIES, ROW_BY_ID } from '../catalog.js';

const LABEL_COSTS = 'Dashboard Costs (Airtable)';
const LABEL_TARGETS = 'Dashboard Targets (Airtable)';
const LABEL_SNAPSHOTS = 'Dashboard Snapshots (Airtable)';
export const DEFAULT_BASE = 'appG9APSCkeYOQLbl';
export const COSTS_TABLE = 'Dashboard Costs';
export const TARGETS_TABLE = 'Dashboard Targets';
export const SNAPSHOTS_TABLE = 'Dashboard Snapshots';

const MONTH_RE = /^\d{4}-\d{2}$/;
const MAX_NAMES_IN_WARNING = 8;

/** Airtable meta-API specs for the three dashboard tables, exactly as /api/setup creates them. */
export const DASHBOARD_TABLES = [
  {
    name: COSTS_TABLE,
    description: 'Manual costs for the CEO dashboard. Monthly rows are prorated per day across their month; One-time rows land on their Date.',
    fields: [
      { name: 'Date', type: 'date', options: { dateFormat: { name: 'iso' } } },
      { name: 'Category', type: 'singleSelect', options: { choices: Object.keys(COST_CATEGORIES).map(name => ({ name })) } },
      { name: 'Amount', type: 'currency', options: { precision: 2, symbol: '$' } },
      { name: 'Period', type: 'singleSelect', options: { choices: [{ name: 'One-time' }, { name: 'Monthly' }] } },
      { name: 'Note', type: 'singleLineText' },
    ],
  },
  {
    name: TARGETS_TABLE,
    description: 'Monthly targets per dashboard metric. Metric is a catalog row id (e.g. cash_collected); Month is YYYY-MM.',
    fields: [
      { name: 'Metric', type: 'singleLineText' },
      { name: 'Month', type: 'singleLineText' },
      { name: 'Target', type: 'number', options: { precision: 2 } },
      { name: 'Note', type: 'singleLineText' },
    ],
  },
  {
    name: SNAPSHOTS_TABLE,
    description: 'Daily snapshots of the CEO/primary rows, appended by /api/cron/refresh.',
    fields: [
      { name: 'Date', type: 'date', options: { dateFormat: { name: 'iso' } } },
      { name: 'Metric', type: 'singleLineText' },
      { name: 'Range', type: 'singleSelect', options: { choices: [{ name: 'today' }, { name: 'mtd' }] } },
      { name: 'Value', type: 'number', options: { precision: 2 } },
      { name: 'Generated At', type: 'singleLineText' },
    ],
  },
];

/** Resolved token + base id from the environment. */
export function config(env = process.env) {
  return {
    token: (env.AIRTABLE_API_KEY || '').trim(),
    baseId: (env.AIRTABLE_DASHBOARD_BASE || env.AIRTABLE_HS_BASE || '').trim() || DEFAULT_BASE,
  };
}

/** True when AIRTABLE_API_KEY is set. */
export function isConfigured() {
  return !!config().token;
}

/** Setup instructions shown on the dashboard when unconfigured. */
export function setupHint() {
  return `Set AIRTABLE_API_KEY (Airtable token with data.records:read/write and schema.bases:write) and optionally AIRTABLE_DASHBOARD_BASE (default ${DEFAULT_BASE}), then POST /api/setup to create the "${COSTS_TABLE}", "${TARGETS_TABLE}" and "${SNAPSHOTS_TABLE}" tables.`;
}

const round2 = (n) => Math.round(n * 100) / 100;
const listNames = (arr) => arr.slice(0, MAX_NAMES_IN_WARNING).join(', ') + (arr.length > MAX_NAMES_IN_WARNING ? ` (+${arr.length - MAX_NAMES_IN_WARNING} more)` : '');

/** Amount cell as a finite number, or null when blank / not numeric. */
function amountOf(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Date cell as a 10-char ISO date, or null. */
function dateOf(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

const CATEGORY_BY_LOWER = Object.fromEntries(Object.keys(COST_CATEGORIES).map(k => [k.trim().toLowerCase(), k]));

/**
 * Pure normaliser for Dashboard Costs records.
 * @param {Array<{ id?: string, fields?: object }>} records
 * @returns {{ rows: Array<{ id: string|null, date: string, category: string, amount: number, period: 'once'|'monthly', note: string }>, meta: { fetched: number, kept: number, skipped: number, skippedDetail: { noDate: number, noAmount: number }, unknownCategories: string[], warnings: string[] } }}
 */
export function normaliseCosts(records) {
  const rows = [];
  const skippedDetail = { noDate: 0, noAmount: 0 };
  const unknown = new Set();
  for (const rec of records || []) {
    const f = (rec && rec.fields) || {};
    const date = dateOf(f.Date);
    const amount = amountOf(f.Amount);
    if (!date) { skippedDetail.noDate++; continue; }
    if (amount == null) { skippedDetail.noAmount++; continue; }
    const rawCat = selectText(f.Category).trim();
    const category = CATEGORY_BY_LOWER[rawCat.toLowerCase()] || rawCat;
    if (!COST_CATEGORIES[category]) unknown.add(rawCat || '(blank)');
    rows.push({
      id: rec.id || null,
      date,
      category,
      amount: round2(amount),
      period: /month/i.test(selectText(f.Period)) ? 'monthly' : 'once',
      note: f.Note == null ? '' : String(f.Note),
    });
  }
  const warnings = [];
  const skipped = skippedDetail.noDate + skippedDetail.noAmount;
  if (skipped) warnings.push(`${skipped} cost row(s) skipped (${skippedDetail.noDate} without a Date, ${skippedDetail.noAmount} without an Amount).`);
  if (unknown.size) warnings.push(`cost categories not on the dashboard are counted as uncategorised: ${listNames([...unknown])}. Use one of: ${Object.keys(COST_CATEGORIES).join(', ')}.`);
  return {
    rows,
    meta: { fetched: (records || []).length, kept: rows.length, skipped, skippedDetail, unknownCategories: [...unknown], warnings },
  };
}

/**
 * Pure normaliser for Dashboard Targets records. Unknown metric ids and bad
 * months are kept out of `byMetric` and reported in meta.warnings.
 * @param {Array<{ id?: string, fields?: object }>} records
 * @returns {{ rows: Array<{ id: string|null, metric: string, month: string, target: number, note: string }>, byMetric: Record<string, Record<string, number>>, meta: { fetched: number, kept: number, skipped: number, unknownMetrics: string[], badMonths: number, warnings: string[] } }}
 */
export function normaliseTargets(records) {
  const rows = [];
  const byMetric = {};
  const unknownMetrics = new Set();
  let badMonths = 0;
  let noTarget = 0;
  let duplicates = 0;
  for (const rec of records || []) {
    const f = (rec && rec.fields) || {};
    const metric = String(f.Metric ?? '').trim();
    const month = String(f.Month ?? '').trim();
    const target = amountOf(f.Target);
    if (!metric) continue;
    if (!ROW_BY_ID[metric]) { unknownMetrics.add(metric); continue; }
    if (!MONTH_RE.test(month)) { badMonths++; continue; }
    if (target == null) { noTarget++; continue; }
    if (!byMetric[metric]) byMetric[metric] = {};
    if (byMetric[metric][month] != null) duplicates++;
    byMetric[metric][month] = target;
    rows.push({ id: rec.id || null, metric, month, target, note: f.Note == null ? '' : String(f.Note) });
  }
  const warnings = [];
  if (unknownMetrics.size) warnings.push(`Dashboard Targets has metrics the dashboard does not know: ${listNames([...unknownMetrics])}.`);
  if (badMonths) warnings.push(`${badMonths} target row(s) skipped: Month must be YYYY-MM.`);
  if (noTarget) warnings.push(`${noTarget} target row(s) skipped: Target is blank or not a number.`);
  if (duplicates) warnings.push(`${duplicates} duplicate metric+month target row(s); the last one wins.`);
  const skipped = (records || []).length - rows.length;
  return {
    rows,
    byMetric,
    meta: { fetched: (records || []).length, kept: rows.length, skipped, unknownMetrics: [...unknownMetrics], badMonths, warnings },
  };
}

function requireConfig(label) {
  const { token, baseId } = config();
  if (!token) throw unconfigured(label, 'Set AIRTABLE_API_KEY in Vercel.');
  return { token, baseId };
}

const creationHint = (table, columns) => `Create it with POST /api/setup or by hand: a table named "${table}" with columns ${columns}.`;

/**
 * Every row of "Dashboard Costs". The table is small, so the whole thing is
 * read and compute.js slices by range (monthly rows outside the window are
 * still needed for proration).
 * @param {{ from?: string, to?: string, tz?: string }} [_p]
 * @returns {Promise<{ rows: Array<object>, meta: object }>}
 */
export async function fetchCosts(_p = {}) {
  const { token, baseId } = requireConfig(LABEL_COSTS);
  const records = await airtableListOptional({ token, baseId, table: COSTS_TABLE, label: LABEL_COSTS });
  if (records == null) {
    throw unconfigured(LABEL_COSTS, creationHint(COSTS_TABLE, 'Date (date), Category (single select: Payroll, Messaging, Affiliates, Software, Personal projects, Other), Amount (currency), Period (single select: One-time, Monthly), Note'));
  }
  const out = normaliseCosts(records);
  out.meta.baseId = baseId;
  return out;
}

/**
 * Every row of "Dashboard Targets" as { rows, byMetric, meta }.
 * @returns {Promise<{ rows: Array<object>, byMetric: Record<string, Record<string, number>>, meta: object }>}
 */
export async function fetchTargets() {
  const { token, baseId } = requireConfig(LABEL_TARGETS);
  const records = await airtableListOptional({ token, baseId, table: TARGETS_TABLE, label: LABEL_TARGETS });
  if (records == null) {
    throw unconfigured(LABEL_TARGETS, creationHint(TARGETS_TABLE, 'Metric (text = catalog row id), Month (text YYYY-MM), Target (number), Note'));
  }
  const out = normaliseTargets(records);
  out.meta.baseId = baseId;
  return out;
}

/**
 * Create whichever of the three dashboard tables are missing in the base.
 * Never throws for a single table: failures come back in `errors`.
 * @param {{ token?: string, baseId?: string }} [p]  defaults to config()
 * @returns {Promise<{ baseId: string, created: string[], existing: string[], errors: Array<{ name: string, error: string }> }>}
 */
export async function ensureDashboardTables({ token, baseId } = {}) {
  const cfg = config();
  token = (token || cfg.token || '').trim();
  baseId = (baseId || cfg.baseId || '').trim();
  if (!token) throw unconfigured('Airtable dashboard tables', 'Set AIRTABLE_API_KEY (needs schema.bases:write) in Vercel.');
  if (!baseId) throw unconfigured('Airtable dashboard tables', 'Set AIRTABLE_DASHBOARD_BASE in Vercel.');
  const tables = await airtableTables({ token, baseId, label: 'Airtable schema' });
  const have = new Set(tables.map(t => String(t.name || '').trim().toLowerCase()));
  const created = [];
  const existing = [];
  const errors = [];
  for (const spec of DASHBOARD_TABLES) {
    if (have.has(spec.name.toLowerCase())) { existing.push(spec.name); continue; }
    try {
      await airtableCreateTable({ token, baseId, name: spec.name, description: spec.description, fields: spec.fields, label: `Airtable create "${spec.name}"` });
      created.push(spec.name);
    } catch (e) {
      errors.push({ name: spec.name, error: e instanceof SourceError ? e.message : String(e && e.message || e) });
    }
  }
  return { baseId, created, existing, errors };
}

/**
 * Which dashboard tables exist in the base (by name, case-insensitive).
 * @param {{ token?: string, baseId?: string }} [p]
 * @returns {Promise<{ baseId: string, existing: string[], missing: string[] }>}
 */
export async function dashboardTablesStatus({ token, baseId } = {}) {
  const cfg = config();
  token = (token || cfg.token || '').trim();
  baseId = (baseId || cfg.baseId || '').trim();
  if (!token) throw unconfigured('Airtable dashboard tables', 'Set AIRTABLE_API_KEY in Vercel.');
  const tables = await airtableTables({ token, baseId, label: 'Airtable schema' });
  const have = new Set(tables.map(t => String(t.name || '').trim().toLowerCase()));
  const existing = DASHBOARD_TABLES.filter(s => have.has(s.name.toLowerCase())).map(s => s.name);
  const missing = DASHBOARD_TABLES.filter(s => !have.has(s.name.toLowerCase())).map(s => s.name);
  return { baseId, existing, missing };
}

/**
 * True when "Dashboard Snapshots" exists in the base. A schema-API failure
 * (e.g. token without schema scope) resolves to false instead of throwing.
 * @param {{ token?: string, baseId?: string }} [p]
 * @returns {Promise<boolean>}
 */
export async function snapshotTableExists({ token, baseId } = {}) {
  try {
    const s = await dashboardTablesStatus({ token, baseId });
    return s.existing.includes(SNAPSHOTS_TABLE);
  } catch (e) {
    if (e instanceof SourceError) return false;
    throw e;
  }
}

/**
 * Append snapshot rows. Each record is either { fields: {...} } or a plain
 * { date, metric, range, value, generatedAt } object, which is mapped to the
 * table's columns.
 * @param {{ token?: string, baseId?: string, records: Array<object> }} p
 * @returns {Promise<{ written: number, ids: string[] }>}
 */
export async function appendSnapshot({ token, baseId, records } = {}) {
  const cfg = config();
  token = (token || cfg.token || '').trim();
  baseId = (baseId || cfg.baseId || '').trim();
  if (!token) throw unconfigured(LABEL_SNAPSHOTS, 'Set AIRTABLE_API_KEY in Vercel.');
  const prepared = (records || []).map(toSnapshotRecord).filter(Boolean);
  if (!prepared.length) return { written: 0, ids: [] };
  const out = await airtableCreate({ token, baseId, table: SNAPSHOTS_TABLE, records: prepared, label: LABEL_SNAPSHOTS });
  return { written: out.length, ids: out.map(r => r.id).filter(Boolean) };
}

/**
 * Map a snapshot input to an Airtable create record. Returns null when the
 * input has no Date or Metric.
 * @param {object} r
 * @returns {{ fields: object } | null}
 */
export function toSnapshotRecord(r) {
  if (!r || typeof r !== 'object') return null;
  const f = r.fields && typeof r.fields === 'object' ? { ...r.fields } : {
    Date: r.date ?? r.Date,
    Metric: r.metric ?? r.Metric,
    Range: r.range ?? r.Range,
    Value: r.value ?? r.Value,
    'Generated At': r.generatedAt ?? r['Generated At'],
  };
  if (!f.Date || !f.Metric) return null;
  f.Date = String(f.Date).slice(0, 10);
  f.Metric = String(f.Metric);
  f.Range = f.Range === 'mtd' ? 'mtd' : 'today';
  f.Value = f.Value == null || f.Value === '' || !Number.isFinite(Number(f.Value)) ? null : round2(Number(f.Value));
  if (f['Generated At'] != null) f['Generated At'] = String(f['Generated At']);
  return { fields: f };
}
