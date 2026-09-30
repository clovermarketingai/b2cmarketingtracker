// Loads every data source for the dashboard window, in parallel, through the
// cache, and hands the normalised datasets to the aggregation engine.
//
// Each connector in ./sources exports:
//   isConfigured()                      -> boolean
//   fetch<Name>({ from, to, tz })       -> { rows: [...], meta?: {...} }
// and throws SourceError({ missingConfig: true, hint }) when not connected.

import { businessTz, todayISO, pullWindow, addDays, localDateOf } from './dates.js';
import { buildDashboard } from './compute.js';
import { demoDatasets } from './demo.js';
import { cached } from './cache.js';
import { CLIENTS } from '../clients.js';
import { SourceError } from './sources/_shared.js';
import { DATASET_LABEL } from './catalog.js';

import * as windsor from './sources/windsor.js';
import * as hsAirtable from './sources/airtableHomeService.js';
import * as whop from './sources/whop.js';
import * as costs from './sources/costs.js';
import * as b2b from './sources/b2bCrm.js';

/** Retainer / rate-card config as the engine expects it. */
export function retainersFromConfig(clients = CLIENTS) {
  return Object.entries(clients).map(([key, c]) => ({
    client: key,
    airtable: c.airtable || key,
    short: c.short || key,
    perWeek: c.rule && c.rule.type === 'weekly' ? Number(c.rule.perWeek) || 0 : 0,
    paused: !!c.paused,
  }));
}

const SOURCES = [
  { key: 'ads',        mod: windsor,    fn: 'fetchAds' },
  { key: 'hsLeads',    mod: hsAirtable, fn: 'fetchLeads' },
  { key: 'clients',    mod: hsAirtable, fn: 'fetchClients' },
  { key: 'prospects',  mod: hsAirtable, fn: 'fetchProspects' },
  { key: 'closerEod',  mod: hsAirtable, fn: 'fetchCloserEod' },
  { key: 'whop',       mod: whop,       fn: 'fetchPayments' },
  { key: 'costs',      mod: costs,      fn: 'fetchCosts' },
  { key: 'targets',    mod: costs,      fn: 'fetchTargets' },
  { key: 'b2b',        mod: b2b,        fn: 'fetchFunnel' },
];

function describeError(e) {
  if (e instanceof SourceError) {
    return { status: e.missingConfig ? 'unconfigured' : 'error', error: e.message, hint: e.hint || null };
  }
  return { status: 'error', error: String(e && e.message || e), hint: null };
}

/**
 * Fetch every source for the window. Returns { datasets, sources, availability, warnings }.
 * Never throws for a single failing source; the failure is reported in `sources`.
 */
export async function loadDatasets({ today, tz, refresh = false } = {}) {
  const win = pullWindow(today);
  // One extra day on each side: Airtable timestamps are UTC and get shifted
  // into the business timezone, so a record can move a day either way.
  const args = { from: addDays(win.from, -1), to: addDays(win.to, 1), tz };
  const datasets = { retainers: retainersFromConfig() };
  const sources = { retainers: { status: 'ok', label: DATASET_LABEL.retainers, count: datasets.retainers.length, fetchedAt: null, ms: 0, stale: false } };
  const availability = { retainers: true };
  const warnings = [];

  const results = await Promise.allSettled(SOURCES.map(async (s) => {
    const label = DATASET_LABEL[s.key] || s.key;
    if (typeof s.mod.isConfigured === 'function' && !s.mod.isConfigured()) {
      const hint = typeof s.mod.setupHint === 'function' ? s.mod.setupHint() : null;
      return { key: s.key, status: 'unconfigured', label, hint, count: 0, fetchedAt: null, ms: 0, stale: false, value: null };
    }
    const cacheKey = `${s.key}:${args.from}:${args.to}:${tz}`;
    const r = await cached(cacheKey, () => s.mod[s.fn](args), { refresh });
    const value = r.value;
    const count = Array.isArray(value?.rows) ? value.rows.length : (value && typeof value === 'object' ? Object.keys(value).length : 0);
    const out = { key: s.key, status: 'ok', label, count, fetchedAt: r.fetchedAt, ms: r.ms, stale: r.stale, value, meta: value?.meta || null };
    if (r.error) { out.status = 'stale'; Object.assign(out, { error: describeError(r.error).error }); }
    return out;
  }));

  results.forEach((res, i) => {
    const s = SOURCES[i];
    const label = DATASET_LABEL[s.key] || s.key;
    if (res.status === 'fulfilled') {
      const r = res.value;
      sources[s.key] = { status: r.status, label, count: r.count, fetchedAt: r.fetchedAt ? new Date(r.fetchedAt).toISOString() : null, ms: r.ms, stale: !!r.stale, hint: r.hint || null, error: r.error || null, meta: r.meta || null };
      if (r.status === 'ok' || r.status === 'stale') {
        datasets[s.key] = r.value;
        availability[s.key] = true;
        if (r.status === 'stale') warnings.push(`${label}: showing the last good pull (${r.error}).`);
        for (const w of (r.meta && r.meta.warnings) || []) warnings.push(`${label}: ${w}`);
      } else {
        datasets[s.key] = null;
        availability[s.key] = false;
      }
    } else {
      const d = describeError(res.reason);
      sources[s.key] = { status: d.status, label, count: 0, fetchedAt: null, ms: 0, stale: false, hint: d.hint, error: d.error, meta: null };
      datasets[s.key] = null;
      availability[s.key] = false;
      if (d.status === 'error') warnings.push(`${label}: ${d.error}`);
    }
  });

  return { datasets, sources, availability, warnings, window: args };
}

/**
 * The whole dashboard payload. `demo` swaps every source for synthetic data.
 */
export async function loadDashboard({ refresh = false, demo = false, ceoUnlocked = true, now = new Date() } = {}) {
  const tz = businessTz();
  const today = todayISO(tz, now);

  if (demo) {
    const { datasets, targets } = demoDatasets(today);
    const availability = Object.fromEntries(Object.keys(datasets).map(k => [k, true]));
    availability.targets = true;
    const sources = Object.fromEntries(Object.keys(availability).map(k => [k, { status: 'demo', label: DATASET_LABEL[k] || k, count: Array.isArray(datasets[k]?.rows) ? datasets[k].rows.length : 0, fetchedAt: now.toISOString(), ms: 0, stale: false }]));
    const payload = buildDashboard({ today, tz, datasets, availability, targets, ceoUnlocked, sources, warnings: ['Demo data. Nothing here is real.'] });
    payload.generatedAt = now.toISOString();
    payload.mode = 'demo';
    return payload;
  }

  const { datasets, sources, availability, warnings, window } = await loadDatasets({ today, tz, refresh });
  const targets = datasets.targets && datasets.targets.byMetric ? datasets.targets.byMetric : {};
  const payload = buildDashboard({ today, tz, datasets, availability, targets, ceoUnlocked, sources, warnings });
  payload.generatedAt = now.toISOString();
  payload.mode = 'live';
  payload.window = window;
  return payload;
}

export { localDateOf };
