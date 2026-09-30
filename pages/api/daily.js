// GET /api/daily?refresh=1
// All-time per-(date, client) P&L for the /daily page. Pulls Facebook ads
// (Windsor.ai) and Airtable leads since 2024-01-01 through the cache, then
// aggregates server-side with lib/dashboard/daily.js.

import { cached } from '../../lib/dashboard/cache';
import { buildDaily } from '../../lib/dashboard/daily';
import { demoDatasets } from '../../lib/dashboard/demo';
import { retainersFromConfig } from '../../lib/dashboard/load';
import { businessTz, todayISO, addDays } from '../../lib/dashboard/dates';
import { DATASET_LABEL } from '../../lib/dashboard/catalog';
import { SourceError } from '../../lib/dashboard/sources/_shared';
import * as windsor from '../../lib/dashboard/sources/windsor';
import * as hs from '../../lib/dashboard/sources/airtableHomeService';

export const config = { maxDuration: 60 };

const ALL_TIME_FROM = '2024-01-01';
const TTL_MS = 10 * 60 * 1000; // all-time pulls are slow; keep them 10 minutes

function describe(e) {
  if (e instanceof SourceError) return { status: e.missingConfig ? 'unconfigured' : 'error', error: e.message, hint: e.hint || null };
  return { status: 'error', error: String(e && e.message || e), hint: null };
}

async function pull(key, label, mod, fn, args, refresh) {
  if (typeof mod.isConfigured === 'function' && !mod.isConfigured()) {
    return { status: 'unconfigured', label, hint: typeof mod.setupHint === 'function' ? mod.setupHint() : null, value: null, count: 0, fetchedAt: null, ms: 0, stale: false };
  }
  try {
    const r = await cached(key, () => mod[fn](args), { ttlMs: TTL_MS, refresh });
    return {
      status: r.error ? 'stale' : 'ok', label, value: r.value, count: r.value?.rows?.length || 0,
      fetchedAt: r.fetchedAt ? new Date(r.fetchedAt).toISOString() : null, ms: r.ms, stale: r.stale,
      error: r.error ? describe(r.error).error : null, hint: null, meta: r.value?.meta || null,
    };
  } catch (e) {
    const d = describe(e);
    return { status: d.status, label, value: null, count: 0, fetchedAt: null, ms: 0, stale: false, error: d.error, hint: d.hint, meta: null };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  const refresh = req.query.refresh === '1';
  const tz = businessTz();
  const today = todayISO(tz);
  const to = addDays(today, 1);

  if (req.query.demo === '1') {
    const { datasets, span } = demoDatasets(today);
    const built = buildDaily({ ads: datasets.ads, hsLeads: datasets.hsLeads, retainers: datasets.retainers, today });
    const demoSource = (label, n) => ({ status: 'demo', label, count: n, fetchedAt: new Date().toISOString(), ms: 0, stale: false, error: null, hint: null });
    return res.status(200).json({
      tz, today, from: span.from, mode: 'demo',
      rows: built.rows, totals: built.totals, clientOptions: built.clientOptions,
      sources: { ads: demoSource(DATASET_LABEL.ads, datasets.ads.rows.length), hsLeads: demoSource(DATASET_LABEL.hsLeads, datasets.hsLeads.rows.length) },
      warnings: ['Demo data. Nothing here is real.', ...built.warnings],
      fetched_at: new Date().toISOString(),
    });
  }

  const [ads, leads] = await Promise.all([
    pull(`daily:ads:${today}`, DATASET_LABEL.ads, windsor, 'fetchAllTimeAds', { tz }, refresh),
    pull(`daily:leads:${today}`, DATASET_LABEL.hsLeads, hs, 'fetchLeads', { from: ALL_TIME_FROM, to, tz }, refresh),
  ]);

  const retainers = retainersFromConfig();
  const built = buildDaily({ ads: ads.value, hsLeads: leads.value, retainers, today });
  const warnings = [...built.warnings];
  for (const s of [ads, leads]) {
    if (s.status === 'error') warnings.push(`${s.label}: ${s.error}`);
    if (s.status === 'stale') warnings.push(`${s.label}: showing the last good pull (${s.error}).`);
    for (const w of (s.meta && s.meta.warnings) || []) warnings.push(`${s.label}: ${w}`);
  }
  const strip = ({ value, meta, ...rest }) => rest;
  return res.status(200).json({
    tz, today, from: ALL_TIME_FROM,
    rows: built.rows, totals: built.totals, clientOptions: built.clientOptions,
    sources: { ads: strip(ads), hsLeads: strip(leads) },
    warnings,
    fetched_at: new Date().toISOString(),
  });
}
