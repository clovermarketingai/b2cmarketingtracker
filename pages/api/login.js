import {
  isConfigured,
  passwordOk,
  signToken,
  sessionCookie,
  clearCookie,
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

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', clearCookie(host));
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  if (!isConfigured()) {
    return res.status(500).json({ error: 'Login is not configured on this deployment.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  if (!body || typeof body !== 'object') body = {};

  const password = typeof body.password === 'string' ? body.password : '';
  const trust = body.trust === true || body.trust === 'true';

  if (!(await passwordOk(password))) {
    await sleep(400);
    return res.status(401).json({ error: 'Wrong password.' });
  }

  const token = await signToken(trust);
  res.setHeader('Set-Cookie', sessionCookie(host, token, trust));
  return res.status(200).json({ ok: true });
}
