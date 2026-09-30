import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLeadCost, retainerClientNames, normaliseLeads, normaliseClients, normaliseProspects, normaliseEod,
  airtableDate, numberOrNull, prospectFormulas, isConfigured, setupHint, config, DEFAULTS,
  fetchLeads, fetchClients, fetchProspects, fetchCloserEod,
} from '../lib/dashboard/sources/airtableHomeService.js';
import { SourceError } from '../lib/dashboard/sources/_shared.js';

const TZ = 'America/Toronto';

/* ---------------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------------ */

const CLIENT_RECS = [
  { id: 'recPROS', createdTime: '2026-01-10T15:00:00.000Z', fields: { 'Company Name': 'PROS Tree & Landscape (Phoenix)' } },
  { id: 'recED', createdTime: '2026-09-30T03:30:00.000Z', fields: { 'Company Name': 'Protree Services LLC' } },
  { id: 'recNAME', createdTime: '2026-05-01T12:00:00.000Z', fields: { Name: 'Legacy Name Only' } },
  { id: 'recBLANK', createdTime: '2026-05-02T12:00:00.000Z', fields: {} },
];

const LEAD_RECS = [
  { id: 'l1', createdTime: '2026-09-30T03:30:00.000Z', fields: { 'Assigned Client': ['recED'], 'Lead Cost': '$85' } },      // Sep 29 Toronto
  { id: 'l2', createdTime: '2026-09-29T14:00:00.000Z', fields: { 'Assigned Client': ['recED'], 'Lead Cost': ' free ' } },
  { id: 'l3', createdTime: '2026-09-29T14:00:00.000Z', fields: { 'Assigned Client': ['recED'], 'Lead Cost': 'Replacement' } },
  { id: 'l4', createdTime: '2026-09-29T14:00:00.000Z', fields: { 'Assigned Client': ['recED'], 'Lead Cost': 'PREPAY' } },
  { id: 'l5', createdTime: '2026-09-29T14:00:00.000Z', fields: { 'Assigned Client': ['recED'], 'Lead Cost': 'Unbilled' } },
  { id: 'l6', createdTime: '2026-09-29T14:00:00.000Z', fields: { 'Assigned Client': ['recED'] } },                          // blank -> unknown
  { id: 'l7', createdTime: '2026-09-29T14:00:00.000Z', fields: { 'Assigned Client': ['recED'], 'Lead Cost': 'Comped' } },   // unknown
  { id: 'l8', createdTime: '2026-09-29T14:00:00.000Z', fields: { 'Assigned Client': ['recPROS'], 'Lead Cost': 'Free' } },   // retainer -> billed $0
  { id: 'l9', createdTime: '2026-09-29T14:00:00.000Z', fields: { 'Assigned Client': ['recPROS'], 'Lead Cost': '$45' } },    // retainer -> billed $0
  { id: 'l10', createdTime: '2026-09-29T14:00:00.000Z', fields: { 'Lead Cost': '$85' } },                                   // unassigned -> dropped
  { id: 'l11', createdTime: '2026-09-29T14:00:00.000Z', fields: { 'Assigned Client': ['recGONE'], 'Lead Cost': '$55' } },   // unknown client
  { id: 'l12', fields: { 'Assigned Client': ['recED'], 'Lead Cost': '$85' } },                                              // no createdTime
];

const PROSPECT_RECS = [
  { id: 'p1', createdTime: '2026-09-30T03:30:00.000Z', fields: { Closer: 'Alex', Status: 'Booked', 'Appointment Date': '2026-10-02T18:00:00.000Z', 'Speed to Lead (sec)': 120, 'Time Called': '2026-09-30T03:32:00.000Z' } },
  { id: 'p2', createdTime: '2026-09-29T14:00:00.000Z', fields: { 'Created At': '2026-09-28T23:30:00.000Z', Closer: { name: 'Sam' }, Status: 'Hotlist' } },
  { id: 'p3', createdTime: '2026-09-29T14:00:00.000Z', fields: { Status: 'follow up', 'Speed to Lead (sec)': '' } },
  { id: 'p4', createdTime: '2026-09-29T14:00:00.000Z', fields: { Closer: 'Alex', Status: 'Contacted', 'Appointment Date': '2026-10-05', 'Speed to Lead (sec)': '45' } },
  { id: 'p5', createdTime: '2026-09-29T14:00:00.000Z', fields: { Closer: 'Alex' } },                                       // blank status -> not contacted
  { id: 'p6', createdTime: '2026-09-29T14:00:00.000Z', fields: { fldRsOqpZHKrQ9evO: 'Jo', fldrEbJgggOdlQTCd: 'Won', fld5K3K1PhwGNp4qV: 10, fldAJyiB8nnyLKW9B: '2026-09-27T12:00:00.000Z' } },
];

const EOD_RECS = [
  { id: 'e1', createdTime: '2026-09-29T22:00:00.000Z', fields: { Closer: 'Alex', Date: '2026-09-29', 'Calls Attempted': 40, 'Calls Connected': 12, 'Offers Given': 3, Closes: 1, Energy: 7, Focus: 8, 'Submitted At': '2026-09-29T22:00:00.000Z' } },
  { id: 'e2', createdTime: '2026-09-29T23:00:00.000Z', fields: { Closer: 'Alex', Date: '2026-09-29', 'Calls Attempted': 45, 'Calls Connected': 14, 'Offers Given': 4, Closes: 2, 'Submitted At': '2026-09-29T23:00:00.000Z' } }, // later upsert wins
  { id: 'e3', createdTime: '2026-09-29T21:00:00.000Z', fields: { Closer: 'Sam', Date: '2026-09-29T00:00:00.000Z', 'Calls Attempted': '10', 'Calls Connected': null, 'Offers Given': 1, Closes: 0 } },
  { id: 'e4', createdTime: '2026-09-28T21:00:00.000Z', fields: { Closer: 'Sam', 'Calls Attempted': 5 } }, // no Date -> skipped
];

/* ---------------------------------------------------------------------------
 * fetch mock
 * ------------------------------------------------------------------------ */

function mockAirtable(tables, { reject422 = () => false } = {}) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    const table = decodeURIComponent(u.pathname.split('/').pop());
    const params = Object.fromEntries(u.searchParams.entries());
    const fields = u.searchParams.getAll('fields[]');
    calls.push({ table, params, fields });
    if (reject422(table, params)) {
      return new Response(JSON.stringify({ error: { type: 'INVALID_FILTER_BY_FORMULA', message: 'Unknown field names' } }), { status: 422 });
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
  return Promise.resolve().then(fn).finally(done);
}

/* ---------------------------------------------------------------------------
 * Pure helpers
 * ------------------------------------------------------------------------ */

test('parseLeadCost classifies every Lead Cost shape', () => {
  assert.deepEqual(parseLeadCost('$85'), { kind: 'billed', price: 85, raw: '$85' });
  assert.deepEqual(parseLeadCost(' $ 115 '), { kind: 'billed', price: 115, raw: '$ 115' });
  assert.deepEqual(parseLeadCost('72.5'), { kind: 'billed', price: 72.5, raw: '72.5' });
  assert.equal(parseLeadCost('Free').kind, 'free');
  assert.equal(parseLeadCost('FREE').kind, 'free');
  assert.equal(parseLeadCost('replacement').kind, 'replacement');
  assert.equal(parseLeadCost('Prepay').kind, 'prepay');
  assert.equal(parseLeadCost('Unbilled').kind, 'unbilled');
  assert.equal(parseLeadCost('').kind, 'unknown');
  assert.equal(parseLeadCost(null).kind, 'unknown');
  assert.equal(parseLeadCost('$85 (promo)').kind, 'unknown');
  assert.equal(parseLeadCost({ name: '$55' }).kind, 'billed');
  assert.equal(parseLeadCost({ name: '$55' }).price, 55);
});

test('retainerClientNames picks active weekly retainers from the rate card', () => {
  const names = retainerClientNames({
    '(A) Weekly': { airtable: 'Weekly Co', rule: { type: 'weekly', perWeek: 500 } },
    '(B) Paused weekly': { airtable: 'Paused Co', rule: { type: 'weekly', perWeek: 500 }, paused: true },
    '(C) Per lead': { airtable: 'Per Lead Co', rule: { type: 'perLead', rate: 80 } },
    '(D) No airtable': { rule: { type: 'weekly', perWeek: 100 } },
  });
  assert.deepEqual(names, ['Weekly Co', '(D) No airtable']);
  // The live rate card has PROS on a weekly retainer.
  assert.ok(retainerClientNames().includes('PROS Tree & Landscape (Phoenix)'));
});

test('airtableDate keeps date-only values and converts instants to the business day', () => {
  assert.equal(airtableDate('2026-09-29', TZ), '2026-09-29');
  assert.equal(airtableDate('2026-09-30T03:30:00.000Z', TZ), '2026-09-29');
  assert.equal(airtableDate('2026-09-30T03:30:00.000Z', 'UTC'), '2026-09-30');
  assert.equal(airtableDate('', TZ), null);
  assert.equal(airtableDate(null, TZ), null);
  assert.equal(airtableDate('nope', TZ), null);
  assert.equal(numberOrNull(''), null);
  assert.equal(numberOrNull(null), null);
  assert.equal(numberOrNull('12'), 12);
  assert.equal(numberOrNull('abc'), null);
  assert.equal(numberOrNull(0), 0);
});

/* ---------------------------------------------------------------------------
 * Normalisers
 * ------------------------------------------------------------------------ */

test('normaliseClients resolves Company Name, then Name, then record id', () => {
  const { rows, nameById, meta } = normaliseClients(CLIENT_RECS, { tz: TZ });
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { name: 'PROS Tree & Landscape (Phoenix)', createdDate: '2026-01-10', id: 'recPROS' });
  assert.equal(rows[1].createdDate, '2026-09-29'); // 03:30Z on the 30th is the 29th in Toronto
  assert.equal(nameById.recNAME, 'Legacy Name Only');
  assert.equal(nameById.recBLANK, 'recBLANK');
  assert.equal(meta.fetched, 4);
  assert.equal(meta.malformed, 0);
});

test('normaliseLeads maps Lead Cost, retainers, unassigned and unknown clients', () => {
  const { nameById } = normaliseClients(CLIENT_RECS, { tz: TZ });
  const { rows, meta } = normaliseLeads(LEAD_RECS, nameById, { tz: TZ, retainerClients: ['PROS Tree & Landscape (Phoenix)'] });

  assert.equal(meta.fetched, 12);
  assert.equal(meta.unassigned, 1);
  assert.equal(meta.noDate, 1);
  assert.equal(rows.length, 10);

  const byId = Object.fromEntries(LEAD_RECS.filter(r => r.createdTime && r.fields['Assigned Client']).map((r, i) => [r.id, rows[i]]));
  assert.deepEqual(byId.l1, { date: '2026-09-29', client: 'Protree Services LLC', kind: 'billed', price: 85 });
  assert.equal(byId.l2.kind, 'free');
  assert.equal(byId.l3.kind, 'replacement');
  assert.equal(byId.l4.kind, 'prepay');
  assert.equal(byId.l5.kind, 'unbilled');
  assert.equal(byId.l6.kind, 'unknown');
  assert.equal(byId.l7.kind, 'unknown');
  assert.deepEqual(byId.l8, { date: '2026-09-29', client: 'PROS Tree & Landscape (Phoenix)', kind: 'billed', price: 0 });
  assert.deepEqual(byId.l9, { date: '2026-09-29', client: 'PROS Tree & Landscape (Phoenix)', kind: 'billed', price: 0 });
  assert.equal(byId.l11.client, '(unknown client recGONE)');
  assert.equal(byId.l11.kind, 'billed');

  assert.deepEqual(meta.kinds, { billed: 4, free: 1, replacement: 1, prepay: 1, unbilled: 1, unknown: 2 });
  assert.deepEqual(meta.unknownCostValues, { '(blank)': 1, Comped: 1 });
  assert.ok(meta.warnings.some(w => /2 leads have a Lead Cost the dashboard does not recognise/.test(w)), meta.warnings.join('\n'));
  assert.ok(meta.warnings.some(w => /recGONE/.test(w)));
  assert.ok(meta.warnings.some(w => /no createdTime/.test(w)));
});

test('normaliseLeads retainer matching is case/space-insensitive and never throws on garbage', () => {
  const recs = [
    { id: 'a', createdTime: '2026-09-29T14:00:00.000Z', fields: { 'Assigned Client': ['recX'], 'Lead Cost': 'Free' } },
    { id: 'b', createdTime: '2026-09-29T14:00:00.000Z', fields: null },
    null,
    { id: 'c', createdTime: '2026-09-29T14:00:00.000Z', fields: { 'Assigned Client': 'recX', 'Lead Cost': '$90' } }, // string link id
  ];
  const { rows, meta } = normaliseLeads(recs, { recX: 'Weekly Co' }, { tz: TZ, retainerClients: [' weekly co '] });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, 'billed');
  assert.equal(rows[0].price, 0);
  assert.equal(rows[1].price, 0);
  assert.equal(meta.unassigned + meta.malformed, 2);
  assert.ok(meta.warnings.length >= 0);
});

test('normaliseProspects derives contacted/booked and honours field-id fallbacks', () => {
  const { rows, meta } = normaliseProspects(PROSPECT_RECS, { tz: TZ });
  assert.equal(rows.length, 6);
  const [p1, p2, p3, p4, p5, p6] = rows;

  assert.equal(p1.date, '2026-09-29');
  assert.equal(p1.closer, 'Alex');
  assert.equal(p1.contacted, true);
  assert.equal(p1.booked, true);
  assert.equal(p1.appointmentDate, '2026-10-02');
  assert.equal(p1.speedToLead, 120);
  assert.equal(p1.timeCalled, '2026-09-30T03:32:00.000Z');

  assert.equal(p2.date, '2026-09-28', 'Created At beats createdTime');
  assert.equal(p2.closer, 'Sam');
  assert.equal(p2.status, 'Hotlist');
  assert.equal(p2.contacted, false);
  assert.equal(p2.booked, false);
  assert.equal(p2.appointmentDate, null);

  assert.equal(p3.closer, '(unassigned)');
  assert.equal(p3.contacted, false, 'follow up (any case) is not contacted');
  assert.equal(p3.speedToLead, null);

  assert.equal(p4.contacted, true);
  assert.equal(p4.appointmentDate, '2026-10-05', 'date-only appointment stays as-is');
  assert.equal(p4.speedToLead, 45);

  assert.equal(p5.status, '');
  assert.equal(p5.contacted, false, 'blank status is not contacted');

  assert.equal(p6.closer, 'Jo');
  assert.equal(p6.status, 'Won');
  assert.equal(p6.contacted, true);
  assert.equal(p6.speedToLead, 10);
  assert.equal(p6.date, '2026-09-27');

  assert.deepEqual(meta.closers, ['(unassigned)', 'Alex', 'Jo', 'Sam']);
  assert.deepEqual(meta.statuses, { Booked: 1, Hotlist: 1, 'follow up': 1, Contacted: 1, '(blank)': 1, Won: 1 });
  assert.equal(meta.fetched, 6);
});

test('normaliseEod dedupes (closer, date) keeping the latest Submitted At', () => {
  const { rows, meta } = normaliseEod(EOD_RECS, { tz: TZ });
  assert.equal(rows.length, 2);
  const alex = rows.find(r => r.closer === 'Alex');
  const sam = rows.find(r => r.closer === 'Sam');
  assert.deepEqual(alex, { date: '2026-09-29', closer: 'Alex', attempted: 45, connected: 14, offers: 4, closes: 2, energy: null, focus: null, submittedAt: '2026-09-29T23:00:00.000Z' });
  assert.deepEqual(sam, { date: '2026-09-29', closer: 'Sam', attempted: 10, connected: 0, offers: 1, closes: 0, energy: null, focus: null, submittedAt: null });
  assert.equal(meta.duplicates, 1);
  assert.equal(meta.noDate, 1);
  assert.ok(meta.warnings.some(w => /1 duplicate Closer EOD submission/.test(w)), meta.warnings.join('\n'));
});

test('normaliseEod keeps the earlier record when the later one has an older Submitted At', () => {
  const recs = [
    { id: 'a', createdTime: '2026-09-01T00:00:00.000Z', fields: { Closer: 'Alex', Date: '2026-09-01', Closes: 1, 'Submitted At': '2026-09-02T10:00:00.000Z' } },
    { id: 'b', createdTime: '2026-09-03T00:00:00.000Z', fields: { Closer: 'alex', Date: '2026-09-01', Closes: 9, 'Submitted At': '2026-09-01T10:00:00.000Z' } },
  ];
  const { rows } = normaliseEod(recs, { tz: TZ });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].closes, 1);
});

/* ---------------------------------------------------------------------------
 * Configuration
 * ------------------------------------------------------------------------ */

test('isConfigured / config / setupHint follow the env', async () => {
  await withEnv({ AIRTABLE_API_KEY: null, AIRTABLE_HS_BASE: null, AIRTABLE_HS_LEADS_TABLE: null }, async () => {
    assert.equal(isConfigured(), false);
    assert.equal(config().base, DEFAULTS.base);
    assert.equal(config().leadsTable, DEFAULTS.leadsTable);
    assert.match(setupHint(), /AIRTABLE_API_KEY/);
    await assert.rejects(() => fetchLeads({ from: '2026-09-01', to: '2026-09-30', tz: TZ }), (e) => e instanceof SourceError && e.missingConfig && /AIRTABLE_API_KEY/.test(e.hint));
    await assert.rejects(() => fetchClients({ tz: TZ }), (e) => e instanceof SourceError && e.missingConfig);
    await assert.rejects(() => fetchProspects({ from: '2026-09-01', to: '2026-09-30', tz: TZ }), (e) => e instanceof SourceError && e.missingConfig);
    await assert.rejects(() => fetchCloserEod({ from: '2026-09-01', to: '2026-09-30', tz: TZ }), (e) => e instanceof SourceError && e.missingConfig);
  });
  await withEnv({ AIRTABLE_API_KEY: 'pat', AIRTABLE_HS_BASE: 'appOther', AIRTABLE_HS_LEADS_TABLE: 'tblLeads' }, async () => {
    assert.equal(isConfigured(), true);
    assert.equal(config().base, 'appOther');
    assert.equal(config().leadsTable, 'tblLeads');
  });
});

/* ---------------------------------------------------------------------------
 * Fetchers with a mocked Airtable
 * ------------------------------------------------------------------------ */

test('fetchLeads requests only the two fields, date-bounds the pull and resolves clients', async () => {
  const m = mockAirtable({ [DEFAULTS.leadsTable]: LEAD_RECS, [DEFAULTS.clientsTable]: CLIENT_RECS });
  try {
    await withEnv({ AIRTABLE_API_KEY: 'pat', AIRTABLE_HS_BASE: null }, async () => {
      const { rows, meta } = await fetchLeads({ from: '2026-09-01', to: '2026-10-01', tz: TZ });
      const leadCall = m.calls.find(c => c.table === DEFAULTS.leadsTable);
      assert.deepEqual(leadCall.fields, ['Assigned Client', 'Lead Cost']);
      assert.equal(leadCall.params.filterByFormula, 'IS_AFTER(CREATED_TIME(), DATETIME_PARSE("2026-08-31"))');
      assert.equal(m.calls.filter(c => c.table === DEFAULTS.clientsTable).length, 1, 'clients fetched once');
      assert.equal(rows.length, 10);
      assert.equal(rows[0].client, 'Protree Services LLC');
      // PROS is a live weekly retainer, so its leads are billed at $0 regardless of Lead Cost.
      assert.ok(rows.filter(r => r.client === 'PROS Tree & Landscape (Phoenix)').every(r => r.kind === 'billed' && r.price === 0));
      assert.equal(meta.since, '2026-08-31');
      assert.equal(meta.unassigned, 1);
    });
  } finally { m.restore(); }
});

test('fetchLeads follows pagination', async () => {
  const many = Array.from({ length: 250 }, (_, i) => ({ id: `l${i}`, createdTime: '2026-09-29T14:00:00.000Z', fields: { 'Assigned Client': ['recED'], 'Lead Cost': '$85' } }));
  const m = mockAirtable({ [DEFAULTS.leadsTable]: many, [DEFAULTS.clientsTable]: CLIENT_RECS });
  try {
    await withEnv({ AIRTABLE_API_KEY: 'pat' }, async () => {
      const { rows } = await fetchLeads({ from: '2026-09-01', to: '2026-10-01', tz: TZ });
      assert.equal(rows.length, 250);
      assert.equal(m.calls.filter(c => c.table === DEFAULTS.leadsTable).length, 3);
    });
  } finally { m.restore(); }
});

test('fetchLeads rejects a malformed window and surfaces upstream errors as SourceError', async () => {
  const m = mockAirtable({ [DEFAULTS.clientsTable]: CLIENT_RECS }); // leads table missing -> 404
  try {
    await withEnv({ AIRTABLE_API_KEY: 'pat' }, async () => {
      await assert.rejects(() => fetchLeads({ from: 'Sept 1', to: '2026-10-01', tz: TZ }), (e) => e instanceof SourceError && /from must be YYYY-MM-DD/.test(e.message));
      await assert.rejects(() => fetchLeads({ from: '2026-09-01', to: '2026-10-01', tz: TZ }), (e) => e instanceof SourceError && e.status === 404);
    });
  } finally { m.restore(); }
});

test('fetchClients returns every client with its local created date', async () => {
  const m = mockAirtable({ [DEFAULTS.clientsTable]: CLIENT_RECS });
  try {
    await withEnv({ AIRTABLE_API_KEY: 'pat' }, async () => {
      const { rows, meta } = await fetchClients({ from: '2026-09-01', to: '2026-10-01', tz: TZ });
      assert.equal(rows.length, 4);
      assert.equal(rows[1].createdDate, '2026-09-29');
      assert.equal(meta.fetched, 4);
    });
  } finally { m.restore(); }
});

test('fetchProspects uses the OR() formula and falls back when Airtable rejects a field', async () => {
  const formulas = prospectFormulas('2026-08-31');
  assert.match(formulas[0], /^OR\(IS_AFTER\(CREATED_TIME\(\), DATETIME_PARSE\("2026-08-31"\)\), IF\(\{Created At\}, IS_AFTER\(\{Created At\}, DATETIME_PARSE\("2026-08-31"\)\), 0\), IF\(\{Appointment Date\}, IS_AFTER\(\{Appointment Date\}, DATETIME_PARSE\("2026-08-31"\)\), 0\)\)$/);
  assert.equal(formulas[formulas.length - 1], 'IS_AFTER(CREATED_TIME(), DATETIME_PARSE("2026-08-31"))');

  // Happy path: first formula accepted.
  let m = mockAirtable({ [DEFAULTS.prospectsTable]: PROSPECT_RECS });
  try {
    await withEnv({ AIRTABLE_API_KEY: 'pat' }, async () => {
      const { rows, meta } = await fetchProspects({ from: '2026-09-01', to: '2026-10-01', tz: TZ });
      assert.equal(rows.length, 6);
      assert.equal(m.calls.length, 1);
      assert.equal(m.calls[0].params.filterByFormula, formulas[0]);
      assert.equal(meta.formula, formulas[0]);
      assert.equal(meta.warnings.length, 0);
      assert.deepEqual(meta.closers, ['(unassigned)', 'Alex', 'Jo', 'Sam']);
    });
  } finally { m.restore(); }

  // Fallback: every formula naming "Appointment Date" or "Created At" is rejected with 422.
  m = mockAirtable({ [DEFAULTS.prospectsTable]: PROSPECT_RECS }, { reject422: (t, p) => /Appointment Date|Created At/.test(p.filterByFormula || '') });
  try {
    await withEnv({ AIRTABLE_API_KEY: 'pat' }, async () => {
      const { rows, meta } = await fetchProspects({ from: '2026-09-01', to: '2026-10-01', tz: TZ });
      assert.equal(rows.length, 6);
      assert.equal(meta.formula, formulas[3]);
      assert.ok(meta.warnings.some(w => /narrower formula/.test(w)));
    });
  } finally { m.restore(); }

  // Non-422 errors propagate.
  m = mockAirtable({});
  try {
    await withEnv({ AIRTABLE_API_KEY: 'pat' }, async () => {
      await assert.rejects(() => fetchProspects({ from: '2026-09-01', to: '2026-10-01', tz: TZ }), (e) => e instanceof SourceError && e.status === 404);
    });
  } finally { m.restore(); }
});

test('fetchCloserEod filters on {Date}, dedupes and reports duplicates', async () => {
  const m = mockAirtable({ [DEFAULTS.eodTable]: EOD_RECS });
  try {
    await withEnv({ AIRTABLE_API_KEY: 'pat' }, async () => {
      const { rows, meta } = await fetchCloserEod({ from: '2026-09-01', to: '2026-10-01', tz: TZ });
      assert.equal(m.calls[0].params.filterByFormula, 'IS_AFTER({Date}, DATETIME_PARSE("2026-08-31"))');
      assert.equal(rows.length, 2);
      assert.equal(meta.duplicates, 1);
      assert.equal(meta.since, '2026-08-31');
      assert.ok(meta.warnings.some(w => /duplicate/.test(w)));
    });
  } finally { m.restore(); }
});
