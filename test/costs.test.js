import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DASHBOARD_TABLES, COSTS_TABLE, TARGETS_TABLE, SNAPSHOTS_TABLE, DEFAULT_BASE,
  config, isConfigured, setupHint, normaliseCosts, normaliseTargets, fetchCosts, fetchTargets,
  ensureDashboardTables, dashboardTablesStatus, snapshotTableExists, appendSnapshot, toSnapshotRecord,
} from '../lib/dashboard/sources/costs.js';
import { SourceError } from '../lib/dashboard/sources/_shared.js';
import { COST_CATEGORIES, ROW_BY_ID } from '../lib/dashboard/catalog.js';

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

/**
 * Minimal Airtable mock: `tables` maps table name -> records (missing -> 404),
 * `schema` is the list of table names the meta API reports.
 */
function mockAirtable({ tables = {}, schema = null, createTable = null, createRecords = null } = {}) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ url: u, method, init, body: init.body ? JSON.parse(init.body) : null });
    const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
    const m = u.pathname.match(/^\/v0\/meta\/bases\/([^/]+)\/tables$/);
    if (m) {
      if (method === 'GET') {
        if (schema == null) return reply(403, { error: { type: 'INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND', message: 'no schema scope' } });
        return reply(200, { tables: schema.map((name, i) => ({ id: `tbl${i}`, name, fields: [] })) });
      }
      if (method === 'POST') {
        if (createTable) return createTable(calls[calls.length - 1].body, reply);
        return reply(200, { id: 'tblNew', name: calls[calls.length - 1].body.name });
      }
    }
    const t = u.pathname.match(/^\/v0\/([^/]+)\/([^/]+)$/);
    if (t) {
      const table = decodeURIComponent(t[2]);
      if (method === 'GET') {
        if (!(table in tables)) return reply(404, { error: { type: 'TABLE_NOT_FOUND', message: 'Could not find table' } });
        return reply(200, { records: tables[table] });
      }
      if (method === 'POST') {
        if (createRecords) return createRecords(table, calls[calls.length - 1].body, reply);
        const recs = calls[calls.length - 1].body.records.map((r, i) => ({ id: `rec${calls.length}_${i}`, fields: r.fields }));
        return reply(200, { records: recs });
      }
    }
    return reply(500, { error: 'unexpected ' + u.pathname });
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

/* ---------------------------------------------------------------------------
 * table specs
 * ------------------------------------------------------------------------ */

test('DASHBOARD_TABLES matches the spec exactly', () => {
  assert.deepEqual(DASHBOARD_TABLES.map(t => t.name), ['Dashboard Costs', 'Dashboard Targets', 'Dashboard Snapshots']);
  assert.equal(COSTS_TABLE, 'Dashboard Costs');
  assert.equal(TARGETS_TABLE, 'Dashboard Targets');
  assert.equal(SNAPSHOTS_TABLE, 'Dashboard Snapshots');

  const costs = DASHBOARD_TABLES[0];
  assert.deepEqual(costs.fields.map(f => [f.name, f.type]), [['Date', 'date'], ['Category', 'singleSelect'], ['Amount', 'currency'], ['Period', 'singleSelect'], ['Note', 'singleLineText']]);
  assert.deepEqual(costs.fields[1].options.choices.map(c => c.name), ['Payroll', 'Messaging', 'Affiliates', 'Software', 'Personal projects', 'Other']);
  assert.deepEqual(costs.fields[1].options.choices.map(c => c.name), Object.keys(COST_CATEGORIES));
  assert.equal(costs.fields[0].options.dateFormat.name, 'iso');
  assert.equal(costs.fields[2].options.precision, 2);
  assert.deepEqual(costs.fields[3].options.choices.map(c => c.name), ['One-time', 'Monthly']);

  const targets = DASHBOARD_TABLES[1];
  assert.deepEqual(targets.fields.map(f => [f.name, f.type]), [['Metric', 'singleLineText'], ['Month', 'singleLineText'], ['Target', 'number'], ['Note', 'singleLineText']]);
  assert.equal(targets.fields[2].options.precision, 2);

  const snaps = DASHBOARD_TABLES[2];
  assert.deepEqual(snaps.fields.map(f => [f.name, f.type]), [['Date', 'date'], ['Metric', 'singleLineText'], ['Range', 'singleSelect'], ['Value', 'number'], ['Generated At', 'singleLineText']]);
  assert.deepEqual(snaps.fields[2].options.choices.map(c => c.name), ['today', 'mtd']);
  for (const t of DASHBOARD_TABLES) assert.ok(t.description && t.description.length > 10);
});

test('config / isConfigured / setupHint', async () => {
  await withEnv({ AIRTABLE_API_KEY: null, AIRTABLE_DASHBOARD_BASE: null, AIRTABLE_HS_BASE: null }, async () => {
    assert.equal(isConfigured(), false);
    assert.deepEqual(config(), { token: '', baseId: DEFAULT_BASE });
    process.env.AIRTABLE_API_KEY = 'tok';
    assert.equal(isConfigured(), true);
    process.env.AIRTABLE_HS_BASE = 'appHS';
    assert.equal(config().baseId, 'appHS');
    process.env.AIRTABLE_DASHBOARD_BASE = 'appDash';
    assert.equal(config().baseId, 'appDash');
  });
  assert.match(setupHint(), /AIRTABLE_API_KEY/);
  assert.match(setupHint(), /\/api\/setup/);
});

/* ---------------------------------------------------------------------------
 * normaliseCosts
 * ------------------------------------------------------------------------ */

test('normaliseCosts: shapes, period detection, category canonicalisation, skips', () => {
  const out = normaliseCosts([
    { id: 'r1', fields: { Date: '2026-09-01', Category: 'Payroll', Amount: 14000, Period: 'Monthly', Note: 'Closers' } },
    { id: 'r2', fields: { Date: '2026-09-15', Category: 'affiliates', Amount: '1,200.50', Period: 'One-time' } },
    { id: 'r3', fields: { Date: '2026-09-15T00:00:00.000Z', Category: { name: 'Software' }, Amount: 99.999, Period: 'monthly' } },
    { id: 'r4', fields: { Date: '2026-09-15', Category: 'Rent', Amount: 3000 } },
    { id: 'r5', fields: { Category: 'Other', Amount: 5 } },
    { id: 'r6', fields: { Date: '2026-09-15', Category: 'Other' } },
    { id: 'r7', fields: { Date: '2026-09-15', Category: 'Other', Amount: 'abc' } },
    { id: 'r8', fields: { Date: 'not a date', Category: 'Other', Amount: 1 } },
    { id: 'r9', fields: { Date: '2026-09-20', Amount: 7 } },
    { id: 'r10' },
  ]);
  assert.equal(out.meta.fetched, 10);
  assert.equal(out.meta.kept, 5);
  assert.equal(out.meta.skipped, 5);
  assert.deepEqual(out.meta.skippedDetail, { noDate: 3, noAmount: 2 });
  assert.deepEqual(out.rows[0], { id: 'r1', date: '2026-09-01', category: 'Payroll', amount: 14000, period: 'monthly', note: 'Closers' });
  assert.deepEqual(out.rows[1], { id: 'r2', date: '2026-09-15', category: 'Affiliates', amount: 1200.5, period: 'once', note: '' });
  assert.deepEqual(out.rows[2], { id: 'r3', date: '2026-09-15', category: 'Software', amount: 100, period: 'monthly', note: '' });
  assert.equal(out.rows[3].category, 'Rent', 'unknown category keeps its raw text');
  assert.equal(out.rows[3].period, 'once', 'blank Period -> once');
  assert.equal(out.rows[4].category, '', 'blank category kept as empty string');
  assert.deepEqual(out.meta.unknownCategories, ['Rent', '(blank)']);
  assert.ok(out.meta.warnings.some(w => /5 cost row\(s\) skipped \(3 without a Date, 2 without an Amount\)/.test(w)), out.meta.warnings.join(' | '));
  assert.ok(out.meta.warnings.some(w => /uncategorised: Rent, \(blank\)/.test(w)), out.meta.warnings.join(' | '));
  for (const r of out.rows) assert.equal(r.date.length, 10);
});

test('normaliseCosts: clean input has no warnings; empty input is fine', () => {
  const out = normaliseCosts([{ id: 'a', fields: { Date: '2026-09-01', Category: 'Messaging', Amount: 900, Period: 'Monthly' } }]);
  assert.deepEqual(out.meta.warnings, []);
  assert.deepEqual(normaliseCosts([]).rows, []);
  assert.deepEqual(normaliseCosts(undefined).meta.fetched, 0);
});

/* ---------------------------------------------------------------------------
 * normaliseTargets
 * ------------------------------------------------------------------------ */

test('normaliseTargets: validation against catalog ids and YYYY-MM months', () => {
  assert.ok(ROW_BY_ID.cash_collected, 'catalog has cash_collected');
  const ids = Object.keys(ROW_BY_ID);
  const second = ids.find(id => id !== 'cash_collected');
  const out = normaliseTargets([
    { id: 't1', fields: { Metric: 'cash_collected', Month: '2026-09', Target: 50000, Note: 'Q3 push' } },
    { id: 't2', fields: { Metric: ' cash_collected ', Month: '2026-10', Target: '60,000' } },
    { id: 't3', fields: { Metric: second, Month: '2026-09', Target: 12 } },
    { id: 't4', fields: { Metric: 'not_a_metric', Month: '2026-09', Target: 1 } },
    { id: 't5', fields: { Metric: 'also_unknown', Month: '2026-09', Target: 1 } },
    { id: 't6', fields: { Metric: 'cash_collected', Month: 'Sept 2026', Target: 1 } },
    { id: 't7', fields: { Metric: 'cash_collected', Month: '2026-11' } },
    { id: 't8', fields: { Metric: 'cash_collected', Month: '2026-09', Target: 55000 } },
    { id: 't9', fields: { Month: '2026-09', Target: 5 } },
  ]);
  assert.equal(out.meta.fetched, 9);
  assert.equal(out.meta.kept, 4);
  assert.deepEqual(out.byMetric.cash_collected, { '2026-09': 55000, '2026-10': 60000 });
  assert.deepEqual(out.byMetric[second], { '2026-09': 12 });
  assert.equal(out.byMetric.not_a_metric, undefined);
  assert.deepEqual(out.meta.unknownMetrics, ['not_a_metric', 'also_unknown']);
  assert.equal(out.meta.badMonths, 1);
  assert.deepEqual(out.rows[0], { id: 't1', metric: 'cash_collected', month: '2026-09', target: 50000, note: 'Q3 push' });
  assert.ok(out.meta.warnings.some(w => /Dashboard Targets has metrics the dashboard does not know: not_a_metric, also_unknown/.test(w)), out.meta.warnings.join(' | '));
  assert.ok(out.meta.warnings.some(w => /Month must be YYYY-MM/.test(w)));
  assert.ok(out.meta.warnings.some(w => /Target is blank/.test(w)));
  assert.ok(out.meta.warnings.some(w => /1 duplicate metric\+month/.test(w)));
});

test('normaliseTargets: clean input has no warnings', () => {
  const out = normaliseTargets([{ id: 'a', fields: { Metric: 'cash_collected', Month: '2026-09', Target: 1 } }]);
  assert.deepEqual(out.meta.warnings, []);
  assert.deepEqual(normaliseTargets([]).byMetric, {});
});

/* ---------------------------------------------------------------------------
 * fetchers with mocked Airtable
 * ------------------------------------------------------------------------ */

test('fetchCosts / fetchTargets: unconfigured without a token', async () => {
  await withEnv({ AIRTABLE_API_KEY: null }, async () => {
    await assert.rejects(fetchCosts({}), (e) => e instanceof SourceError && e.missingConfig && /AIRTABLE_API_KEY/.test(e.hint));
    await assert.rejects(fetchTargets(), (e) => e instanceof SourceError && e.missingConfig && /AIRTABLE_API_KEY/.test(e.hint));
  });
});

test('fetchCosts / fetchTargets: read from AIRTABLE_DASHBOARD_BASE and normalise', async () => {
  await withEnv({ AIRTABLE_API_KEY: 'tok', AIRTABLE_DASHBOARD_BASE: 'appDash' }, async () => {
    const m = mockAirtable({
      tables: {
        'Dashboard Costs': [{ id: 'c1', fields: { Date: '2026-09-01', Category: 'Payroll', Amount: 100, Period: 'Monthly' } }],
        'Dashboard Targets': [{ id: 't1', fields: { Metric: 'cash_collected', Month: '2026-09', Target: 1000 } }],
      },
    });
    try {
      const costs = await fetchCosts({ from: '2026-08-01', to: '2026-09-30', tz: 'America/Toronto' });
      assert.equal(costs.rows.length, 1);
      assert.equal(costs.rows[0].period, 'monthly');
      assert.equal(costs.meta.baseId, 'appDash');
      assert.equal(m.calls[0].url.pathname, '/v0/appDash/Dashboard%20Costs');
      assert.equal(m.calls[0].init.headers.Authorization, 'Bearer tok');

      const targets = await fetchTargets();
      assert.deepEqual(targets.byMetric, { cash_collected: { '2026-09': 1000 } });
      assert.equal(targets.rows.length, 1);
      assert.equal(m.calls[1].url.pathname, '/v0/appDash/Dashboard%20Targets');
    } finally { m.restore(); }
  });
});

test('fetchCosts / fetchTargets: a missing table throws unconfigured with a creation hint', async () => {
  await withEnv({ AIRTABLE_API_KEY: 'tok', AIRTABLE_DASHBOARD_BASE: null, AIRTABLE_HS_BASE: null }, async () => {
    const m = mockAirtable({ tables: {} });
    try {
      await assert.rejects(fetchCosts({}), (e) => e instanceof SourceError && e.missingConfig && /POST \/api\/setup/.test(e.hint) && /Dashboard Costs/.test(e.hint));
      await assert.rejects(fetchTargets(), (e) => e instanceof SourceError && e.missingConfig && /POST \/api\/setup/.test(e.hint) && /Dashboard Targets/.test(e.hint));
      assert.equal(m.calls[0].url.pathname, `/v0/${DEFAULT_BASE}/Dashboard%20Costs`);
    } finally { m.restore(); }
  });
});

test('fetchCosts: non-404 upstream errors propagate as SourceError', async () => {
  await withEnv({ AIRTABLE_API_KEY: 'tok' }, async () => {
    const real = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => JSON.stringify({ error: { message: 'boom' } }) });
    try {
      await assert.rejects(fetchCosts({}), (e) => e instanceof SourceError && !e.missingConfig && e.status === 500 && /boom/.test(e.message));
    } finally { globalThis.fetch = real; }
  });
});

/* ---------------------------------------------------------------------------
 * ensureDashboardTables / snapshots
 * ------------------------------------------------------------------------ */

test('ensureDashboardTables: creates only the missing tables with the spec fields', async () => {
  const m = mockAirtable({ schema: ['Leads', 'dashboard costs'] });
  try {
    const out = await ensureDashboardTables({ token: 'tok', baseId: 'appX' });
    assert.deepEqual(out, { baseId: 'appX', created: ['Dashboard Targets', 'Dashboard Snapshots'], existing: ['Dashboard Costs'], errors: [] });
    const posts = m.calls.filter(c => c.method === 'POST');
    assert.equal(posts.length, 2);
    assert.equal(posts[0].url.pathname, '/v0/meta/bases/appX/tables');
    assert.equal(posts[0].body.name, 'Dashboard Targets');
    assert.deepEqual(posts[0].body.fields, DASHBOARD_TABLES[1].fields);
    assert.equal(posts[0].body.description, DASHBOARD_TABLES[1].description);
    assert.equal(posts[1].body.name, 'Dashboard Snapshots');
    assert.equal(posts[0].init.headers.Authorization, 'Bearer tok');
  } finally { m.restore(); }
});

test('ensureDashboardTables: per-table failures are collected, not thrown', async () => {
  const m = mockAirtable({
    schema: [],
    createTable: (body, reply) => body.name === 'Dashboard Targets'
      ? reply(422, { error: { type: 'INVALID_REQUEST', message: 'bad field' } })
      : reply(200, { id: 'tblN', name: body.name }),
  });
  try {
    const out = await ensureDashboardTables({ token: 'tok', baseId: 'appX' });
    assert.deepEqual(out.created, ['Dashboard Costs', 'Dashboard Snapshots']);
    assert.deepEqual(out.existing, []);
    assert.equal(out.errors.length, 1);
    assert.equal(out.errors[0].name, 'Dashboard Targets');
    assert.match(out.errors[0].error, /422 bad field/);
  } finally { m.restore(); }
});

test('ensureDashboardTables: schema read failure (no scope) throws SourceError; missing token throws unconfigured', async () => {
  const m = mockAirtable({ schema: null });
  try {
    await assert.rejects(ensureDashboardTables({ token: 'tok', baseId: 'appX' }), (e) => e instanceof SourceError && e.status === 403);
  } finally { m.restore(); }
  await withEnv({ AIRTABLE_API_KEY: null }, async () => {
    await assert.rejects(ensureDashboardTables({}), (e) => e instanceof SourceError && e.missingConfig && /AIRTABLE_API_KEY/.test(e.hint));
  });
  await withEnv({ AIRTABLE_API_KEY: 'tok', AIRTABLE_DASHBOARD_BASE: 'appEnv' }, async () => {
    const m2 = mockAirtable({ schema: ['Dashboard Costs', 'Dashboard Targets', 'Dashboard Snapshots'] });
    try {
      const out = await ensureDashboardTables();
      assert.equal(out.baseId, 'appEnv');
      assert.deepEqual(out.created, []);
      assert.equal(out.existing.length, 3);
    } finally { m2.restore(); }
  });
});

test('dashboardTablesStatus / snapshotTableExists', async () => {
  const m = mockAirtable({ schema: ['Dashboard Costs'] });
  try {
    const s = await dashboardTablesStatus({ token: 'tok', baseId: 'appX' });
    assert.deepEqual(s, { baseId: 'appX', existing: ['Dashboard Costs'], missing: ['Dashboard Targets', 'Dashboard Snapshots'] });
    assert.equal(await snapshotTableExists({ token: 'tok', baseId: 'appX' }), false);
  } finally { m.restore(); }
  const m2 = mockAirtable({ schema: ['Dashboard Snapshots'] });
  try {
    assert.equal(await snapshotTableExists({ token: 'tok', baseId: 'appX' }), true);
  } finally { m2.restore(); }
  const m3 = mockAirtable({ schema: null });
  try {
    assert.equal(await snapshotTableExists({ token: 'tok', baseId: 'appX' }), false, 'schema error -> false');
  } finally { m3.restore(); }
});

test('toSnapshotRecord / appendSnapshot', async () => {
  assert.deepEqual(toSnapshotRecord({ date: '2026-09-30T10:00:00Z', metric: 'cash_collected', range: 'mtd', value: 1234.567, generatedAt: '2026-09-30T10:45:00.000Z' }),
    { fields: { Date: '2026-09-30', Metric: 'cash_collected', Range: 'mtd', Value: 1234.57, 'Generated At': '2026-09-30T10:45:00.000Z' } });
  assert.deepEqual(toSnapshotRecord({ fields: { Date: '2026-09-30', Metric: 'leads_billed', Range: 'weird', Value: null } }),
    { fields: { Date: '2026-09-30', Metric: 'leads_billed', Range: 'today', Value: null } });
  assert.equal(toSnapshotRecord({ metric: 'x' }), null);
  assert.equal(toSnapshotRecord(null), null);

  const m = mockAirtable({});
  try {
    const records = Array.from({ length: 23 }, (_, i) => ({ date: '2026-09-30', metric: `m${i}`, range: i % 2 ? 'mtd' : 'today', value: i, generatedAt: 'now' }));
    const out = await appendSnapshot({ token: 'tok', baseId: 'appX', records });
    assert.equal(out.written, 23);
    assert.equal(out.ids.length, 23);
    const posts = m.calls.filter(c => c.method === 'POST');
    assert.equal(posts.length, 3, 'chunks of 10');
    assert.equal(posts[0].url.pathname, '/v0/appX/Dashboard%20Snapshots');
    assert.equal(posts[0].body.records.length, 10);
    assert.equal(posts[2].body.records.length, 3);
    assert.equal(posts[0].body.typecast, true);
    assert.deepEqual(posts[0].body.records[1].fields, { Date: '2026-09-30', Metric: 'm1', Range: 'mtd', Value: 1, 'Generated At': 'now' });

    const empty = await appendSnapshot({ token: 'tok', baseId: 'appX', records: [{ nope: true }] });
    assert.deepEqual(empty, { written: 0, ids: [] });
    assert.equal(m.calls.filter(c => c.method === 'POST').length, 3, 'no request for an empty batch');
  } finally { m.restore(); }
  await withEnv({ AIRTABLE_API_KEY: null }, async () => {
    await assert.rejects(appendSnapshot({ records: [{ date: '2026-09-30', metric: 'x' }] }), (e) => e instanceof SourceError && e.missingConfig);
  });
});
