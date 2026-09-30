// GET|POST /api/cron/refresh
// Daily warm-up (vercel.json schedules it) and history writer. Rebuilds every
// source with refresh=true so the first human load of the day is instant,
// then, when a "Dashboard Snapshots" table exists in AIRTABLE_DASHBOARD_BASE,
// appends one record per CEO row and per primary row of every section, for
// Range 'today' and 'mtd'. The snapshot step can never fail the request: its
// error is reported in the response instead.
// Auth: middleware.js (CRON_SECRET as Vercel Cron sends it, or DASHBOARD_API_KEY).

import { loadDashboard } from '../../../lib/dashboard/load';
import * as costs from '../../../lib/dashboard/sources/costs';

export const config = { maxDuration: 60 };

/**
 * The snapshot records for a payload: CEO rows plus every primary row,
 * de-duplicated by metric id, for 'today' and 'mtd', null values skipped.
 * @param {object} payload
 * @returns {Array<{ date: string, metric: string, range: 'today'|'mtd', value: number, generatedAt: string }>}
 */
export function snapshotRecords(payload) {
  const seen = new Set();
  const rows = [];
  const add = (r) => { if (r && r.id && !seen.has(r.id)) { seen.add(r.id); rows.push(r); } };
  if (payload.ceo && !payload.ceo.locked) for (const r of payload.ceo.rows || []) add(r);
  for (const s of payload.sections || []) for (const r of s.rows || []) if (r.emphasis === 'primary') add(r);
  const out = [];
  const generatedAt = payload.generatedAt || new Date().toISOString();
  for (const r of rows) {
    for (const range of ['today', 'mtd']) {
      const v = r.values ? r.values[range] : null;
      if (v == null || !Number.isFinite(Number(v))) continue;
      out.push({ date: payload.today, metric: r.id, range, value: Number(v), generatedAt });
    }
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const started = Date.now();
  let payload;
  try {
    payload = await loadDashboard({ refresh: true, ceoUnlocked: true });
  } catch (err) {
    return res.status(500).json({ ok: false, ms: Date.now() - started, error: 'Could not refresh the dashboard.', message: String(err && err.message || err) });
  }

  const warnings = [...(payload.warnings || [])];
  let snapshotWritten = 0;
  let snapshot = 'skipped';
  try {
    const canCheck = typeof costs.snapshotTableExists === 'function' && typeof costs.appendSnapshot === 'function';
    const configured = typeof costs.isConfigured === 'function' ? costs.isConfigured() : false;
    if (!canCheck) {
      snapshot = 'unsupported';
      warnings.push('Snapshots: the costs connector does not export snapshotTableExists/appendSnapshot.');
    } else if (!configured) {
      snapshot = 'unconfigured';
      warnings.push('Snapshots: AIRTABLE_API_KEY is not set, nothing written.');
    } else if (!(await costs.snapshotTableExists())) {
      snapshot = 'no_table';
      warnings.push('Snapshots: no "Dashboard Snapshots" table in the dashboard base (POST /api/setup creates it).');
    } else {
      const records = snapshotRecords(payload);
      const r = await costs.appendSnapshot({ records });
      snapshotWritten = r && Number.isFinite(r.written) ? r.written : records.length;
      snapshot = 'written';
    }
  } catch (err) {
    snapshot = 'error';
    warnings.push(`Snapshots: ${String(err && err.message || err)}`);
  }

  return res.status(200).json({
    ok: true,
    ms: Date.now() - started,
    today: payload.today,
    generatedAt: payload.generatedAt,
    sources: payload.sources,
    snapshot,
    snapshotWritten,
    warnings,
  });
}
