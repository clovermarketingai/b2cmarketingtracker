// In-memory memo with stale-while-revalidate. Lives for the lifetime of the
// serverless instance (warm invocations share it), which is exactly the
// window we want: repeated dashboard loads inside a few minutes hit upstream
// once. A cold instance simply refetches.

const store = new Map();

export function cacheTtlMs() {
  const s = Number(process.env.DASHBOARD_CACHE_TTL || 180);
  return (Number.isFinite(s) && s > 0 ? s : 180) * 1000;
}

/**
 * cached(key, fn, { ttlMs, refresh })
 *   -> { value, fetchedAt, ms, stale, fromCache, error }
 * Fresh entry: returned as-is. Stale entry (older than ttl but younger than
 * 4×ttl): returned immediately while a background refresh runs. Older than
 * that, or absent, or refresh=true: awaited. An upstream failure keeps serving
 * the last good value (marked stale, with the error attached) rather than
 * blanking the dashboard.
 */
export async function cached(key, fn, { ttlMs = cacheTtlMs(), refresh = false } = {}) {
  const now = Date.now();
  const entry = store.get(key);
  const age = entry ? now - entry.fetchedAt : Infinity;

  if (entry && !refresh && age < ttlMs) {
    return { value: entry.value, fetchedAt: entry.fetchedAt, ms: entry.ms, stale: false, fromCache: true, error: null };
  }

  const run = () => {
    if (entry?.inflight) return entry.inflight;
    const started = Date.now();
    const p = Promise.resolve().then(fn).then(value => {
      store.set(key, { value, fetchedAt: Date.now(), ms: Date.now() - started, inflight: null });
      return value;
    }).finally(() => {
      const e = store.get(key);
      if (e) e.inflight = null;
    });
    if (entry) entry.inflight = p; else store.set(key, { value: undefined, fetchedAt: 0, ms: 0, inflight: p });
    return p;
  };

  if (entry && entry.fetchedAt && !refresh && age < ttlMs * 4) {
    run().catch(() => {});
    return { value: entry.value, fetchedAt: entry.fetchedAt, ms: entry.ms, stale: true, fromCache: true, error: null };
  }

  try {
    const value = await run();
    const e = store.get(key);
    return { value, fetchedAt: e?.fetchedAt || Date.now(), ms: e?.ms || 0, stale: false, fromCache: false, error: null };
  } catch (err) {
    if (entry && entry.fetchedAt) {
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
  return [...store.entries()].map(([key, e]) => ({ key, fetchedAt: e.fetchedAt, ageMs: e.fetchedAt ? Date.now() - e.fetchedAt : null, ms: e.ms }));
}
