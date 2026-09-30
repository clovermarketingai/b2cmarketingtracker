// GET /api/v1/clients?format=json|csv&refresh=1
// The per-client month-to-date table (payload.tables.clients) for Sheets,
// n8n, Grow, ... Auth: middleware.js (DASHBOARD_API_KEY or a signed-in session).

import { loadDashboard } from '../../../lib/dashboard/load';
import { toCsv, CLIENT_COLUMNS } from '../../../lib/dashboard/export';

export const config = { maxDuration: 60 };

const FORMATS = ['json', 'csv'];
const first = (v) => (Array.isArray(v) ? v[0] : v);

/**
 * Pick the documented columns from a clients-table row, in order.
 * @param {object} c
 * @returns {object}
 */
function shapeClient(c) {
  const out = {};
  for (const k of CLIENT_COLUMNS) out[k] = c[k] === undefined ? null : c[k];
  return out;
}

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
  try {
    const payload = await loadDashboard({ refresh: q.refresh === '1', ceoUnlocked: false });
    const rows = (payload.tables && payload.tables.clients || []).map(shapeClient);
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="clover-clients-${payload.month}.csv"`);
      return res.status(200).send(toCsv(rows, CLIENT_COLUMNS));
    }
    return res.status(200).json({
      generatedAt: payload.generatedAt,
      today: payload.today, tz: payload.tz, month: payload.month,
      range: payload.ranges && payload.ranges.mtd ? { from: payload.ranges.mtd.from, to: payload.ranges.mtd.to } : null,
      columns: CLIENT_COLUMNS,
      rows,
      warnings: payload.warnings || [],
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not build the clients table.', message: String(err && err.message || err) });
  }
}
