// GET /api/metrics?refresh=1&demo=1
// The one endpoint the Command Center page reads. Every source is pulled in
// parallel (through the cache), aggregated server-side, and returned fully
// shaped so the browser only renders.

import { loadDashboard } from '../../lib/dashboard/load';
import { ceoUnlockedFor, ceoConfigured } from '../../lib/auth';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  const demo = req.query.demo === '1';
  const refresh = req.query.refresh === '1';
  try {
    const ceoUnlocked = await ceoUnlockedFor(req);
    const payload = await loadDashboard({ demo, refresh, ceoUnlocked });
    payload.ceoConfigured = ceoConfigured();
    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ error: 'Could not build the dashboard.', message: String(err && err.message || err) });
  }
}
