// Shared auth helpers. Web Crypto + TextEncoder only, so the same module runs
// in Edge middleware and in Node API routes. No Node-only imports.

export const COOKIE = 'clover_session';

const TRUST_MAX_AGE = 8640000; // 100 days in seconds
const SHORT_TTL = 12 * 60 * 60; // 12 hours in seconds
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

export async function passwordOk(input) {
  try {
    if (!isConfigured()) return false;
    if (typeof input !== 'string') return false;
    const [a, b] = await Promise.all([sha256(input), sha256(appPassword())]);
    return bytesEqual(a, b);
  } catch {
    return false;
  }
}

export function cookieDomainFor(host) {
  const raw = String(host || '').split(',')[0].trim().toLowerCase();
  // strip port ("host:3101"); leave bracketed IPv6 alone (never matches anyway)
  const h = raw.startsWith('[') ? raw : raw.split(':')[0];
  if (h === 'clovermarketing.ai' || h.endsWith('.clovermarketing.ai')) return COOKIE_DOMAIN;
  return null;
}

function baseAttrs(host) {
  const domain = cookieDomainFor(host);
  return `Path=/${domain ? `; Domain=${domain}` : ''}; HttpOnly; Secure; SameSite=Lax`;
}

export function sessionCookie(host, token, trust) {
  const maxAge = trust ? `; Max-Age=${TRUST_MAX_AGE}` : '';
  return `${COOKIE}=${token}; ${baseAttrs(host)}${maxAge}`;
}

export function clearCookie(host) {
  return `${COOKIE}=; ${baseAttrs(host)}; Max-Age=0`;
}
