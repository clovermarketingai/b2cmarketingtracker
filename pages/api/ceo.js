// GET    /api/ceo             -> { configured, unlocked }
// POST   /api/ceo { password } -> sets the clover_ceo cookie (12h) or 401
// DELETE /api/ceo             -> clears it
// The CEO section is open to any signed-in user until CEO_PASSWORD is set.
// Session-protected by middleware.js.

import {
  ceoConfigured, ceoPasswordOk, signScopedToken, ceoCookie, clearCeoCookie, ceoUnlockedFor,
} from '../../lib/auth';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function requestHost(req) {
  const fwd = req.headers['x-forwarded-host'];
  const host = Array.isArray(fwd) ? fwd[0] : fwd;
  return host || req.headers.host || '';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const host = requestHost(req);

  if (req.method === 'GET') {
    return res.status(200).json({ configured: ceoConfigured(), unlocked: await ceoUnlockedFor(req) });
  }

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', clearCeoCookie(host));
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  if (!ceoConfigured()) {
    return res.status(200).json({ ok: true, configured: false });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  if (!body || typeof body !== 'object') body = {};
  const password = typeof body.password === 'string' ? body.password : '';

  if (!(await ceoPasswordOk(password))) {
    await sleep(400);
    return res.status(401).json({ error: 'Wrong password.' });
  }

  try {
    const token = await signScopedToken('ceo');
    res.setHeader('Set-Cookie', ceoCookie(host, token));
    return res.status(200).json({ ok: true, configured: true });
  } catch (err) {
    return res.status(500).json({ error: 'Could not sign the CEO token.', message: String(err && err.message || err) });
  }
}
