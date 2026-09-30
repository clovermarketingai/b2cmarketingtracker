import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  COOKIE, CEO_COOKIE,
  isConfigured, ceoConfigured, apiKeyConfigured,
  signToken, verifyToken, signScopedToken, verifyScopedToken,
  passwordOk, ceoPasswordOk, apiKeyOk, cronSecretOk,
  extractApiKey, cookieFromReq, ceoUnlockedFor,
  cookieDomainFor, sessionCookie, clearCookie, ceoCookie, clearCeoCookie,
} from '../lib/auth.js';

// lib/auth.js reads the environment at call time, so the values below are
// what every test sees unless it overrides them with withEnv().
const ENV = {
  APP_PASSWORD: 'team-password',
  SESSION_SECRET: 'unit-test-session-secret',
  CEO_PASSWORD: 'ceo-password',
  DASHBOARD_API_KEY: 'dashboard-api-key-123',
  CRON_SECRET: 'cron-secret-456',
};
Object.assign(process.env, ENV);

async function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v == null) delete process.env[k]; else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v == null) delete process.env[k]; else process.env[k] = v; }
  }
}

/** The same signature lib/auth.js computes, built independently with node:crypto. */
function sign(payload, secret = ENV.SESSION_SECRET) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

const nowSec = () => Math.floor(Date.now() / 1000);

/** Flip one character of a base64url signature. */
function tamper(sig) {
  const c = sig[0] === 'A' ? 'B' : 'A';
  return c + sig.slice(1);
}

/* ---------------------------------------------------------------------------
 * Configuration flags
 * ------------------------------------------------------------------------ */

test('isConfigured / ceoConfigured / apiKeyConfigured follow the env', async () => {
  assert.equal(isConfigured(), true);
  assert.equal(ceoConfigured(), true);
  assert.equal(apiKeyConfigured(), true);
  await withEnv({ SESSION_SECRET: null }, () => assert.equal(isConfigured(), false));
  await withEnv({ APP_PASSWORD: '' }, () => assert.equal(isConfigured(), false));
  await withEnv({ CEO_PASSWORD: null }, () => assert.equal(ceoConfigured(), false));
  await withEnv({ DASHBOARD_API_KEY: null }, () => assert.equal(apiKeyConfigured(), false));
});

/* ---------------------------------------------------------------------------
 * Session token
 * ------------------------------------------------------------------------ */

test('signToken / verifyToken round trip', async () => {
  const short = await signToken(false);
  const trusted = await signToken(true);
  assert.match(short, /^v3\.\d+\.[A-Za-z0-9_-]+$/);
  assert.equal(await verifyToken(short), true);
  assert.equal(await verifyToken(trusted), true);

  // The signature is HMAC-SHA256(SESSION_SECRET, "v3.<exp>") in base64url.
  const [, exp, sig] = short.split('.');
  assert.equal(sig, sign(`v3.${exp}`));

  // Short tokens last 12 hours, trusted ones 100 days.
  const t = nowSec();
  assert.ok(Math.abs(Number(exp) - (t + 12 * 3600)) <= 5, 'short ttl');
  const [, texp] = trusted.split('.');
  assert.ok(Math.abs(Number(texp) - (t + 8640000)) <= 5, 'trust ttl');
});

test('verifyToken rejects an expired token and accepts the same shape unexpired', async () => {
  const past = nowSec() - 60;
  const expired = `v3.${past}.${sign(`v3.${past}`)}`;
  assert.equal(await verifyToken(expired), false);

  const future = nowSec() + 60;
  const fresh = `v3.${future}.${sign(`v3.${future}`)}`;
  assert.equal(await verifyToken(fresh), true, 'the test-side HMAC matches the library');
});

test('verifyToken rejects tampering, wrong secrets and malformed input', async () => {
  const token = await signToken(false);
  const [v, exp, sig] = token.split('.');
  assert.equal(await verifyToken(`${v}.${exp}.${tamper(sig)}`), false, 'tampered signature');
  assert.equal(await verifyToken(`${v}.${Number(exp) + 1000}.${sig}`), false, 'tampered expiry');
  assert.equal(await verifyToken(`v2.${exp}.${sig}`), false, 'wrong version');
  assert.equal(await verifyToken(`${v}.${exp}`), false, 'missing part');
  assert.equal(await verifyToken(`${v}.notanumber.${sig}`), false, 'non-numeric exp');
  assert.equal(await verifyToken(''), false);
  assert.equal(await verifyToken(null), false);
  assert.equal(await verifyToken(undefined), false);
  assert.equal(await verifyToken(42), false);

  // Signed with another secret.
  const other = `v3.${exp}.${sign(`v3.${exp}`, 'some-other-secret')}`;
  assert.equal(await verifyToken(other), false);

  // Fails closed when the login is not configured, even for a valid token.
  await withEnv({ SESSION_SECRET: null }, async () => assert.equal(await verifyToken(token), false));
  await withEnv({ APP_PASSWORD: null }, async () => assert.equal(await verifyToken(token), false));
});

/* ---------------------------------------------------------------------------
 * Scoped (CEO) token
 * ------------------------------------------------------------------------ */

test('signScopedToken / verifyScopedToken round trip and scope binding', async () => {
  const ceo = await signScopedToken('ceo');
  assert.match(ceo, /^v3s\.ceo\.\d+\.[A-Za-z0-9_-]+$/);
  assert.equal(await verifyScopedToken(ceo, 'ceo'), true);
  assert.equal(await verifyScopedToken(ceo, 'admin'), false, 'scope mismatch');
  assert.equal(await verifyScopedToken(ceo, ''), false);

  const [, scope, exp, sig] = ceo.split('.');
  assert.equal(scope, 'ceo');
  assert.equal(sig, sign(`v3s.ceo.${exp}`));
  assert.ok(Math.abs(Number(exp) - (nowSec() + 12 * 3600)) <= 5, 'CEO unlock lasts 12 hours');

  // A token minted for one scope cannot be re-labelled for another: the scope
  // is inside the signed payload.
  assert.equal(await verifyScopedToken(`v3s.admin.${exp}.${sig}`, 'admin'), false);
});

test('session tokens and scoped tokens are not interchangeable', async () => {
  const session = await signToken(false);
  const ceo = await signScopedToken('ceo');
  assert.equal(await verifyScopedToken(session, 'ceo'), false, 'session token is not a ceo token');
  assert.equal(await verifyToken(ceo), false, 'ceo token is not a session token');

  // Even when the parts are re-arranged to look like the other format.
  const [, exp, sig] = session.split('.');
  assert.equal(await verifyScopedToken(`v3s.ceo.${exp}.${sig}`, 'ceo'), false);
  const [, , cexp, csig] = ceo.split('.');
  assert.equal(await verifyToken(`v3.${cexp}.${csig}`), false);
});

test('verifyScopedToken rejects tampering, expiry and bad scopes', async () => {
  const ceo = await signScopedToken('ceo');
  const [v, s, exp, sig] = ceo.split('.');
  assert.equal(await verifyScopedToken(`${v}.${s}.${exp}.${tamper(sig)}`, 'ceo'), false, 'tampered signature');
  assert.equal(await verifyScopedToken(`${v}.${s}.${Number(exp) + 3600}.${sig}`, 'ceo'), false, 'tampered expiry');
  assert.equal(await verifyScopedToken(`${v}.${s}.${exp}`, 'ceo'), false, 'missing part');
  assert.equal(await verifyScopedToken('', 'ceo'), false);
  assert.equal(await verifyScopedToken(null, 'ceo'), false);

  const expired = await signScopedToken('ceo', -10);
  assert.equal(await verifyScopedToken(expired, 'ceo'), false, 'expired');
  const zero = await signScopedToken('ceo', 0);
  assert.equal(await verifyScopedToken(zero, 'ceo'), false, 'exp == now is expired');

  await assert.rejects(() => signScopedToken('Ceo'), /bad scope/);
  await assert.rejects(() => signScopedToken('ceo1'), /bad scope/);
  await assert.rejects(() => signScopedToken(''), /bad scope/);

  await withEnv({ SESSION_SECRET: null }, async () => assert.equal(await verifyScopedToken(ceo, 'ceo'), false));
});

/* ---------------------------------------------------------------------------
 * Secret checks
 * ------------------------------------------------------------------------ */

test('passwordOk: correct, wrong, empty, and unset env fails closed', async () => {
  assert.equal(await passwordOk('team-password'), true);
  assert.equal(await passwordOk('team-password '), false, 'no trimming');
  assert.equal(await passwordOk('Team-Password'), false);
  assert.equal(await passwordOk('wrong'), false);
  assert.equal(await passwordOk(''), false);
  assert.equal(await passwordOk(null), false);
  assert.equal(await passwordOk(undefined), false);
  assert.equal(await passwordOk({ toString: () => 'team-password' }), false, 'non-string input');
  await withEnv({ APP_PASSWORD: null }, async () => assert.equal(await passwordOk('team-password'), false));
  await withEnv({ APP_PASSWORD: '' }, async () => assert.equal(await passwordOk(''), false));
  await withEnv({ SESSION_SECRET: null }, async () => assert.equal(await passwordOk('team-password'), false));
});

test('ceoPasswordOk: correct, wrong, empty, and unset env fails closed', async () => {
  assert.equal(await ceoPasswordOk('ceo-password'), true);
  assert.equal(await ceoPasswordOk('team-password'), false, 'the login password does not unlock the CEO section');
  assert.equal(await ceoPasswordOk(''), false);
  assert.equal(await ceoPasswordOk(null), false);
  await withEnv({ CEO_PASSWORD: null }, async () => {
    assert.equal(await ceoPasswordOk('ceo-password'), false);
    assert.equal(await ceoPasswordOk(''), false);
  });
});

test('apiKeyOk: correct, wrong, empty, and unset env fails closed', async () => {
  assert.equal(await apiKeyOk('dashboard-api-key-123'), true);
  assert.equal(await apiKeyOk('dashboard-api-key-12'), false);
  assert.equal(await apiKeyOk('cron-secret-456'), false, 'the cron secret is not an API key');
  assert.equal(await apiKeyOk(''), false);
  assert.equal(await apiKeyOk(null), false);
  await withEnv({ DASHBOARD_API_KEY: null }, async () => {
    assert.equal(await apiKeyOk('dashboard-api-key-123'), false);
    assert.equal(await apiKeyOk(''), false);
  });
  await withEnv({ DASHBOARD_API_KEY: '' }, async () => assert.equal(await apiKeyOk(''), false));
});

test('cronSecretOk: correct, wrong, empty, and unset env fails closed', async () => {
  assert.equal(await cronSecretOk('cron-secret-456'), true);
  assert.equal(await cronSecretOk('dashboard-api-key-123'), false, 'the read-only API key is not the cron secret');
  assert.equal(await cronSecretOk('wrong'), false);
  assert.equal(await cronSecretOk(''), false);
  assert.equal(await cronSecretOk(undefined), false);
  await withEnv({ CRON_SECRET: null }, async () => {
    assert.equal(await cronSecretOk('cron-secret-456'), false);
    assert.equal(await cronSecretOk(''), false);
  });
});

/* ---------------------------------------------------------------------------
 * extractApiKey
 * ------------------------------------------------------------------------ */

const nodeReq = (headers = {}, url = '/api/v1/metrics') => ({ headers, url });
const edgeReq = (headers = {}, url = 'https://b2c.clovermarketing.ai/api/v1/metrics') => ({ headers: new Headers(headers), nextUrl: new URL(url) });

test('extractApiKey on a Node-style request (headers object)', () => {
  assert.equal(extractApiKey(nodeReq({ authorization: 'Bearer abc' })), 'abc');
  assert.equal(extractApiKey(nodeReq({ authorization: 'bearer   abc  ' })), 'abc', 'case-insensitive scheme, trimmed');
  assert.equal(extractApiKey(nodeReq({ 'x-api-key': ' xyz ' })), 'xyz');
  assert.equal(extractApiKey(nodeReq({}, '/api/v1/daily?format=csv&api_key=qqq')), 'qqq');
  assert.equal(extractApiKey(nodeReq({ authorization: ['Bearer first', 'Bearer second'] })), 'first', 'array header takes the first value');
  assert.equal(extractApiKey(nodeReq({ authorization: 'Basic dXNlcjpwYXNz' })), '', 'non-Bearer Authorization is ignored');
  assert.equal(extractApiKey(nodeReq({ authorization: 'Basic dXNlcjpwYXNz', 'x-api-key': 'xyz' })), 'xyz');
  assert.equal(extractApiKey(nodeReq({}, '/api/v1/metrics?api_key=')), '', 'empty query value');
  assert.equal(extractApiKey(nodeReq()), '');
  assert.equal(extractApiKey({}), '');
  assert.equal(extractApiKey(null), '');
  assert.equal(extractApiKey({ headers: {}, url: 'http://%%%' }), '', 'unparseable url never throws');
});

test('extractApiKey precedence: Bearer > x-api-key > ?api_key=', () => {
  const all = nodeReq({ authorization: 'Bearer h', 'x-api-key': 'x' }, '/api/v1/metrics?api_key=q');
  assert.equal(extractApiKey(all), 'h');
  const two = nodeReq({ 'x-api-key': 'x' }, '/api/v1/metrics?api_key=q');
  assert.equal(extractApiKey(two), 'x');
  const one = nodeReq({}, '/api/v1/metrics?api_key=q');
  assert.equal(extractApiKey(one), 'q');
});

test('extractApiKey on an Edge-style request (headers.get + nextUrl)', () => {
  assert.equal(extractApiKey(edgeReq({ Authorization: 'Bearer abc' })), 'abc');
  assert.equal(extractApiKey(edgeReq({ 'X-Api-Key': 'xyz' })), 'xyz', 'Headers is case-insensitive');
  assert.equal(extractApiKey(edgeReq({}, 'https://b2c.clovermarketing.ai/api/v1/daily?api_key=qqq&format=csv')), 'qqq');
  assert.equal(extractApiKey(edgeReq({ Authorization: 'Bearer h', 'x-api-key': 'x' }, 'https://b2c.clovermarketing.ai/api/v1/metrics?api_key=q')), 'h');
  assert.equal(extractApiKey(edgeReq({ 'x-api-key': 'x' }, 'https://b2c.clovermarketing.ai/api/v1/metrics?api_key=q')), 'x');
  assert.equal(extractApiKey(edgeReq()), '', 'headers.get returning null is an empty key');
});

/* ---------------------------------------------------------------------------
 * cookieFromReq / ceoUnlockedFor
 * ------------------------------------------------------------------------ */

test('cookieFromReq picks one cookie out of the header', () => {
  assert.equal(cookieFromReq({ headers: { cookie: 'a=1; clover_ceo=tok; b=2' } }, 'clover_ceo'), 'tok');
  assert.equal(cookieFromReq({ headers: { cookie: 'clover_session=v3.1.sig' } }, COOKIE), 'v3.1.sig');
  assert.equal(cookieFromReq({ headers: { cookie: 'clover_ceo=a%2Fb' } }, CEO_COOKIE), 'a/b', 'url-decoded');
  assert.equal(cookieFromReq({ headers: { cookie: ['a=1', 'clover_ceo=tok'] } }, 'clover_ceo'), 'tok', 'array header');
  assert.equal(cookieFromReq({ headers: { cookie: 'xclover_ceo=tok' } }, 'clover_ceo'), '', 'exact name match');
  assert.equal(cookieFromReq({ headers: {} }, 'clover_ceo'), '');
  assert.equal(cookieFromReq(null, 'clover_ceo'), '');
});

test('ceoUnlockedFor: no CEO_PASSWORD means everyone is unlocked', async () => {
  await withEnv({ CEO_PASSWORD: null }, async () => {
    assert.equal(await ceoUnlockedFor(nodeReq()), true);
    assert.equal(await ceoUnlockedFor(null), true);
  });
});

test('ceoUnlockedFor: CEO cookie', async () => {
  const ceo = await signScopedToken('ceo');
  assert.equal(await ceoUnlockedFor(nodeReq()), false, 'nothing presented');
  assert.equal(await ceoUnlockedFor(nodeReq({ cookie: `${CEO_COOKIE}=${ceo}` })), true);
  assert.equal(await ceoUnlockedFor(nodeReq({ cookie: `other=1; ${CEO_COOKIE}=${ceo}; more=2` })), true);

  const session = await signToken(false);
  assert.equal(await ceoUnlockedFor(nodeReq({ cookie: `${COOKIE}=${session}` })), false, 'a session alone does not unlock');
  assert.equal(await ceoUnlockedFor(nodeReq({ cookie: `${CEO_COOKIE}=${session}` })), false, 'a session token in the CEO cookie does not unlock');
  const expired = await signScopedToken('ceo', -1);
  assert.equal(await ceoUnlockedFor(nodeReq({ cookie: `${CEO_COOKIE}=${expired}` })), false, 'expired CEO cookie');
  const [v, s, exp, sig] = ceo.split('.');
  assert.equal(await ceoUnlockedFor(nodeReq({ cookie: `${CEO_COOKIE}=${v}.${s}.${exp}.${tamper(sig)}` })), false, 'tampered CEO cookie');
});

test('ceoUnlockedFor: API key', async () => {
  assert.equal(await ceoUnlockedFor(nodeReq({ authorization: `Bearer ${ENV.DASHBOARD_API_KEY}` })), true);
  assert.equal(await ceoUnlockedFor(nodeReq({ 'x-api-key': ENV.DASHBOARD_API_KEY })), true);
  assert.equal(await ceoUnlockedFor(edgeReq({ Authorization: `Bearer ${ENV.DASHBOARD_API_KEY}` })), true);
  assert.equal(await ceoUnlockedFor(nodeReq({ authorization: 'Bearer wrong-key' })), false);
  assert.equal(await ceoUnlockedFor(nodeReq({ authorization: `Bearer ${ENV.CRON_SECRET}` })), false, 'the cron secret is not an API key');
  await withEnv({ DASHBOARD_API_KEY: null }, async () => {
    assert.equal(await ceoUnlockedFor(nodeReq({ authorization: `Bearer ${ENV.DASHBOARD_API_KEY}` })), false, 'unset key fails closed');
  });
});

/* ---------------------------------------------------------------------------
 * Cookie builders
 * ------------------------------------------------------------------------ */

test('cookieDomainFor shares only across clovermarketing.ai hosts', () => {
  assert.equal(cookieDomainFor('clovermarketing.ai'), '.clovermarketing.ai');
  assert.equal(cookieDomainFor('b2c.clovermarketing.ai'), '.clovermarketing.ai');
  assert.equal(cookieDomainFor('B2C.CloverMarketing.AI'), '.clovermarketing.ai');
  assert.equal(cookieDomainFor('b2c.clovermarketing.ai:443'), '.clovermarketing.ai', 'port stripped');
  assert.equal(cookieDomainFor('b2c.clovermarketing.ai, proxy.internal'), '.clovermarketing.ai', 'first host of a comma list');
  assert.equal(cookieDomainFor('evil-clovermarketing.ai'), null);
  assert.equal(cookieDomainFor('clovermarketing.ai.attacker.com'), null);
  assert.equal(cookieDomainFor('localhost:3000'), null);
  assert.equal(cookieDomainFor('b2c-tracker.vercel.app'), null);
  assert.equal(cookieDomainFor('[::1]:3000'), null);
  assert.equal(cookieDomainFor(''), null);
  assert.equal(cookieDomainFor(undefined), null);
});

function attrs(cookie) {
  const parts = cookie.split(';').map(s => s.trim());
  const [nameValue, ...rest] = parts;
  const [name, value] = nameValue.split('=');
  const map = {};
  for (const p of rest) { const i = p.indexOf('='); if (i < 0) map[p] = true; else map[p.slice(0, i)] = p.slice(i + 1); }
  return { name, value, attrs: map };
}

test('sessionCookie: Domain only on clovermarketing.ai hosts, Max-Age only when trusted', () => {
  const shared = attrs(sessionCookie('b2c.clovermarketing.ai', 'tok', true));
  assert.equal(shared.name, COOKIE);
  assert.equal(shared.value, 'tok');
  assert.equal(shared.attrs.Domain, '.clovermarketing.ai');
  assert.equal(shared.attrs.Path, '/');
  assert.equal(shared.attrs.HttpOnly, true);
  assert.equal(shared.attrs.Secure, true);
  assert.equal(shared.attrs.SameSite, 'Lax');
  assert.equal(shared.attrs['Max-Age'], '8640000');

  const session = attrs(sessionCookie('b2c.clovermarketing.ai', 'tok', false));
  assert.equal(session.attrs.Domain, '.clovermarketing.ai');
  assert.equal('Max-Age' in session.attrs, false, 'a non-trusted login is a browser-session cookie');

  const local = attrs(sessionCookie('localhost:3000', 'tok', true));
  assert.equal('Domain' in local.attrs, false, 'host-only outside clovermarketing.ai');
  assert.equal(local.attrs['Max-Age'], '8640000');
  const preview = attrs(sessionCookie('b2c-git-x.vercel.app', 'tok', false));
  assert.equal('Domain' in preview.attrs, false);
});

test('clearCookie expires the session cookie with the same scope', () => {
  const c = attrs(clearCookie('b2c.clovermarketing.ai'));
  assert.equal(c.name, COOKIE);
  assert.equal(c.value, '');
  assert.equal(c.attrs.Domain, '.clovermarketing.ai');
  assert.equal(c.attrs['Max-Age'], '0');
  const l = attrs(clearCookie('localhost'));
  assert.equal('Domain' in l.attrs, false);
  assert.equal(l.attrs['Max-Age'], '0');
});

test('ceoCookie is host-only even on clovermarketing.ai and lasts 12 hours', () => {
  const c = attrs(ceoCookie('b2c.clovermarketing.ai', 'tok'));
  assert.equal(c.name, CEO_COOKIE);
  assert.equal(c.value, 'tok');
  assert.equal('Domain' in c.attrs, false, 'never shared with the other Clover apps');
  assert.equal(c.attrs.Path, '/');
  assert.equal(c.attrs.HttpOnly, true);
  assert.equal(c.attrs.Secure, true);
  assert.equal(c.attrs.SameSite, 'Lax');
  assert.equal(c.attrs['Max-Age'], String(12 * 3600));

  const x = attrs(clearCeoCookie('b2c.clovermarketing.ai'));
  assert.equal(x.name, CEO_COOKIE);
  assert.equal(x.value, '');
  assert.equal('Domain' in x.attrs, false);
  assert.equal(x.attrs['Max-Age'], '0');
});
