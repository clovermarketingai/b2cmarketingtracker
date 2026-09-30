import test from 'node:test';
import assert from 'node:assert/strict';
import { cached, clearCache, cacheStats, cacheTtlMs } from '../lib/dashboard/cache.js';

// cache.js only reads the clock through Date.now(), so each test pins it and
// moves it explicitly. No real waiting anywhere in this file.
const realNow = Date.now;
let clock = 1_700_000_000_000;
const tick = (ms) => { clock += ms; };

test.beforeEach(() => { clock = 1_700_000_000_000; Date.now = () => clock; clearCache(); });
test.afterEach(() => { Date.now = realNow; clearCache(); });

const TTL = 1000;

/** A fetcher that counts its calls and returns the values given, in order (an Error instance is thrown). */
function fetcher(...values) {
  const fn = async () => {
    fn.calls++;
    const v = values.length > 1 ? values.shift() : values[0];
    if (v instanceof Error) throw v;
    return v;
  };
  fn.calls = 0;
  return fn;
}

/** A fetcher whose completion the test controls. */
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  const fn = () => { fn.calls++; return promise; };
  fn.calls = 0;
  return { fn, resolve, reject };
}

const keys = () => cacheStats().map(s => s.key).sort();

test('cacheTtlMs reads DASHBOARD_CACHE_TTL in seconds and falls back to 180', () => {
  const saved = process.env.DASHBOARD_CACHE_TTL;
  try {
    delete process.env.DASHBOARD_CACHE_TTL;
    assert.equal(cacheTtlMs(), 180_000);
    process.env.DASHBOARD_CACHE_TTL = '30';
    assert.equal(cacheTtlMs(), 30_000);
    process.env.DASHBOARD_CACHE_TTL = '0';
    assert.equal(cacheTtlMs(), 180_000, 'non-positive falls back');
    process.env.DASHBOARD_CACHE_TTL = 'abc';
    assert.equal(cacheTtlMs(), 180_000, 'non-numeric falls back');
  } finally {
    if (saved == null) delete process.env.DASHBOARD_CACHE_TTL; else process.env.DASHBOARD_CACHE_TTL = saved;
  }
});

test('cold miss fetches and stores; a fresh hit is served from memory without calling upstream', async () => {
  const fn = fetcher({ rows: [1, 2, 3] });
  const first = await cached('k', fn, { ttlMs: TTL });
  assert.equal(fn.calls, 1);
  assert.deepEqual(first.value, { rows: [1, 2, 3] });
  assert.equal(first.fromCache, false);
  assert.equal(first.stale, false);
  assert.equal(first.error, null);
  assert.equal(first.fetchedAt, clock);

  tick(TTL - 1);
  const hit = await cached('k', fn, { ttlMs: TTL });
  assert.equal(fn.calls, 1, 'no upstream call while fresh');
  assert.equal(hit.fromCache, true);
  assert.equal(hit.stale, false);
  assert.equal(hit.error, null);
  assert.equal(hit.value, first.value, 'the same object is served');
  assert.equal(hit.fetchedAt, first.fetchedAt);
});

test('an expired entry is re-fetched synchronously: the caller waits for and gets the new value', async () => {
  const fn = fetcher('v1', 'v2');
  await cached('k', fn, { ttlMs: TTL });
  tick(TTL); // age == ttl is expired

  const r = await cached('k', fn, { ttlMs: TTL });
  assert.equal(fn.calls, 2, 'upstream called again');
  assert.equal(r.value, 'v2', 'the new value, not the old one');
  assert.equal(r.fromCache, false);
  assert.equal(r.stale, false);
  assert.equal(r.error, null);
  assert.equal(r.fetchedAt, clock, 'stamped with the re-fetch time');

  // And it is fresh again afterwards.
  tick(TTL / 2);
  const again = await cached('k', fn, { ttlMs: TTL });
  assert.equal(fn.calls, 2);
  assert.equal(again.fromCache, true);
  assert.equal(again.value, 'v2');
});

test('nothing is served stale while a re-fetch is running: the second caller waits too', async () => {
  const good = fetcher('v1');
  await cached('k', good, { ttlMs: TTL });
  tick(TTL + 1);

  const d = deferred();
  const p1 = cached('k', d.fn, { ttlMs: TTL });
  const p2 = cached('k', d.fn, { ttlMs: TTL });
  let settled = 0;
  p1.then(() => settled++); p2.then(() => settled++);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, 0, 'neither caller got the old value early');
  assert.equal(d.fn.calls, 1, 'one in-flight refetch shared by both');

  d.resolve('v2');
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1.value, 'v2');
  assert.equal(r2.value, 'v2');
  assert.equal(r1.stale, false);
  assert.equal(r2.stale, false);
});

test('when the re-fetch fails the last good value is served, marked stale with the error', async () => {
  const boom = new Error('upstream 500');
  const fn = fetcher('v1', boom, 'v3');
  const first = await cached('k', fn, { ttlMs: TTL });
  const goodAt = first.fetchedAt;
  tick(TTL + 5);

  const r = await cached('k', fn, { ttlMs: TTL });
  assert.equal(fn.calls, 2, 'the refetch was attempted');
  assert.equal(r.value, 'v1', 'last good value');
  assert.equal(r.stale, true);
  assert.equal(r.fromCache, true);
  assert.equal(r.error, boom, 'the error travels with the value');
  assert.equal(r.fetchedAt, goodAt, 'still stamped with the good pull');

  // The failure does not poison the entry: the next expired call tries again
  // and, when upstream recovers, serves the new value as fresh.
  const r2 = await cached('k', fn, { ttlMs: TTL });
  assert.equal(fn.calls, 3);
  assert.equal(r2.value, 'v3');
  assert.equal(r2.stale, false);
  assert.equal(r2.error, null);
  assert.equal(r2.fetchedAt, clock);
});

test('a failure with no earlier good value rejects and leaves nothing in the store', async () => {
  const fn = fetcher(new Error('cold fail'));
  await assert.rejects(() => cached('k', fn, { ttlMs: TTL }), /cold fail/);
  assert.equal(fn.calls, 1);
  assert.deepEqual(keys(), [], 'no placeholder left behind');

  // The next call is a plain cold miss again.
  const ok = fetcher('v1');
  const r = await cached('k', ok, { ttlMs: TTL });
  assert.equal(r.value, 'v1');
  assert.equal(r.fromCache, false);
});

test('refresh: true bypasses a fresh entry and awaits a new pull', async () => {
  const fn = fetcher('v1', 'v2');
  await cached('k', fn, { ttlMs: TTL });
  tick(10);
  const r = await cached('k', fn, { ttlMs: TTL, refresh: true });
  assert.equal(fn.calls, 2);
  assert.equal(r.value, 'v2');
  assert.equal(r.fromCache, false);
  assert.equal(r.stale, false);
  assert.equal(r.fetchedAt, clock);

  // A refresh that fails still falls back to the last good value.
  const bad = fetcher(new Error('refresh failed'));
  const s = await cached('k', bad, { ttlMs: TTL, refresh: true });
  assert.equal(s.value, 'v2');
  assert.equal(s.stale, true);
  assert.equal(s.error.message, 'refresh failed');

  // Without refresh the entry (re-stamped by the successful refresh) is still fresh.
  const hit = await cached('k', fn, { ttlMs: TTL });
  assert.equal(fn.calls, 2);
  assert.equal(hit.fromCache, true);
  assert.equal(hit.value, 'v2');
});

test('concurrent cold callers share one in-flight fetch and all get the value', async () => {
  const d = deferred();
  const calls = Array.from({ length: 5 }, () => cached('k', d.fn, { ttlMs: TTL }));
  await Promise.resolve();
  assert.equal(d.fn.calls, 1, 'one upstream call for five callers');
  assert.deepEqual(keys(), ['k'], 'a placeholder holds the in-flight promise');

  d.resolve({ rows: ['x'] });
  const results = await Promise.all(calls);
  assert.equal(d.fn.calls, 1);
  for (const r of results) {
    assert.deepEqual(r.value, { rows: ['x'] });
    assert.equal(r.stale, false);
    assert.equal(r.error, null);
    assert.equal(r.fetchedAt, clock);
  }
  assert.equal(results[0].value, results[4].value, 'the same object');
});

test('concurrent refresh: true callers also share one in-flight fetch', async () => {
  await cached('k', fetcher('v1'), { ttlMs: TTL });
  const d = deferred();
  const calls = Array.from({ length: 3 }, () => cached('k', d.fn, { ttlMs: TTL, refresh: true }));
  await Promise.resolve();
  assert.equal(d.fn.calls, 1);
  d.resolve('v2');
  const results = await Promise.all(calls);
  assert.deepEqual(results.map(r => r.value), ['v2', 'v2', 'v2']);
  assert.deepEqual(results.map(r => r.fromCache), [false, false, false]);
});

test('concurrent cold callers all reject when the shared fetch fails', async () => {
  const d = deferred();
  const calls = Array.from({ length: 3 }, () => cached('k', d.fn, { ttlMs: TTL }));
  await Promise.resolve();
  assert.equal(d.fn.calls, 1);
  d.reject(new Error('shared failure'));
  const settled = await Promise.allSettled(calls);
  assert.deepEqual(settled.map(s => s.status), ['rejected', 'rejected', 'rejected']);
  for (const s of settled) assert.match(s.reason.message, /shared failure/);
  assert.deepEqual(keys(), [], 'store empty after a cold failure');
});

test('a synchronous throw inside the fetcher is handled like a rejection', async () => {
  const fn = () => { fn.calls++; throw new Error('sync boom'); };
  fn.calls = 0;
  await assert.rejects(() => cached('k', fn, { ttlMs: TTL }), /sync boom/);
  await cached('k', fetcher('v1'), { ttlMs: TTL });
  tick(TTL + 1);
  const r = await cached('k', fn, { ttlMs: TTL });
  assert.equal(r.value, 'v1');
  assert.equal(r.stale, true);
  assert.match(r.error.message, /sync boom/);
});

test('keys are independent', async () => {
  const a = fetcher('A');
  const b = fetcher('B');
  await cached('a', a, { ttlMs: TTL });
  await cached('b', b, { ttlMs: TTL });
  tick(TTL + 1);
  const ra = await cached('a', a, { ttlMs: TTL });
  assert.equal(a.calls, 2);
  assert.equal(b.calls, 1, 'refetching a does not touch b');
  assert.equal(ra.value, 'A');
});

test('entries older than 4x ttl are evicted on the next cache access', async () => {
  await cached('old', fetcher('o'), { ttlMs: TTL });
  tick(TTL * 2);
  await cached('mid', fetcher('m'), { ttlMs: TTL });
  assert.deepEqual(keys(), ['mid', 'old']);

  tick(TTL * 2 + 1); // old is now > 4x ttl, mid is 2x ttl + 1
  await cached('new', fetcher('n'), { ttlMs: TTL });
  assert.deepEqual(keys(), ['mid', 'new'], 'old was swept, mid (still within 4x) stays');

  // Once swept, the stale fallback is gone too: a failing re-fetch rejects.
  await assert.rejects(() => cached('old', fetcher(new Error('gone')), { ttlMs: TTL }), /gone/);
});

test('an in-flight entry is never evicted by the sweep', async () => {
  const d = deferred();
  const p = cached('slow', d.fn, { ttlMs: TTL });
  await Promise.resolve();
  tick(TTL * 10);
  await cached('other', fetcher('x'), { ttlMs: TTL });
  assert.deepEqual(keys(), ['other', 'slow'], 'the placeholder with the running fetch survives');
  d.resolve('done');
  const r = await p;
  assert.equal(r.value, 'done');
  assert.equal(d.fn.calls, 1);
});

test('the store is capped: the oldest entries go first', async () => {
  const CAP = 200;
  const extra = 5;
  for (let i = 0; i < CAP + extra; i++) {
    await cached(`k${String(i).padStart(3, '0')}`, fetcher(i), { ttlMs: 1e9 });
    tick(1);
  }
  // The sweep runs on entry to cached(); one more access on a fresh key trims
  // the last insert back under the cap.
  const last = `k${String(CAP + extra - 1).padStart(3, '0')}`;
  const r = await cached(last, fetcher('never'), { ttlMs: 1e9 });
  assert.equal(r.fromCache, true);
  assert.equal(r.value, CAP + extra - 1);

  const ks = keys();
  assert.equal(ks.length, CAP, `capped at ${CAP}, got ${ks.length}`);
  for (let i = 0; i < extra; i++) assert.equal(ks.includes(`k${String(i).padStart(3, '0')}`), false, `k${i} evicted`);
  assert.equal(ks.includes(`k${String(extra).padStart(3, '0')}`), true, 'the first survivor');
  assert.equal(ks.includes(last), true);
});

test('clearCache clears everything, or only the keys under a prefix', async () => {
  await cached('ads:1', fetcher(1), { ttlMs: TTL });
  await cached('ads:2', fetcher(2), { ttlMs: TTL });
  await cached('whop:1', fetcher(3), { ttlMs: TTL });
  clearCache('ads:');
  assert.deepEqual(keys(), ['whop:1']);
  clearCache();
  assert.deepEqual(keys(), []);
  const fn = fetcher(4);
  await cached('whop:1', fn, { ttlMs: TTL });
  assert.equal(fn.calls, 1, 'cleared keys are cold again');
});

test('cacheStats reports age and in-flight state', async () => {
  await cached('a', fetcher('A'), { ttlMs: TTL });
  tick(250);
  const d = deferred();
  const p = cached('b', d.fn, { ttlMs: TTL });
  await Promise.resolve();
  const stats = Object.fromEntries(cacheStats().map(s => [s.key, s]));
  assert.equal(stats.a.ageMs, 250);
  assert.equal(stats.a.inflight, false);
  assert.equal(stats.b.ageMs, null, 'never fetched yet');
  assert.equal(stats.b.inflight, true);
  d.resolve('B');
  await p;
  assert.equal(Object.fromEntries(cacheStats().map(s => [s.key, s])).b.inflight, false);
});
