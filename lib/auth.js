// Shared auth helpers. Web Crypto + TextEncoder only, so the same module runs
// in Edge middleware and in Node API routes. No Node-only imports.
//
// Three credentials, all optional except the first two:
//   APP_PASSWORD + SESSION_SECRET   the shared Clover login (cookie clover_session)
//   CEO_PASSWORD                    unlocks the CEO section (cookie clover_ceo);
//                                   when unset the CEO section is open to any
//                                   signed-in user
//   DASHBOARD_API_KEY               read access to /api/v1/* for Sheets, n8n,
//                                   Grow, etc. (Authorization: Bearer, x-api-key
//                                   header, or ?api_key=)
//   CRON_SECRET                     what Vercel Cron sends to /api/cron/*

export const COOKIE = 'clover_session';
export const CEO_COOKIE = 'clover_ceo';

const TRUST_MAX_AGE = 8640000; // 100 days in seconds
const SHORT_TTL = 12 * 60 * 60; // 12 hours in seconds
const CEO_TTL = 12 * 60 * 60;   // CEO unlock lasts 12 hours
const COOKIE_DOMAIN = '.clovermarketing.ai';

const enc = new TextEncoder();

function secret() {
  return process.env.SESSION_SECRET || '';
}

function appPassword() {
  return process.env.APP_PASSWORD || '';
}

export function isConfigured() {
  return Boolean(secret()) && Boolean(appPassword());
}

export function ceoConfigured() {
  return Boolean(process.env.CEO_PASSWORD);
}

export function apiKeyConfigured() {
  return Boolean(process.env.DASHBOARD_API_KEY);
}

function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesEqual(a, b) {
  // Constant-time compare of two Uint8Arrays (length difference still folded in).
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i] || 0) ^ (b[i] || 0);
  return diff === 0;
}

async function hmacB64url(message) {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(message));
  return b64url(new Uint8Array(sig));
}

async function sha256(text) {
  const d = await globalThis.crypto.subtle.digest('SHA-256', enc.encode(text));
  return new Uint8Array(d);
}

/** Constant-time equality of two secrets via their hashes. */
async function secretsMatch(input, expected) {
  if (typeof input !== 'string' || !input || typeof expected !== 'string' || !expected) return false;
  const [a, b] = await Promise.all([sha256(input), sha256(expected)]);
  return bytesEqual(a, b);
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

// Token: "v3.<exp>.<sig>", sig = base64url(HMAC-SHA256(SESSION_SECRET, "v3.<exp>"))
export async function signToken(trust) {
  const exp = nowSec() + (trust ? TRUST_MAX_AGE : SHORT_TTL);
  const payload = `v3.${exp}`;
  const sig = await hmacB64url(payload);
  return `${payload}.${sig}`;
}

export async function verifyToken(token) {
  try {
    if (!isConfigured()) return false;
    if (typeof token !== 'string' || !token) return false;
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'v3') return false;
    const [, exp, sig] = parts;
    if (!/^\d+$/.test(exp)) return false;
    const expected = await hmacB64url(`v3.${exp}`);
    if (!bytesEqual(enc.encode(sig), enc.encode(expected))) return false;
    return Number(exp) > nowSec();
  } catch {
    return false;
  }
}

// Scoped token: "v3s.<scope>.<exp>.<sig>", sig over "v3s.<scope>.<exp>".
// Used for the CEO unlock. Signed with the same SESSION_SECRET so a rotated
// secret invalidates every cookie at once.
export async function signScopedToken(scope, ttlSec = CEO_TTL) {
  if (!/^[a-z]+$/.test(scope)) throw new Error('bad scope');
  const exp = nowSec() + ttlSec;
  const payload = `v3s.${scope}.${exp}`;
  const sig = await hmacB64url(payload);
  return `${payload}.${sig}`;
}

export async function verifyScopedToken(token, scope) {
  try {
    if (!isConfigured()) return false;
    if (typeof token !== 'string' || !token) return false;
    const parts = token.split('.');
    if (parts.length !== 4 || parts[0] !== 'v3s' || parts[1] !== scope) return false;
    const [, , exp, sig] = parts;
    if (!/^\d+$/.test(exp)) return false;
    const expected = await hmacB64url(`v3s.${scope}.${exp}`);
    if (!bytesEqual(enc.encode(sig), enc.encode(expected))) return false;
    return Number(exp) > nowSec();
  } catch {
    return false;
  }
}

export async function passwordOk(input) {
  try {
    if (!isConfigured()) return false;
    return await secretsMatch(input, appPassword());
  } catch {
    return false;
  }
}

export async function ceoPasswordOk(input) {
  try {
    if (!ceoConfigured()) return false;
    return await secretsMatch(input, process.env.CEO_PASSWORD);
  } catch {
    return false;
  }
}

export async function apiKeyOk(input) {
  try {
    if (!apiKeyConfigured()) return false;
    return await secretsMatch(input, process.env.DASHBOARD_API_KEY);
  } catch {
    return false;
  }
}

export async function cronSecretOk(input) {
  try {
    if (!process.env.CRON_SECRET) return false;
    return await secretsMatch(input, process.env.CRON_SECRET);
  } catch {
    return false;
  }
}

/**
 * The API key presented by a request, if any. Works for both the Edge
 * Request (headers.get) and the Node req (headers object).
 *   Authorization: Bearer <key>   |   x-api-key: <key>   |   ?api_key=<key>
 */
export function extractApiKey(req) {
  const header = (name) => {
    if (!req || !req.headers) return '';
    if (typeof req.headers.get === 'function') return req.headers.get(name) || '';
    const v = req.headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] || '' : v || '';
  };
  const auth = header('authorization');
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (m) return m[1].trim();
  const x = header('x-api-key');
  if (x) return x.trim();
  try {
    const url = req.nextUrl || (req.url ? new URL(req.url, 'http://localhost') : null);
    const q = url && url.searchParams ? url.searchParams.get('api_key') : null;
    if (q) return q.trim();
  } catch {
    // ignore
  }
  return '';
}

/** Cookie value by name from a Node request (API routes). */
export function cookieFromReq(req, name) {
  const raw = req && req.headers ? req.headers.cookie : '';
  const h = Array.isArray(raw) ? raw.join('; ') : (raw || '');
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return part.slice(i + 1).trim(); }
  }
  return '';
}

/** True when this request may see the CEO section: no CEO password set, a valid CEO cookie, or the API key. */
export async function ceoUnlockedFor(req) {
  if (!ceoConfigured()) return true;
  if (await verifyScopedToken(cookieFromReq(req, CEO_COOKIE), 'ceo')) return true;
  const key = extractApiKey(req);
  if (key && await apiKeyOk(key)) return true;
  return false;
}

export function cookieDomainFor(host) {
  const raw = String(host || '').split(',')[0].trim().toLowerCase();
  // strip port ("host:3101"); leave bracketed IPv6 alone (never matches anyway)
  const h = raw.startsWith('[') ? raw : raw.split(':')[0];
  if (h === 'clovermarketing.ai' || h.endsWith('.clovermarketing.ai')) return COOKIE_DOMAIN;
  return null;
}

function baseAttrs(host, { shared = true } = {}) {
  const domain = shared ? cookieDomainFor(host) : null;
  return `Path=/${domain ? `; Domain=${domain}` : ''}; HttpOnly; Secure; SameSite=Lax`;
}

export function sessionCookie(host, token, trust) {
  const maxAge = trust ? `; Max-Age=${TRUST_MAX_AGE}` : '';
  return `${COOKIE}=${token}; ${baseAttrs(host)}${maxAge}`;
}

export function clearCookie(host) {
  return `${COOKIE}=; ${baseAttrs(host)}; Max-Age=0`;
}

/* The CEO cookie is host-only on purpose: unlocking the CEO section on this
   app must not unlock anything on the other Clover apps. */
export function ceoCookie(host, token) {
  return `${CEO_COOKIE}=${token}; ${baseAttrs(host, { shared: false })}; Max-Age=${CEO_TTL}`;
}

export function clearCeoCookie(host) {
  return `${CEO_COOKIE}=; ${baseAttrs(host, { shared: false })}; Max-Age=0`;
}
