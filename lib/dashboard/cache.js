// In-memory memo for upstream pulls. Lives for the lifetime of the serverless
// instance (warm invocations share it), which is exactly the window we want:
// repeated dashboard loads inside a few minutes hit upstream once. A cold
// instance simply refetches.
//
// Semantics (deliberately simple, because a Vercel function cannot keep
// working after it has answered): a fresh entry is served as-is; an expired
// entry is re-fetched and the caller waits for it; only when that re-fetch
// FAILS is the last good value served, marked stale with the error attached,
// so an upstream hiccup never blanks the dashboard. Concurrent callers share
// one in-flight fetch.

const store = new Map();
const MAX_ENTRIES = 200;

export function cacheTtlMs() {
  const s = Number(process.env.DASHBOARD_CACHE_TTL || 180);
  return (Number.isFinite(s) && s > 0 ? s : 180) * 1000;
}

function evict(ttlMs, now) {
  for (const [k, e] of store) {
    if (e.inflight) continue;
    if (!e.fetchedAt || now - e.fetchedAt > ttlMs * 4) store.delete(k);
  }
  if (store.size > MAX_ENTRIES) {
    const oldest = [...store.entries()].filter(([, e]) => !e.inflight).sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
    for (const [k] of oldest.slice(0, store.size - MAX_ENTRIES)) store.delete(k);
  }
}

/**
 * cached(key, fn, { ttlMs, refresh })
 *   -> { value, fetchedAt, ms, stale, fromCache, error }
 */
export async function cached(key, fn, { ttlMs = cacheTtlMs(), refresh = false } = {}) {
  const now = Date.now();
  evict(ttlMs, now);
  let entry = store.get(key);
  const age = entry && entry.fetchedAt ? now - entry.fetchedAt : Infinity;

  if (entry && !refresh && age < ttlMs) {
    return { value: entry.value, fetchedAt: entry.fetchedAt, ms: entry.ms, stale: false, fromCache: true, error: null };
  }

  if (!entry) { entry = { value: undefined, fetchedAt: 0, ms: 0, inflight: null }; store.set(key, entry); }

  if (!entry.inflight) {
    const started = Date.now();
    entry.inflight = Promise.resolve().then(fn).then(value => {
      entry.value = value; entry.fetchedAt = Date.now(); entry.ms = Date.now() - started;
      return value;
    }).finally(() => { entry.inflight = null; });
  }

  try {
    const value = await entry.inflight;
    return { value, fetchedAt: entry.fetchedAt, ms: entry.ms, stale: false, fromCache: false, error: null };
  } catch (err) {
    if (entry.fetchedAt) {
      return { value: entry.value, fetchedAt: entry.fetchedAt, ms: entry.ms, stale: true, fromCache: true, error: err };
    }
    store.delete(key);
    throw err;
  }
}

export function clearCache(prefix = '') {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}

export function cacheStats() {
  return [...store.entries()].map(([key, e]) => ({ key, fetchedAt: e.fetchedAt, ageMs: e.fetchedAt ? Date.now() - e.fetchedAt : null, ms: e.ms, inflight: !!e.inflight }));
}
