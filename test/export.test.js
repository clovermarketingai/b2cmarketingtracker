import test from 'node:test';
import assert from 'node:assert/strict';
import {
  flattenPayload, dailyRows, toCsv, csvCell, clampRange, parseList, parseSections, parseIds,
  FLAT_COLUMNS, FLAT_RANGE_IDS, DAILY_IDS, CEO_ONLY_IDS, SECTION_IDS, CLIENT_COLUMNS,
} from '../lib/dashboard/export.js';
import { buildDashboard, sectionValues } from '../lib/dashboard/compute.js';
import { demoDatasets } from '../lib/dashboard/demo.js';
import { SECTIONS, ALL_ROW_IDS } from '../lib/dashboard/catalog.js';
import { eachDay, addDays } from '../lib/dashboard/dates.js';

const TODAY = '2026-09-30';
const TZ = 'America/Toronto';

function demoPayload(ceoUnlocked = true) {
  const { datasets, targets } = demoDatasets(TODAY);
  const availability = Object.fromEntries(Object.keys(datasets).map(k => [k, true]));
  const payload = buildDashboard({ today: TODAY, tz: TZ, datasets, availability, targets, ceoUnlocked });
  payload.generatedAt = '2026-09-30T12:00:00.000Z';
  return { payload, datasets };
}

/* ---------------------------------------------------------------- flatten */

test('flattenPayload: one row per catalog row, in section order, with every column', () => {
  const { payload } = demoPayload(true);
  const flat = flattenPayload(payload);
  assert.equal(flat.generatedAt, '2026-09-30T12:00:00.000Z');
  assert.equal(flat.today, TODAY);
  assert.equal(flat.tz, TZ);
  const expected = SECTIONS.reduce((n, s) => n + s.rows.length, 0);
  assert.equal(flat.rows.length, expected);
  assert.equal(flat.rows[0].section, 'ceo');
  assert.equal(flat.rows[0].id, 'cash_collected');
  for (const r of flat.rows) {
    assert.deepEqual(Object.keys(r), FLAT_COLUMNS);
    for (const rid of FLAT_RANGE_IDS) assert.ok(r[rid] === null || typeof r[rid] === 'number', `${r.id}.${rid}`);
  }
  const cash = flat.rows.find(r => r.id === 'cash_collected');
  const src = payload.ceo.rows.find(r => r.id === 'cash_collected');
  assert.equal(cash.mtd, src.values.mtd);
  assert.equal(cash.w1, src.values.w1);
  assert.equal(cash.target, src.target);
  assert.equal(cash.pace, src.pace);
  assert.equal(cash.status, src.status);
  const order = SECTIONS.map(s => s.id);
  const seen = [...new Set(flat.rows.map(r => r.section))];
  assert.deepEqual(seen, order);
});

test('flattenPayload: locked CEO section is omitted; section filter keeps only the asked sections', () => {
  const { payload } = demoPayload(false);
  const flat = flattenPayload(payload);
  assert.ok(!flat.rows.some(r => r.section === 'ceo'));
  const only = flattenPayload(payload, { sections: ['sales', 'csm'] });
  assert.deepEqual([...new Set(only.rows.map(r => r.section))], ['sales', 'csm']);
  const ceoAsked = flattenPayload(payload, { sections: ['ceo'] });
  assert.equal(ceoAsked.rows.length, 0);
});

test('flattenPayload: non-finite pace and missing weeks become null', () => {
  const payload = {
    today: TODAY, tz: TZ, generatedAt: null, ceo: { locked: true },
    sections: [{ id: 'sales', rows: [{ id: 'closes', label: 'Closes', unit: 'number', values: { today: 1, mtd: 5 }, target: 0, pace: Infinity, status: 'well_ahead' }] }],
  };
  const flat = flattenPayload(payload);
  assert.equal(flat.rows.length, 1);
  assert.equal(flat.rows[0].pace, null);
  assert.equal(flat.rows[0].w5, null);
  assert.equal(flat.rows[0].yesterday, null);
  assert.equal(flat.rows[0].today, 1);
  assert.throws(() => flattenPayload(null), TypeError);
});

/* ------------------------------------------------------------------- csv */

test('csvCell / toCsv: RFC 4180 quoting, raw numbers, empty for null', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line1\nline2'), '"line1\nline2"');
  assert.equal(csvCell('cr\rlf'), '"cr\rlf"');
  assert.equal(csvCell(1234.5), '1234.5');
  assert.equal(csvCell(0), '0');
  assert.equal(csvCell(NaN), '');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(true), 'true');

  const rows = [
    { date: '2026-09-29', name: 'Ed, Protree', spend: 100.25, note: null },
    { date: '2026-09-30', name: 'Nico "PROS"', spend: 0, note: 'multi\nline' },
  ];
  const csv = toCsv(rows, ['date', 'name', 'spend', 'note']);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'date,name,spend,note');
  assert.equal(lines[1], '2026-09-29,"Ed, Protree",100.25,');
  assert.equal(lines[2], '2026-09-30,"Nico ""PROS""",0,"multi\nline"');
  assert.equal(lines[3], '');
  assert.ok(csv.endsWith('\r\n'));
});

test('toCsv: columns default to the union of keys in first-seen order; empty input gives a header only', () => {
  const csv = toCsv([{ a: 1 }, { b: 2, a: 3 }]);
  assert.equal(csv, 'a,b\r\n1,\r\n3,2\r\n');
  assert.equal(toCsv([], ['x', 'y']), 'x,y\r\n');
  assert.equal(toCsv([]), '\r\n');
  assert.equal(toCsv([null], ['x']), 'x\r\n\r\n');
});

/* ------------------------------------------------------------ clampRange */

test('clampRange: defaults to the last 30 days ending today', () => {
  const r = clampRange(undefined, undefined, TODAY);
  assert.deepEqual(r, { from: '2026-09-01', to: TODAY, days: 30, clamped: false });
  const r2 = clampRange('', '', TODAY, { defaultDays: 7 });
  assert.deepEqual(r2, { from: '2026-09-24', to: TODAY, days: 7, clamped: false });
});

test('clampRange: explicit dates, defaulting only the missing side', () => {
  assert.deepEqual(clampRange('2026-09-10', '2026-09-12', TODAY), { from: '2026-09-10', to: '2026-09-12', days: 3, clamped: false });
  assert.deepEqual(clampRange('2026-09-25', undefined, TODAY), { from: '2026-09-25', to: TODAY, days: 6, clamped: false });
  assert.deepEqual(clampRange(undefined, '2026-09-10', TODAY, { defaultDays: 3 }), { from: '2026-09-08', to: '2026-09-10', days: 3, clamped: false });
});

test('clampRange: a future `to` is clamped to today', () => {
  const r = clampRange('2026-09-28', '2026-10-15', TODAY);
  assert.deepEqual(r, { from: '2026-09-28', to: TODAY, days: 3, clamped: true });
});

test('clampRange: validation errors come back as { error }', () => {
  assert.match(clampRange('2026/09/01', undefined, TODAY).error, /from must be/);
  assert.match(clampRange('2026-09-31', undefined, TODAY).error, /from must be/);
  assert.match(clampRange(undefined, 'yesterday', TODAY).error, /to must be/);
  assert.match(clampRange('2026-09-20', '2026-09-10', TODAY).error, /after to/);
  assert.match(clampRange('2026-10-05', undefined, TODAY).error, /after today/);
  assert.match(clampRange('2026-06-01', TODAY, TODAY).error, /maximum is 92/);
  assert.match(clampRange('2026-06-01', TODAY, TODAY).error, /from=2026-07-01&to=2026-09-30/);
  assert.match(clampRange(undefined, undefined, 'nope').error, /today/);
  // exactly maxDays is allowed
  const ok = clampRange("2026-07-01", TODAY, TODAY);
  assert.equal(ok.days, 92);
  assert.equal(ok.error, undefined);
});

/* ------------------------------------------------------------- dailyRows */

test('dailyRows: one row per day over the demo datasets, values match sectionValues for a spot-checked day', () => {
  const { datasets } = demoPayload(true);
  const from = '2026-09-20';
  const to = TODAY;
  const rows = dailyRows({ datasets, from, to });
  assert.equal(rows.length, 11);
  assert.deepEqual(rows.map(r => r.date), eachDay(from, to));
  for (const r of rows) assert.deepEqual(Object.keys(r), ['date', ...DAILY_IDS]);

  const day = '2026-09-25';
  const expected = sectionValues(datasets, { from: day, to: day });
  const got = rows.find(r => r.date === day);
  for (const id of DAILY_IDS) {
    const e = expected[id];
    assert.equal(got[id], e == null || !Number.isFinite(e) ? null : e, id);
  }
  // A day's cash is the sum of that day's whop rows.
  const cash = datasets.whop.rows.filter(w => w.date === day).reduce((s, w) => s + w.gross, 0);
  assert.equal(got.cash_collected, cash);
  // 30 days of daily cash add up to the l30d figure from the aggregate engine.
  const l30 = dailyRows({ datasets, from: addDays(TODAY, -29), to: TODAY, ids: ['cash_collected', 'leads_sent'] });
  const agg = sectionValues(datasets, { from: addDays(TODAY, -29), to: TODAY });
  assert.equal(l30.reduce((s, r) => s + r.cash_collected, 0), agg.cash_collected);
  assert.equal(l30.reduce((s, r) => s + r.leads_sent, 0), agg.leads_sent);
});

test('dailyRows: ids restrict the columns; unavailable datasets null their rows; bad input throws', () => {
  const { datasets } = demoPayload(true);
  const rows = dailyRows({ datasets, from: '2026-09-29', to: TODAY, ids: ['leads_billed', 'closes', 'cash_collected'], availability: { whop: false } });
  assert.equal(rows.length, 2);
  assert.deepEqual(Object.keys(rows[0]), ['date', 'leads_billed', 'closes', 'cash_collected']);
  assert.equal(rows[0].cash_collected, null);
  assert.equal(typeof rows[0].leads_billed, 'number');
  // With no datasets at all, sums are 0 and rates are null, never NaN.
  const empty = dailyRows({ datasets: {}, from: TODAY, to: TODAY, ids: ['leads_sent', 'ctr'] });
  assert.deepEqual(empty, [{ date: TODAY, leads_sent: 0, ctr: null }]);
  assert.throws(() => dailyRows({ datasets, from: 'x', to: TODAY }), RangeError);
  assert.throws(() => dailyRows({ datasets, from: TODAY, to: '2026-09-01' }), RangeError);
  assert.throws(() => dailyRows({ from: TODAY, to: TODAY }), TypeError);
});

/* --------------------------------------------------------------- parsers */

test('parseList / parseSections / parseIds', () => {
  assert.deepEqual(parseList(' a, b ,,a'), ['a', 'b']);
  assert.deepEqual(parseList(['a,b', 'c']), ['a', 'b', 'c']);
  assert.deepEqual(parseList(undefined), []);

  assert.deepEqual(parseSections(undefined), { sections: null, unknown: [] });
  assert.deepEqual(parseSections('ceo,sales,nope'), { sections: ['ceo', 'sales'], unknown: ['nope'] });
  assert.deepEqual(SECTION_IDS, SECTIONS.map(s => s.id));

  assert.deepEqual(parseIds(undefined).ids, DAILY_IDS);
  assert.deepEqual(parseIds('cash_collected,leads_billed,bogus'), { ids: ['cash_collected', 'leads_billed'], unknown: ['bogus'] });
  const limited = parseIds('cash_collected,leads_billed', { allowed: ['leads_billed'] });
  assert.deepEqual(limited, { ids: ['leads_billed'], unknown: ['cash_collected'] });
});

test('constants: CEO-only ids exclude shared rows; DAILY_IDS covers the whole catalog; client columns are the documented set', () => {
  assert.ok(CEO_ONLY_IDS.includes('cash_collected'));
  assert.ok(!CEO_ONLY_IDS.includes('hs_billed_value'), 'hs_billed_value also lives in hs_delivery');
  for (const id of ALL_ROW_IDS) assert.ok(DAILY_IDS.includes(id), id);
  assert.deepEqual(CLIENT_COLUMNS, [
    'name', 'airtable', 'windsor', 'health', 'spend', 'leads', 'billed', 'free', 'replacement', 'prepay', 'unbilled',
    'billedValue', 'retainer', 'cplBilled', 'profit', 'margin', 'lastLeadDate', 'daysSinceLastLead',
  ]);
});
