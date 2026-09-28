// GET /api/config — client roster + revenue rules for the daily tracker.
// Protected by middleware.js like every other /api route, so the roster and
// rate card are only served to a signed-in session (they used to be compiled
// into the public daily page chunk).

import { CLIENTS } from '../../lib/clients';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ clients: CLIENTS });
}
