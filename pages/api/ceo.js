// GET    /api/ceo             -> { configured, unlocked }
// POST   /api/ceo { password } -> sets the clover_ceo cookie (12h) or 401
// DELETE /api/ceo             -> clears it
// The CEO section is open to any signed-in user until CEO_PASSWORD is set.
// Session-protected by middleware.js.

import {
  ceoConfigured, ceoPasswordOk, signScopedToken, ceoCookie, clearCeoCookie, ceoUnlockedFor,
} from '../../lib/auth';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Per-instance brute-force brake: after MAX_FAILURES wrong passwords within
   WINDOW_MS, POST answers 429 for the rest of the window. It is per serverless
   instance, so it is a speed bump rather than a guarantee; the 400 ms delay
   and a strong CEO_PASSWORD do the rest. */
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const failures = [];
function tooManyFailures() {
  const cutoff = Date.now() - WINDOW_MS;
  while (failures.length && failures[0] < cutoff) failures.shift();
  return failures.length >= MAX_FAILURES;
}

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

  if (tooManyFailures()) {
    res.setHeader('Retry-After', String(Math.ceil(WINDOW_MS / 1000)));
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  }

  if (!(await ceoPasswordOk(password))) {
    failures.push(Date.now());
    await sleep(400);
    return res.status(401).json({ error: 'Wrong password.' });
  }
  failures.length = 0;

  try {
    const token = await signScopedToken('ceo');
    res.setHeader('Set-Cookie', ceoCookie(host, token));
    return res.status(200).json({ ok: true, configured: true });
  } catch (err) {
    return res.status(500).json({ error: 'Could not sign the CEO token.', message: String(err && err.message || err) });
  }
}
