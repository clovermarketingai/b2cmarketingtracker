import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDatasets, loadDashboard, retainersFromConfig } from '../lib/dashboard/load.js';
import { DATASET_LABEL, SECTIONS } from '../lib/dashboard/catalog.js';
import { CLIENTS } from '../lib/clients.js';

// Every connector decides isConfigured() from these variables. With all of
// them unset, loadDatasets must report each source as unconfigured without
// touching the network or the cache.
const SOURCE_ENV = [
  'WINDSOR_API_KEY',
  'AIRTABLE_API_KEY', 'AIRTABLE_TOKEN', 'AIRTABLE_CRM_BASE',
  'WHOP_API_KEY', 'WHOP_COMPANY_ID',
];
for (const k of SOURCE_ENV) delete process.env[k];
process.env.DASHBOARD_TZ = 'America/Toronto';

// Any upstream call is a test failure: nothing here may reach the network.
let fetchCalls = 0;
globalThis.fetch = async (url) => { fetchCalls++; throw new Error(`unexpected fetch ${url}`); };

/** The dataset keys loadDatasets pulls from a connector (everything but the rate card). */
const FETCHED = Object.keys(DATASET_LABEL).filter(k => k !== 'retainers');
const TZ = 'America/Toronto';
const TODAY = '2026-09-30';
const ISO = /^\d{4}-\d{2}-\d{2}$/;

test('loadDatasets with nothing configured reports every source as unconfigured with a hint', async () => {
  const res = await loadDatasets({ today: TODAY, tz: TZ });
  assert.equal(fetchCalls, 0, 'no network');

  assert.deepEqual(Object.keys(res.sources).sort(), [...FETCHED, 'retainers'].sort());
  assert.deepEqual(Object.keys(res.availability).sort(), [...FETCHED, 'retainers'].sort());

  for (const k of FETCHED) {
    const s = res.sources[k];
    assert.equal(s.status, 'unconfigured', `${k} status`);
    assert.equal(typeof s.hint, 'string', `${k} hint present`);
    assert.ok(s.hint.length > 20, `${k} hint names what to set: ${s.hint}`);
    assert.equal(s.label, DATASET_LABEL[k], `${k} label`);
    assert.equal(s.count, 0, `${k} count`);
    assert.equal(s.fetchedAt, null, `${k} fetchedAt`);
    assert.equal(s.stale, false, `${k} stale`);
    assert.equal(s.error, null, `${k} error`);
    assert.equal(res.availability[k], false, `${k} availability`);
    assert.equal(res.datasets[k], null, `${k} dataset`);
  }

  // The rate card never needs a connection.
  assert.equal(res.sources.retainers.status, 'ok');
  assert.equal(res.sources.retainers.count, Object.keys(CLIENTS).length);
  assert.equal(res.availability.retainers, true);
  assert.equal(res.datasets.retainers.length, Object.keys(CLIENTS).length);

  // Unconfigured is not an error: nothing to warn about.
  assert.deepEqual(res.warnings, []);

  // The pull window brackets the dashboard window by a day on each side.
  assert.match(res.window.from, ISO);
  assert.match(res.window.to, ISO);
  assert.equal(res.window.tz, TZ);
  assert.ok(res.window.from < TODAY && res.window.to > TODAY, `${res.window.from}..${res.window.to}`);
});

test('the hint of each unconfigured source names its variable', async () => {
  const { sources } = await loadDatasets({ today: TODAY, tz: TZ });
  assert.match(sources.ads.hint, /WINDSOR_API_KEY/);
  for (const k of ['hsLeads', 'clients', 'prospects', 'closerEod', 'costs', 'targets']) assert.match(sources[k].hint, /AIRTABLE_API_KEY/, k);
  assert.match(sources.b2b.hint, /AIRTABLE_CRM_BASE/);
  assert.match(sources.whop.hint, /WHOP_API_KEY/);
  assert.match(sources.whop.hint, /WHOP_COMPANY_ID/);
});

test('loadDashboard({ demo: true }) returns mode demo with every section on synthetic data', async () => {
  const now = new Date('2026-09-30T15:00:00Z');
  const payload = await loadDashboard({ demo: true, now });
  assert.equal(fetchCalls, 0, 'no network');

  assert.equal(payload.mode, 'demo');
  assert.equal(payload.generatedAt, now.toISOString());
  assert.equal(payload.tz, TZ);
  assert.equal(payload.today, TODAY);

  // Every non-CEO section, in catalog order, with every catalog row.
  const expectSections = SECTIONS.filter(s => !s.ceoOnly);
  assert.deepEqual(payload.sections.map(s => s.id), expectSections.map(s => s.id));
  for (const s of expectSections) {
    const got = payload.sections.find(x => x.id === s.id);
    assert.equal(got.title, s.title);
    assert.deepEqual(got.rows.map(r => r.id), s.rows.map(r => r.id), `${s.id} rows`);
  }

  // The CEO section is unlocked by default and carries its rows.
  const ceoSection = SECTIONS.find(s => s.ceoOnly);
  assert.equal(payload.ceo.locked, false);
  assert.equal(payload.ceo.id, ceoSection.id);
  assert.deepEqual(payload.ceo.rows.map(r => r.id), ceoSection.rows.map(r => r.id));

  // Every source is available and marked demo; the demo warning is present.
  assert.deepEqual(Object.keys(payload.availability).sort(), [...FETCHED, 'retainers'].sort());
  for (const k of Object.keys(payload.availability)) {
    assert.equal(payload.availability[k], true, `${k} available`);
    assert.equal(payload.sources[k].status, 'demo', `${k} demo status`);
    assert.equal(payload.sources[k].label, DATASET_LABEL[k]);
  }
  assert.ok(payload.warnings.some(w => /demo/i.test(w)), 'demo warning');

  // Synthetic data actually produces numbers, not a wall of dashes.
  const primary = payload.sections.flatMap(s => s.rows).filter(r => r.emphasis === 'primary');
  assert.ok(primary.length > 0);
  for (const r of primary) {
    assert.equal(r.unavailable, null, `${r.id} has every dataset it needs`);
    assert.notEqual(r.status, 'no_data', `${r.id} is computable`);
  }
  assert.ok(primary.some(r => Number.isFinite(r.values.mtd) && r.values.mtd !== 0), 'some non-zero MTD value');

  // The detail tables and sparkline series are present in their live shapes.
  for (const t of ['clients', 'closers', 'campaigns', 'whopProducts']) assert.ok(Array.isArray(payload.tables[t]), `tables.${t}`);
  assert.ok(payload.tables.clients.length > 0);
  assert.equal(payload.series.dates.length, 30);
  assert.equal(payload.series.dates[29], TODAY);
  assert.deepEqual(Object.keys(payload.ranges).sort(), ['l30d', 'l7d', 'lastMonth', 'mtd', 'today', 'yesterday']);
});

test('loadDashboard({ demo: true, ceoUnlocked: false }) locks the CEO section', async () => {
  const payload = await loadDashboard({ demo: true, ceoUnlocked: false, now: new Date('2026-09-30T15:00:00Z') });
  assert.equal(payload.mode, 'demo');
  assert.deepEqual(payload.ceo, { locked: true });
  assert.equal(payload.sections.some(s => s.id === 'ceo'), false);
});

test('loadDashboard live with nothing configured still answers, with every row a dash', async () => {
  const payload = await loadDashboard({ now: new Date('2026-09-30T15:00:00Z') });
  assert.equal(fetchCalls, 0, 'no network');
  assert.equal(payload.mode, 'live');
  assert.equal(payload.today, TODAY);
  for (const k of FETCHED) {
    assert.equal(payload.sources[k].status, 'unconfigured', k);
    assert.equal(payload.availability[k], false, k);
  }
  assert.equal(payload.availability.retainers, true);
  assert.deepEqual(payload.sections.map(s => s.id), SECTIONS.filter(s => !s.ceoOnly).map(s => s.id));
  for (const r of [...payload.ceo.rows, ...payload.sections.flatMap(s => s.rows)]) {
    if (r.needs.length === 0 || r.needs.every(k => k === 'retainers')) continue;
    assert.equal(r.status, 'no_data', `${r.id} status`);
    assert.equal(r.values.mtd, null, `${r.id} mtd`);
    assert.ok(Array.isArray(r.unavailable) && r.unavailable.length > 0, `${r.id} names the missing sources`);
  }
  assert.equal(payload.window.tz, TZ);
});

test('retainersFromConfig maps the rate card into the engine shape', () => {
  const rows = retainersFromConfig({
    '(A) Weekly Co': { short: 'A', airtable: 'Weekly Co', rule: { type: 'weekly', perWeek: 700, from: '2026-09-03T00:00:00Z', to: '2026-09-20' } },
    '(B) Per Lead': { short: 'B', airtable: 'Per Lead LLC', rule: { type: 'perLead', rate: 85 } },
    '(C) Paused': { rule: { type: 'none' }, paused: true },
  });
  assert.deepEqual(rows, [
    { client: '(A) Weekly Co', airtable: 'Weekly Co', short: 'A', perWeek: 700, from: '2026-09-03', to: '2026-09-20', paused: false },
    { client: '(B) Per Lead', airtable: 'Per Lead LLC', short: 'B', perWeek: 0, from: null, to: null, paused: false },
    { client: '(C) Paused', airtable: '(C) Paused', short: '(C) Paused', perWeek: 0, from: null, to: null, paused: true },
  ]);
  // The real rate card round-trips: one row per client, keyed by the Windsor name.
  const real = retainersFromConfig();
  assert.deepEqual(real.map(r => r.client), Object.keys(CLIENTS));
});
