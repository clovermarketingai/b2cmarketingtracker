// GET /api/v1/metrics?format=full|flat&section=ceo,sales&refresh=1
// External read API (Sheets, n8n, Grow, ...). Auth is enforced by
// middleware.js: DASHBOARD_API_KEY (Bearer / x-api-key / ?api_key=) or a
// signed-in session. The CEO section is included for API-key callers; a
// session caller also needs the CEO cookie when CEO_PASSWORD is set.
//   format=full (default)  the same payload GET /api/metrics serves
//   format=flat            { generatedAt, today, tz, rows: [ { section, id, label, unit,
//                            today, yesterday, l7d, l30d, mtd, lastMonth, w1..w5, target, pace, status } ] }

import { loadDashboard } from '../../../lib/dashboard/load';
import { flattenPayload, parseSections, SECTION_IDS } from '../../../lib/dashboard/export';
import { ceoUnlockedFor, ceoConfigured } from '../../../lib/auth';

export const config = { maxDuration: 60 };

const FORMATS = ['full', 'flat'];

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const q = req.query || {};
  const format = String(Array.isArray(q.format) ? q.format[0] : q.format || 'full').trim().toLowerCase();
  if (!FORMATS.includes(format)) {
    return res.status(400).json({ error: `format must be one of: ${FORMATS.join(', ')}.` });
  }
  const { sections, unknown } = parseSections(q.section);
  if (unknown.length) {
    return res.status(400).json({ error: `Unknown section(s): ${unknown.join(', ')}.`, sections: SECTION_IDS });
  }
  const refresh = q.refresh === '1';

  try {
    const ceoUnlocked = await ceoUnlockedFor(req);
    const payload = await loadDashboard({ refresh, ceoUnlocked });
    payload.ceoConfigured = ceoConfigured();
    if (sections && sections.includes('ceo') && !ceoUnlocked) {
      return res.status(403).json({ error: 'The CEO section is locked for this session. Unlock it at POST /api/ceo or use the API key.' });
    }
    if (format === 'flat') {
      return res.status(200).json(flattenPayload(payload, { sections }));
    }
    if (sections) {
      payload.sections = payload.sections.filter(s => sections.includes(s.id));
      if (!sections.includes('ceo')) payload.ceo = { locked: !ceoUnlocked, omitted: true };
    }
    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ error: 'Could not build the dashboard.', message: String(err && err.message || err) });
  }
}
