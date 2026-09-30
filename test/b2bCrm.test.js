import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseFunnel, indexClientsByProspect, prospectFormulas, fetchFunnel,
  isConfigured, setupHint, config, DEFAULTS, STAGE,
} from '../lib/dashboard/sources/b2bCrm.js';
import { SourceError } from '../lib/dashboard/sources/_shared.js';

const TZ = 'America/Toronto';

/* ---------------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------------ */

const CLIENT_RECS = [
  { id: 'c1', createdTime: '2026-09-20T12:00:00.000Z', fields: { 'Firm Name': 'Acme Tax', Prospect: ['pLinked'], 'Paid Up Front': 2500, Status: 'Active' } },
  { id: 'c2', createdTime: '2026-09-21T12:00:00.000Z', fields: { 'Firm Name': 'No Cash LLP', Prospect: ['pLinkedNoCash'], 'Paid Up Front': '' } },
  { id: 'c3', createdTime: '2026-09-22T12:00:00.000Z', fields: { 'Firm Name': 'String Link', Prospect: 'pStringLink', 'Paid Up Front': '1200.50' } },
  { id: 'c4', createdTime: '2026-09-23T12:00:00.000Z', fields: { 'Firm Name': 'Orphan', 'Paid Up Front': 999 } },        // no Prospect link
  { id: 'c5', createdTime: '2026-09-23T12:00:00.000Z', fields: { 'Firm Name': 'Bad cash', Prospect: ['pBadCash'], 'Paid Up Front': 'n/a' } },
];

const day = (n) => `2026-09-${String(n).padStart(2, '0')}`;

const PROSPECT_RECS = [
  // stage-only signals
  { id: 'pNew',      createdTime: '2026-09-01T12:00:00.000Z', fields: { 'Date Added': day(1), Stage: 'New Lead' } },
  { id: 'pBookedSt', createdTime: '2026-09-02T12:00:00.000Z', fields: { 'Date Added': day(2), Stage: 'Booked' } },
  { id: 'pConf',     createdTime: '2026-09-03T12:00:00.000Z', fields: { 'Date Added': day(3), Stage: { name: 'Confirmed' } } },   // select object
  { id: 'pShowedSt', createdTime: '2026-09-04T12:00:00.000Z', fields: { 'Date Added': day(4), Stage: 'Showed', 'Lead Grade': { name: 'A' } } },
  { id: 'pWonSt',    createdTime: '2026-09-05T12:00:00.000Z', fields: { 'Date Added': day(5), Stage: 'Won' } },
  { id: 'pNoShowSt', createdTime: '2026-09-06T12:00:00.000Z', fields: { 'Date Added': day(6), Stage: 'No Show' } },
  { id: 'pDqSt',     createdTime: '2026-09-07T12:00:00.000Z', fields: { 'Date Added': day(7), Stage: 'Disqualified' } },
  // status-only signals (stage neutral)
  { id: 'pWonStat',  createdTime: '2026-09-08T12:00:00.000Z', fields: { 'Date Added': day(8), Stage: 'Replied', Status: ' Closed Won ' } },
  { id: 'pShowStat', createdTime: '2026-09-09T12:00:00.000Z', fields: { 'Date Added': day(9), Stage: 'Replied', Status: { name: 'Demo Taken' } } },
  { id: 'pNoShowStat', createdTime: '2026-09-10T12:00:00.000Z', fields: { 'Date Added': day(10), Status: 'NoShow' } },
  { id: 'pDqStat',   createdTime: '2026-09-11T12:00:00.000Z', fields: { 'Date Added': day(11), Status: 'Not a fit' } },
  { id: 'pClientStat', createdTime: '2026-09-12T12:00:00.000Z', fields: { 'Date Added': day(12), Status: 'client' } },
  // appointment-only booking (stage says nothing)
  { id: 'pAppt',     createdTime: '2026-09-13T12:00:00.000Z', fields: { 'Date Added': day(13), Stage: 'Replied', Appointment: '2026-09-20T15:00:00.000Z' } },
  { id: 'pApptCustom', createdTime: '2026-09-14T12:00:00.000Z', fields: { 'Date Added': day(14), 'Call Time': '2026-09-21' } },
  // client link closes (no stage/status signal at all)
  { id: 'pLinked',   createdTime: '2026-09-15T12:00:00.000Z', fields: { 'Date Added': day(15), Stage: 'Replied' } },
  { id: 'pLinkedNoCash', createdTime: '2026-09-16T12:00:00.000Z', fields: { 'Date Added': day(16) } },
  { id: 'pStringLink', createdTime: '2026-09-17T12:00:00.000Z', fields: { 'Date Added': day(17) } },
  { id: 'pBadCash',  createdTime: '2026-09-18T12:00:00.000Z', fields: { 'Date Added': day(18) } },
  // dates
  { id: 'pNoDateAdded', createdTime: '2026-09-30T03:30:00.000Z', fields: { Stage: 'New Lead' } },                        // 23:30 Sep 29 Toronto
  { id: 'pDateAddedTime', createdTime: '2026-09-01T12:00:00.000Z', fields: { 'Date Added': '2026-09-25T23:59:00.000Z' } }, // sliced to 10 chars
  { id: 'pNoDate',   fields: { Stage: 'Booked' } },                                                                         // skipped
  { id: 'pGarbageDate', createdTime: 'not a date', fields: { 'Date Added': 'yesterday', Stage: 'New Lead' } },              // skipped
  // malformed
  { id: 'pNull', fields: null, createdTime: '2026-09-01T12:00:00.000Z' },
];

/* ---------------------------------------------------------------------------
 * fetch mock
 * ------------------------------------------------------------------------ */

function mockAirtable(tables, { reject422 = () => false } = {}) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    const parts = u.pathname.split('/');
    const table = decodeURIComponent(parts.pop());
    const base = parts.pop();
    const params = Object.fromEntries(u.searchParams.entries());
    calls.push({ base, table, params });
    if (reject422(table, params)) {
      return new Response(JSON.stringify({ error: { type: 'INVALID_FILTER_BY_FORMULA', message: 'Unknown field names: date added' } }), { status: 422 });
    }
    if (!(table in tables)) return new Response(JSON.stringify({ error: { type: 'NOT_FOUND' } }), { status: 404 });
    const all = tables[table];
    const page = Number(params.offset || 0);
    const size = Number(params.pageSize || 100);
    const records = all.slice(page * size, (page + 1) * size);
    const body = { records };
    if ((page + 1) * size < all.length) body.offset = String(page + 1);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, restore: () => { globalThis.fetch = realFetch; } };
}

function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) { prev[k] = process.env[k]; if (v == null) delete process.env[k]; else process.env[k] = v; }
  const done = () => { for (const [k, v] of Object.entries(prev)) { if (v == null) delete process.env[k]; else process.env[k] = v; } };
  let r;
  try { r = fn(); } catch (e) { done(); throw e; }
  if (r && typeof r.then === 'function') return r.finally(done);
  done();
  return r;
}

const LIVE = { AIRTABLE_TOKEN: 'pat', AIRTABLE_API_KEY: null, AIRTABLE_CRM_BASE: 'appCRM', AIRTABLE_TABLE_PROSPECTS: null, AIRTABLE_TABLE_CLIENTS: null, AIRTABLE_FIELD_APPOINTMENT: null };
const OFF = { AIRTABLE_TOKEN: null, AIRTABLE_API_KEY: null, AIRTABLE_CRM_BASE: null, AIRTABLE_TABLE_PROSPECTS: null, AIRTABLE_TABLE_CLIENTS: null, AIRTABLE_FIELD_APPOINTMENT: null };

/* ---------------------------------------------------------------------------
 * indexClientsByProspect
 * ------------------------------------------------------------------------ */

test('indexClientsByProspect keys clients by linked prospect and coerces Paid Up Front', () => {
  const idx = indexClientsByProspect(CLIENT_RECS);
  assert.equal(idx.size, 4);
  assert.deepEqual(idx.get('pLinked'), { id: 'c1', status: 'Active', upfrontCash: 2500 });
  assert.equal(idx.get('pLinkedNoCash').upfrontCash, 0);
  assert.equal(idx.get('pStringLink').upfrontCash, 1200.5, 'a single string link is accepted');
  assert.equal(idx.get('pBadCash').upfrontCash, 0, 'non-numeric cash -> 0');
  assert.equal(idx.has('c4'), false, 'a client with no Prospect link is not indexed');
  assert.equal(indexClientsByProspect(null).size, 0);
});

/* ---------------------------------------------------------------------------
 * normaliseFunnel
 * ------------------------------------------------------------------------ */

function byId(rows) { return Object.fromEntries(rows.map(r => [r.id, r])); }

test('normaliseFunnel: stage-only derivation matches the HQ app', () => {
  const { rows } = normaliseFunnel(PROSPECT_RECS, CLIENT_RECS, { tz: TZ });
  const r = byId(rows);
  const flags = (x) => [x.booked, x.showed, x.closed, x.disqualified];
  assert.deepEqual(flags(r.pNew), [false, false, false, false]);
  assert.deepEqual(flags(r.pBookedSt), [true, false, false, false]);
  assert.deepEqual(flags(r.pConf), [true, false, false, false], 'select object stage is read via .name');
  assert.equal(r.pConf.stage, 'Confirmed');
  assert.deepEqual(flags(r.pShowedSt), [true, true, false, false]);
  assert.equal(r.pShowedSt.grade, 'A', 'select object grade is read via .name');
  assert.deepEqual(flags(r.pWonSt), [true, true, true, false]);
  assert.deepEqual(flags(r.pNoShowSt), [true, false, false, false], 'No Show counts as booked, not showed');
  assert.deepEqual(flags(r.pDqSt), [false, false, false, true]);
  assert.equal(r.pWonSt.upfrontCash, 0, 'closed by stage with no Client record -> 0 cash');
});

test('normaliseFunnel: status-only derivation (case/whitespace-insensitive, select objects)', () => {
  const { rows } = normaliseFunnel(PROSPECT_RECS, CLIENT_RECS, { tz: TZ });
  const r = byId(rows);
  assert.equal(r.pWonStat.closed, true, '" Closed Won " normalises to closed won');
  assert.equal(r.pWonStat.showed, true, 'a close implies a show');
  assert.equal(r.pWonStat.booked, false, 'status alone never books (HQ parity)');
  assert.equal(r.pWonStat.status, ' Closed Won ', 'raw status is kept on the row');
  assert.equal(r.pShowStat.showed, true, '{ name: "Demo Taken" } -> showed');
  assert.equal(r.pShowStat.closed, false);
  assert.equal(r.pNoShowStat.showed, false);
  assert.equal(r.pNoShowStat.booked, false, 'NoShow status does not book (only the stage does)');
  assert.equal(r.pDqStat.disqualified, true);
  assert.equal(r.pClientStat.closed, true, '"client" status closes');
});

test('normaliseFunnel: appointment field books (default and custom field name)', () => {
  const dflt = byId(normaliseFunnel(PROSPECT_RECS, CLIENT_RECS, { tz: TZ }).rows);
  assert.equal(dflt.pAppt.booked, true);
  assert.equal(dflt.pAppt.showed, false);
  assert.equal(dflt.pAppt.closed, false);
  assert.equal(dflt.pApptCustom.booked, false, '"Call Time" is not the appointment field by default');

  const custom = byId(normaliseFunnel(PROSPECT_RECS, CLIENT_RECS, { tz: TZ, appointmentField: 'Call Time' }).rows);
  assert.equal(custom.pApptCustom.booked, true);
  assert.equal(custom.pAppt.booked, false, 'the default field is ignored when a custom one is configured');
});

test('normaliseFunnel: a linked Client closes the prospect and carries Paid Up Front', () => {
  const { rows, meta } = normaliseFunnel(PROSPECT_RECS, CLIENT_RECS, { tz: TZ });
  const r = byId(rows);
  assert.deepEqual([r.pLinked.booked, r.pLinked.showed, r.pLinked.closed], [false, true, true]);
  assert.equal(r.pLinked.upfrontCash, 2500);
  assert.equal(r.pLinkedNoCash.closed, true);
  assert.equal(r.pLinkedNoCash.upfrontCash, 0);
  assert.equal(r.pStringLink.closed, true);
  assert.equal(r.pStringLink.upfrontCash, 1200.5);
  assert.equal(r.pBadCash.closed, true);
  assert.equal(r.pBadCash.upfrontCash, 0);
  assert.equal(meta.linkedClients, 4);
  // cash is never attributed to an unclosed row
  for (const row of rows) if (!row.closed) assert.equal(row.upfrontCash, 0, `${row.id} must carry no cash`);
});

test('normaliseFunnel: dates come from Date Added, else createdTime in the business tz', () => {
  const { rows, meta } = normaliseFunnel(PROSPECT_RECS, CLIENT_RECS, { tz: TZ });
  const r = byId(rows);
  assert.equal(r.pNew.date, '2026-09-01');
  assert.equal(r.pDateAddedTime.date, '2026-09-25', 'a datetime Date Added is sliced to its first 10 chars, not tz-shifted');
  assert.equal(r.pNoDateAdded.date, '2026-09-29', '03:30Z on Sep 30 is Sep 29 in Toronto');
  assert.equal(r.pNoDate, undefined, 'no Date Added and no createdTime -> skipped');
  assert.equal(r.pGarbageDate, undefined, 'unparseable dates -> skipped');
  assert.equal(meta.noDate, 2);
  assert.ok(meta.warnings.some(w => /2 prospects had neither Date Added nor createdTime/.test(w)));
});

test('normaliseFunnel: UTC tz shifts the fallback date differently', () => {
  const r = byId(normaliseFunnel(PROSPECT_RECS, [], { tz: 'UTC' }).rows);
  assert.equal(r.pNoDateAdded.date, '2026-09-30');
});

test('normaliseFunnel: row shape, meta counts, malformed records', () => {
  const { rows, meta } = normaliseFunnel(PROSPECT_RECS, CLIENT_RECS, { tz: TZ });
  assert.deepEqual(Object.keys(rows[0]).sort(), ['booked', 'closed', 'date', 'disqualified', 'grade', 'id', 'showed', 'stage', 'status', 'upfrontCash']);
  assert.equal(meta.prospects, PROSPECT_RECS.length);
  assert.equal(meta.clients, CLIENT_RECS.length);
  assert.equal(rows.length, PROSPECT_RECS.length - 2, 'only the two dateless records are dropped (fields:null reads as empty, dated by createdTime)');
  assert.equal(meta.malformed, 0);
  assert.equal(meta.showSignalSeen, true);
  assert.deepEqual(meta.counts, { booked: 6, showed: 9, closed: 7, disqualified: 2, noShow: 2 }, "pNoDate is Booked but skipped before counting");
  assert.equal(meta.warnings.some(w => /inferred from closes only/.test(w)), false);
  // Every row for a blank record is neutral.
  const r = byId(rows);
  assert.deepEqual([r.pNull.booked, r.pNull.showed, r.pNull.closed, r.pNull.disqualified, r.pNull.stage, r.pNull.status, r.pNull.grade], [false, false, false, false, '', '', '']);
});

test('normaliseFunnel: truly unreadable records are counted as malformed', () => {
  const bad = [{ id: 'x', createdTime: '2026-09-01T12:00:00.000Z', get fields() { throw new Error('boom'); } }];
  const { rows, meta } = normaliseFunnel(bad, [], { tz: TZ });
  assert.equal(rows.length, 0);
  assert.equal(meta.malformed, 1);
  assert.ok(meta.warnings.some(w => /1 prospect record could not be read/.test(w)));
});

test('normaliseFunnel: showSignalSeen is false when shows are only inferred from closes', () => {
  const recs = [
    { id: 'a', createdTime: '2026-09-01T12:00:00.000Z', fields: { 'Date Added': day(1), Stage: 'Booked' } },
    { id: 'b', createdTime: '2026-09-02T12:00:00.000Z', fields: { 'Date Added': day(2), Status: 'Closed' } },
    { id: 'c', createdTime: '2026-09-03T12:00:00.000Z', fields: { 'Date Added': day(3) } },
  ];
  const { rows, meta } = normaliseFunnel(recs, [{ id: 'c1', fields: { Prospect: ['c'], 'Paid Up Front': 100 } }], { tz: TZ });
  assert.equal(rows.find(r => r.id === 'b').showed, true);
  assert.equal(rows.find(r => r.id === 'c').showed, true);
  assert.equal(meta.showSignalSeen, false, 'closes do not count as show evidence');
  assert.equal(meta.warnings.filter(w => /no prospect has ever been marked Showed\/No Show, so shows are inferred from closes only/.test(w)).length, 1);

  // A single explicit No Show flips it.
  const withNoShow = normaliseFunnel([...recs, { id: 'd', createdTime: '2026-09-04T12:00:00.000Z', fields: { 'Date Added': day(4), Stage: STAGE.NO_SHOW } }], [], { tz: TZ });
  assert.equal(withNoShow.meta.showSignalSeen, true);
  assert.equal(withNoShow.meta.warnings.length, 0);

  // No prospects at all: nothing to warn about.
  const empty = normaliseFunnel([], [], { tz: TZ });
  assert.deepEqual(empty, { rows: [], meta: { prospects: 0, clients: 0, linkedClients: 0, showSignalSeen: false, counts: { booked: 0, showed: 0, closed: 0, disqualified: 0, noShow: 0 }, noDate: 0, malformed: 0, warnings: [] } });
});

/* ---------------------------------------------------------------------------
 * Formulas
 * ------------------------------------------------------------------------ */

test('prospectFormulas keys on Date Added OR createdTime, guarded against blanks', () => {
  const { primary, fallback } = prospectFormulas('2026-08-31');
  assert.equal(primary, 'OR(IF({Date Added}, IS_AFTER({Date Added}, DATETIME_PARSE("2026-08-31")), 0), IS_AFTER(CREATED_TIME(), DATETIME_PARSE("2026-08-31")))');
  assert.equal(fallback, 'IS_AFTER(CREATED_TIME(), DATETIME_PARSE("2026-08-31"))');
});

/* ---------------------------------------------------------------------------
 * Configuration
 * ------------------------------------------------------------------------ */

test('isConfigured / config / setupHint follow the env', async () => {
  await withEnv(OFF, async () => {
    assert.equal(isConfigured(), false);
    assert.equal(config().base, '');
    assert.equal(config().prospectsTable, DEFAULTS.prospectsTable);
    assert.equal(config().clientsTable, DEFAULTS.clientsTable);
    assert.equal(config().appointmentField, DEFAULTS.appointmentField);
    assert.match(setupHint(), /AIRTABLE_TOKEN/);
    assert.match(setupHint(), /AIRTABLE_CRM_BASE/);
    await assert.rejects(() => fetchFunnel({ from: '2026-09-01', to: '2026-09-30', tz: TZ }), (e) => e instanceof SourceError && e.missingConfig && /AIRTABLE_TOKEN/.test(e.hint));
  });
  await withEnv({ ...OFF, AIRTABLE_TOKEN: 'pat' }, async () => {
    assert.equal(isConfigured(), false, 'token without a base is not configured');
    await assert.rejects(() => fetchFunnel({ from: '2026-09-01', to: '2026-09-30', tz: TZ }), (e) => e instanceof SourceError && e.missingConfig && /AIRTABLE_CRM_BASE/.test(e.hint));
  });
  await withEnv({ ...OFF, AIRTABLE_CRM_BASE: 'appCRM' }, () => {
    assert.equal(isConfigured(), false, 'base without a token is not configured');
  });
  await withEnv({ ...OFF, AIRTABLE_API_KEY: 'pat2', AIRTABLE_CRM_BASE: 'appCRM' }, () => {
    assert.equal(isConfigured(), true, 'AIRTABLE_API_KEY is accepted as the token');
    assert.equal(config().token, 'pat2');
  });
  await withEnv({ ...LIVE, AIRTABLE_API_KEY: 'other', AIRTABLE_TABLE_PROSPECTS: 'Leads', AIRTABLE_TABLE_CLIENTS: 'Customers', AIRTABLE_FIELD_APPOINTMENT: 'Call Time' }, () => {
    assert.equal(isConfigured(), true);
    assert.equal(config().token, 'pat', 'AIRTABLE_TOKEN wins over AIRTABLE_API_KEY');
    assert.equal(config().prospectsTable, 'Leads');
    assert.equal(config().clientsTable, 'Customers');
    assert.equal(config().appointmentField, 'Call Time');
  });
});

/* ---------------------------------------------------------------------------
 * fetchFunnel with a mocked Airtable
 * ------------------------------------------------------------------------ */

test('fetchFunnel pulls prospects since from-1 with the OR formula and the whole Clients table', async () => {
  const m = mockAirtable({ Prospects: PROSPECT_RECS, Clients: CLIENT_RECS });
  try {
    await withEnv(LIVE, async () => {
      const { rows, meta } = await fetchFunnel({ from: '2026-09-01', to: '2026-10-01', tz: TZ });
      const p = m.calls.find(c => c.table === 'Prospects');
      const c = m.calls.find(c => c.table === 'Clients');
      assert.equal(p.base, 'appCRM');
      assert.equal(p.params.filterByFormula, prospectFormulas('2026-08-31').primary);
      assert.equal(c.params.filterByFormula, undefined, 'clients are not filtered');
      assert.equal(m.calls.filter(x => x.table === 'Clients').length, 1);
      assert.equal(meta.since, '2026-08-31');
      assert.deepEqual(meta.tables, { prospects: 'Prospects', clients: 'Clients' });
      assert.equal(rows.find(r => r.id === 'pLinked').upfrontCash, 2500);
      assert.equal(rows.length, PROSPECT_RECS.length - 2);
      assert.equal(meta.warnings.some(w => /Date Added/.test(w) && /createdTime instead/.test(w)), false);
    });
  } finally { m.restore(); }
});

test('fetchFunnel honours table and appointment field overrides', async () => {
  const m = mockAirtable({ Leads: PROSPECT_RECS, Customers: CLIENT_RECS });
  try {
    await withEnv({ ...LIVE, AIRTABLE_TABLE_PROSPECTS: 'Leads', AIRTABLE_TABLE_CLIENTS: 'Customers', AIRTABLE_FIELD_APPOINTMENT: 'Call Time' }, async () => {
      const { rows, meta } = await fetchFunnel({ from: '2026-09-01', to: '2026-10-01', tz: TZ });
      assert.deepEqual(meta.tables, { prospects: 'Leads', clients: 'Customers' });
      assert.equal(rows.find(r => r.id === 'pApptCustom').booked, true);
      assert.equal(rows.find(r => r.id === 'pAppt').booked, false);
    });
  } finally { m.restore(); }
});

test('fetchFunnel falls back to CREATED_TIME() when Airtable rejects Date Added, and warns', async () => {
  const m = mockAirtable({ Prospects: PROSPECT_RECS, Clients: CLIENT_RECS }, {
    reject422: (table, params) => table === 'Prospects' && /Date Added/.test(params.filterByFormula || ''),
  });
  try {
    await withEnv(LIVE, async () => {
      const { rows, meta } = await fetchFunnel({ from: '2026-09-01', to: '2026-10-01', tz: TZ });
      const calls = m.calls.filter(c => c.table === 'Prospects');
      assert.equal(calls.length, 2);
      assert.equal(calls[1].params.filterByFormula, prospectFormulas('2026-08-31').fallback);
      assert.equal(meta.formula, prospectFormulas('2026-08-31').fallback);
      assert.ok(meta.warnings.some(w => /no "Date Added" field/.test(w)));
      assert.equal(rows.length, PROSPECT_RECS.length - 2);
    });
  } finally { m.restore(); }
});

test('fetchFunnel follows pagination on both tables', async () => {
  const prospects = Array.from({ length: 250 }, (_, i) => ({ id: `p${i}`, createdTime: '2026-09-10T12:00:00.000Z', fields: { 'Date Added': day(10), Stage: i % 5 === 0 ? 'Won' : 'Booked' } }));
  const clients = Array.from({ length: 120 }, (_, i) => ({ id: `c${i}`, fields: { Prospect: [`p${i * 2}`], 'Paid Up Front': 10 } }));
  const m = mockAirtable({ Prospects: prospects, Clients: clients });
  try {
    await withEnv(LIVE, async () => {
      const { rows, meta } = await fetchFunnel({ from: '2026-09-01', to: '2026-10-01', tz: TZ });
      assert.equal(rows.length, 250);
      assert.equal(m.calls.filter(c => c.table === 'Prospects').length, 3);
      assert.equal(m.calls.filter(c => c.table === 'Clients').length, 2);
      assert.equal(meta.linkedClients, 120);
      assert.equal(rows.filter(r => r.closed).length, 50 + 120 - 24, 'stage Won (i%5) and client links (even i) overlap on the 24 multiples of 10 below 240');
      assert.equal(rows.reduce((s, r) => s + r.upfrontCash, 0), 1200);
      assert.equal(meta.warnings.length, 0);
    });
  } finally { m.restore(); }
});

test('fetchFunnel rejects a malformed window and surfaces upstream errors as SourceError', async () => {
  const m = mockAirtable({ Clients: CLIENT_RECS }); // Prospects table missing -> 404
  try {
    await withEnv(LIVE, async () => {
      await assert.rejects(() => fetchFunnel({ from: 'Sept 1', to: '2026-10-01', tz: TZ }), (e) => e instanceof SourceError && /from must be YYYY-MM-DD/.test(e.message));
      await assert.rejects(() => fetchFunnel({ from: '2026-09-01', to: 'soon', tz: TZ }), (e) => e instanceof SourceError && /to must be YYYY-MM-DD/.test(e.message));
      await assert.rejects(() => fetchFunnel({ from: '2026-09-01', to: '2026-10-01', tz: TZ }), (e) => e instanceof SourceError && e.status === 404 && /prospects/.test(e.message));
      assert.equal(m.calls.some(c => c.params.filterByFormula === prospectFormulas('2026-08-31').fallback), false, 'a 404 is not retried with the fallback formula');
    });
  } finally { m.restore(); }
});

test('fetchFunnel: a 404 on Clients is not swallowed', async () => {
  const m = mockAirtable({ Prospects: PROSPECT_RECS });
  try {
    await withEnv(LIVE, async () => {
      await assert.rejects(() => fetchFunnel({ from: '2026-09-01', to: '2026-10-01', tz: TZ }), (e) => e instanceof SourceError && e.status === 404 && /clients/.test(e.message));
    });
  } finally { m.restore(); }
});
