// GET /api/v1/daily?from=YYYY-MM-DD&to=YYYY-MM-DD&ids=cash_collected,leads_billed&format=json|csv
// One row per calendar day (business timezone) with each requested metric's
// value for that day. Defaults: last 30 days, every catalog row id, json.
// The window is bounded by what the dashboard already pulls (pullWindow):
// asking for an earlier `from` answers 400 with the earliest supported date,
// because all-time pulls were measured to be too slow to serve on request.
// Auth: middleware.js (DASHBOARD_API_KEY or a signed-in session).

import { loadDatasets } from '../../../lib/dashboard/load';
import { businessTz, todayISO, pullWindow } from '../../../lib/dashboard/dates';
import { clampRange, parseIds, dailyRows, toCsv, DAILY_IDS, CEO_ONLY_IDS } from '../../../lib/dashboard/export';
import { ceoUnlockedFor } from '../../../lib/auth';

export const config = { maxDuration: 60 };

const MAX_DAYS = 92;
const DEFAULT_DAYS = 30;
const FORMATS = ['json', 'csv'];

const first = (v) => (Array.isArray(v) ? v[0] : v);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const q = req.query || {};
  const format = String(first(q.format) || 'json').trim().toLowerCase();
  if (!FORMATS.includes(format)) {
    return res.status(400).json({ error: `format must be one of: ${FORMATS.join(', ')}.` });
  }

  const tz = businessTz();
  const today = todayISO(tz);
  const range = clampRange(first(q.from), first(q.to), today, { maxDays: MAX_DAYS, defaultDays: DEFAULT_DAYS });
  if (range.error) return res.status(400).json({ error: range.error, today, maxDays: MAX_DAYS });

  const earliest = pullWindow(today).from;
  if (range.from < earliest) {
    return res.status(400).json({
      error: `from (${range.from}) is earlier than the earliest supported date (${earliest}). The daily export covers the dashboard's pull window only; use the Dashboard Snapshots table for history.`,
      earliest, today,
    });
  }

  const ceoUnlocked = await ceoUnlockedFor(req);
  const allowed = ceoUnlocked ? DAILY_IDS : DAILY_IDS.filter(id => !CEO_ONLY_IDS.includes(id));
  const { ids, unknown } = parseIds(q.ids, { allowed });
  if (unknown.length) {
    const hidden = unknown.filter(id => CEO_ONLY_IDS.includes(id));
    return res.status(hidden.length && !ceoUnlocked ? 403 : 400).json({
      error: hidden.length && !ceoUnlocked
        ? `CEO-only metric(s) need the CEO unlock or the API key: ${hidden.join(', ')}.`
        : `Unknown metric id(s): ${unknown.join(', ')}.`,
      ids: allowed,
    });
  }

  try {
    const refresh = q.refresh === '1';
    const { datasets, availability, sources, warnings } = await loadDatasets({ today, tz, refresh });
    const rows = dailyRows({ datasets, from: range.from, to: range.to, ids, availability });
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="clover-daily-${range.from}-${range.to}.csv"`);
      return res.status(200).send(toCsv(rows, ['date', ...ids]));
    }
    const unavailable = Object.entries(availability).filter(([, ok]) => ok === false).map(([k]) => k);
    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      today, tz,
      from: range.from, to: range.to, days: range.days, clamped: range.clamped,
      ids,
      rows,
      unavailable,
      sources: Object.fromEntries(Object.entries(sources).map(([k, s]) => [k, { status: s.status, fetchedAt: s.fetchedAt, stale: s.stale, error: s.error || null }])),
      warnings,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not build the daily export.', message: String(err && err.message || err) });
  }
}
