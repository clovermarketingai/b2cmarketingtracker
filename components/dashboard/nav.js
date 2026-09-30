import { useEffect, useState } from 'react';

/**
 * Whether the page was opened with ?demo=1. Always false during SSR so the
 * server and first client render agree; read it after mount (useDemoQuery).
 * @returns {boolean}
 */
export function isDemoQuery() {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('demo') === '1';
  } catch {
    return false;
  }
}

/**
 * Append ?demo=1 to an internal path when demo mode is on, keeping any hash,
 * so navigating between pages never silently drops out of demo mode.
 * Hash-only links ("#sources") are returned as-is: they keep the current
 * query by themselves.
 * @param {string} path e.g. '/daily', '/#sources', '/?x=1#top'
 * @param {boolean} demo
 * @returns {string}
 */
export function withDemo(path, demo) {
  if (!demo || !path || path.startsWith('#')) return path;
  const i = path.indexOf('#');
  const base = i === -1 ? path : path.slice(0, i);
  const hash = i === -1 ? '' : path.slice(i);
  if (/[?&]demo=1(&|$)/.test(base)) return path;
  return `${base}${base.includes('?') ? '&' : '?'}demo=1${hash}`;
}

/**
 * React hook: true once mounted when the page was opened with ?demo=1.
 * State (not a render-time window read) avoids an SSR/CSR href mismatch.
 * @returns {boolean}
 */
export function useDemoQuery() {
  const [demo, setDemo] = useState(false);
  useEffect(() => { setDemo(isDemoQuery()); }, []);
  return demo;
}
