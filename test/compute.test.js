import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sectionValues, buildDashboard, paceFor, costsAgg, retainerRevenue, clientActivity, div,
} from '../lib/dashboard/compute.js';
import { ROW_BY_ID, SECTIONS, ALL_ROW_IDS } from '../lib/dashboard/catalog.js';
import { demoDatasets } from '../lib/dashboard/demo.js';

const R = (from, to) => ({ from, to });

const retainers = [
  { client: '(Nico) PROS Tree & Landscape', airtable: 'PROS Tree & Landscape (Phoenix)', short: 'Nico PROS', perWeek: 700, paused: false },
  { client: '(Ed) Protree Services LLC', airtable: 'Protree Services LLC', short: 'Ed Protree', perWeek: 0, paused: false },
  { client: '(Cesar) Cesar Tree Service Inc', airtable: 'Cesar Tree Service Inc', short: 'Cesar', perWeek: 0, paused: true },
];

const small = {
  ads: { rows: [
    { date: '2026-09-29', campaign: '(Ed) Protree Services LLC - Tree Service A', campaignId: 'a', line: 'hs_b2c', client: '(Ed) Protree Services LLC', spend: 100, clicks: 50, impressions: 5000, fbLeads: 4 },
    { date: '2026-09-29', campaign: '(Ed) Protree Services LLC - Tree Service B', campaignId: 'b', line: 'hs_b2c', client: '(Ed) Protree Services LLC', spend: 50, clicks: 25, impressions: 2500, fbLeads: 1 },
    { date: '2026-09-29', campaign: '(Nico) PROS Tree & Landscape - Tree Service', campaignId: 'c', line: 'hs_b2c', client: '(Nico) PROS Tree & Landscape', spend: 30, clicks: 10, impressions: 1000, fbLeads: 2 },
    { date: '2026-09-29', campaign: 'B2B Home Service', campaignId: 'd', line: 'hs_b2b', client: null, spend: 80, clicks: 40, impressions: 4000, fbLeads: 2 },
    { date: '2026-09-29', campaign: 'B2B Tax', campaignId: 'e', line: 'tax_b2b', client: null, spend: 200, clicks: 100, impressions: 8000, fbLeads: 5 },
    { date: '2026-09-28', campaign: '(Ed) Protree Services LLC - Tree Service A', campaignId: 'a', line: 'hs_b2c', client: '(Ed) Protree Services LLC', spend: 100, clicks: 50, impressions: 5000, fbLeads: 3 },
  ] },
  hsLeads: { rows: [
    { date: '2026-09-29', client: 'Protree Services LLC', kind: 'billed', price: 85 },
    { date: '2026-09-29', client: 'Protree Services LLC', kind: 'billed', price: 85 },
    { date: '2026-09-29', client: 'Protree Services LLC', kind: 'billed', price: 85 },
    { date: '2026-09-29', client: 'Protree Services LLC', kind: 'replacement', price: 0 },
    { date: '2026-09-29', client: 'Protree Services LLC', kind: 'free', price: 0 },
    { date: '2026-09-29', client: 'PROS Tree & Landscape (Phoenix)', kind: 'billed', price: 0 },
    { date: '2026-09-29', client: 'PROS Tree & Landscape (Phoenix)', kind: 'billed', price: 0 },
    { date: '2026-09-28', client: 'Protree Services LLC', kind: 'billed', price: 85 },
    { date: '2026-09-20', client: 'HLI Tree Experts', kind: 'billed', price: 80 },
  ] },
  clients: { rows: [{ name: 'Protree Services LLC', createdDate: '2026-09-02' }, { name: 'HLI Tree Experts', createdDate: '2026-06-01' }] },
  retainers,
  whop: { rows: [
    { date: '2026-09-29', gross: 1000, net: 970.7, fees: 29.3, refunded: 0, product: 'Tree Service Leads', status: 'paid' },
    { date: '2026-09-29', gross: 500, net: 485.2, fees: 14.8, refunded: 500, product: 'Setup fee', status: 'refunded' },
    { date: '2026-09-01', gross: 2500, net: 2427.5, fees: 72.5, refunded: 0, product: 'Tax Leads Batch', status: 'paid' },
  ] },
  costs: { rows: [
    { date: '2026-09-01', category: 'Payroll', amount: 3000, period: 'monthly' },
    { date: '2026-09-29', category: 'Affiliates', amount: 120, period: 'once' },
    { date: '2026-09-29', category: 'Messaging', amount: 10, period: 'once' },
    { date: '2026-09-29', category: 'Personal projects', amount: 40, period: 'once' },
  ] },
  closerEod: { rows: [
    { date: '2026-09-29', closer: 'Tyler', attempted: 40, connected: 10, offers: 4, closes: 1 },
    { date: '2026-09-29', closer: 'Jeshua', attempted: 20, connected: 10, offers: 6, closes: 2 },
    { date: '2026-09-28', closer: 'Tyler', attempted: 30, connected: 5, offers: 0, closes: 0 },
  ] },
  prospects: { rows: [
    { date: '2026-09-29', closer: 'Tyler', status: 'Booked', contacted: true, booked: true, appointmentDate: '2026-09-30', speedToLead: 120 },
    { date: '2026-09-29', closer: 'Tyler', status: 'Follow Up', contacted: false, booked: false, appointmentDate: null, speedToLead: null },
    { date: '2026-09-28', closer: 'Jeshua', status: 'Contacted', contacted: true, booked: false, appointmentDate: null, speedToLead: 600 },
    { date: '2026-09-10', closer: 'Jeshua', status: 'Booked', contacted: true, booked: true, appointmentDate: '2026-09-29', speedToLead: 60 },
  ] },
  b2b: { rows: [
    { date: '2026-09-29', booked: true, showed: true, closed: true, upfrontCash: 3000 },
    { date: '2026-09-29', booked: true, showed: false, closed: false, upfrontCash: 0 },
    { date: '2026-09-29', booked: false, showed: false, closed: false, upfrontCash: 0 },
  ] },
};

test('a client with two campaigns on one day is not double counted', () => {
  const v = sectionValues(small, R('2026-09-29', '2026-09-29'));
  assert.equal(v.hs_spend, 180);          // 100 + 50 + 30
  assert.equal(v.leads_sent, 7);          // 5 Protree + 2 PROS
  assert.equal(v.leads_billed, 5);        // 3 Protree priced + 2 PROS retainer
  assert.equal(v.leads_replacement, 1);
  assert.equal(v.leads_free, 1);
  assert.equal(v.hs_billed_value, 3 * 85 + 700 / 7);   // priced leads + one day of retainer
  assert.equal(v.hs_profit, 355 - 180);
  assert.equal(v.cpl_billed, 180 / 5);
  assert.equal(v.avg_billed_price, 85);   // retainer leads excluded
  assert.equal(v.replacement_rate, (1 / 6) * 100);
});

test('CEO money rows add up', () => {
  const v = sectionValues(small, R('2026-09-29', '2026-09-29'));
  assert.equal(v.cash_collected, 1500);
  assert.equal(v.refunds, 500);
  assert.equal(v.processor_fees, 44.1);
  assert.equal(v.hs_b2c_ads, 180);
  assert.equal(v.hs_b2b_ads, 80);
  assert.equal(v.tax_b2b_ads, 200);
  assert.equal(v.ad_spend_total, 460);
  assert.equal(v.payroll, 100);             // 3000 / 30 days
  assert.equal(v.affiliates, 120);
  assert.equal(v.messaging_cost, 10);
  assert.equal(v.personal_projects, 40);
  const business = 460 + 44.1 + 10 + 120 + 0 + 0;
  assert.ok(Math.abs(v.business_costs - business) < 1e-9);
  assert.ok(Math.abs(v.tracked_costs - (business + 100 + 40)) < 1e-9);
  assert.ok(Math.abs(v.profit_business - (1500 - 500 - business)) < 1e-9);
  assert.ok(Math.abs(v.profit_all - (1500 - 500 - business - 140)) < 1e-9);
});

test('processor fees are null when Whop reports none', () => {
  const noFees = { ...small, whop: { rows: [{ date: '2026-09-29', gross: 100, net: null, fees: null, refunded: 0, product: 'x', status: 'paid' }] } };
  const v = sectionValues(noFees, R('2026-09-29', '2026-09-29'));
  assert.equal(v.processor_fees, null);
  assert.equal(v.cash_collected, 100);
});

test('rates are computed from sums, never averaged, and divide-by-zero is null', () => {
  const v = sectionValues(small, R('2026-09-28', '2026-09-29'));
  assert.equal(v.calls_attempted, 90);
  assert.equal(v.calls_connected, 25);
  assert.equal(v.contact_rate, (25 / 90) * 100);
  assert.equal(v.close_rate, (3 / 10) * 100);
  const empty = sectionValues(small, R('2026-01-01', '2026-01-02'));
  assert.equal(empty.cpl_billed, null);
  assert.equal(empty.close_rate, null);
  assert.equal(empty.ctr, null);
  assert.equal(empty.leads_sent, 0);
  assert.equal(empty.cash_collected, 0);
});

test('prospect metrics: created cohort vs appointment date', () => {
  const v = sectionValues(small, R('2026-09-29', '2026-09-29'));
  assert.equal(v.new_prospects, 2);
  assert.equal(v.booked_calls, 1);            // appointment dated the 29th (created the 10th)
  assert.equal(v.book_rate, 50);              // 1 of the 2 created on the 29th is booked
  assert.equal(v.prospect_contact_rate, 50);
  assert.equal(v.speed_to_lead, 120);
});

test('B2B funnel and CSM rows', () => {
  const v = sectionValues(small, R('2026-09-29', '2026-09-29'));
  assert.equal(v.b2b_leads, 3);
  assert.equal(v.b2b_booked, 2);
  assert.equal(v.b2b_shows, 1);
  assert.equal(v.b2b_closes, 1);
  assert.equal(v.b2b_cash, 3000);
  assert.equal(v.b2b_roas, 15);
  assert.equal(v.b2b_cpa, 200);
  assert.equal(v.b2b_show_rate, 50);
  assert.equal(v.clients_active, 2);          // Protree + PROS (HLI had nothing on the 29th)
  assert.equal(v.clients_paused, 1);
  assert.equal(v.clients_new, 0);
  const m = sectionValues(small, R('2026-09-01', '2026-09-30'));
  assert.equal(m.clients_new, 1);
  assert.equal(m.clients_active, 3);
});

test('client activity maps Windsor keys and Airtable names to one client, case-insensitively', () => {
  const ds = { ...small, hsLeads: { rows: [{ date: '2026-09-29', client: 'protree services llc', kind: 'billed', price: 85 }] } };
  const act = clientActivity(ds, R('2026-09-29', '2026-09-29'));
  const protree = [...act.values()].find(c => c.name === 'Ed Protree');
  assert.ok(protree);
  assert.equal(protree.spend, 150);
  assert.equal(protree.leads, 1);
  assert.equal(protree.unmapped, false);
});

test('monthly costs prorate by day and one-offs land on their date', () => {
  const c = costsAgg({ rows: [
    { date: '2026-02-01', category: 'Payroll', amount: 2800, period: 'monthly' },
    { date: '2026-02-10', category: 'Software', amount: 50, period: 'once' },
    { date: '2026-03-01', category: 'Payroll', amount: 3100, period: 'monthly' },
  ] }, R('2026-02-20', '2026-03-05'));
  assert.equal(c.payroll, 2800 / 28 * 9 + 3100 / 31 * 5);
  assert.equal(c.software_cost, 0);
});

test('retainer revenue prorates per day and skips paused clients', () => {
  const r = retainerRevenue(retainers, R('2026-09-01', '2026-09-07'));
  assert.equal(r.total, 700);
  assert.equal(retainerRevenue(retainers, R('2026-09-01', '2026-09-01')).total, 100);
});

test('pace: cumulative vs level metrics, higher vs lower is better', () => {
  const cum = { cumulative: true, dir: 'higher' };
  assert.equal(paceFor(cum, 500, 1000, 0.5).status, 'on_track');
  assert.equal(paceFor(cum, 700, 1000, 0.5).status, 'well_ahead');
  assert.equal(paceFor(cum, 300, 1000, 0.5).status, 'critical');
  assert.equal(paceFor(cum, 440, 1000, 0.5).status, 'watch');
  const cost = { cumulative: false, dir: 'lower' };
  assert.equal(paceFor(cost, 40, 45, 0.5).status, 'ahead');
  assert.equal(paceFor(cost, 60, 45, 0.5).status, 'behind');
  assert.equal(paceFor(cum, null, 1000, 0.5).status, 'no_data');
  assert.equal(paceFor(cum, 10, null, 0.5).status, 'set_target');
  assert.equal(paceFor({ cumulative: true, dir: 'lower' }, 0, 0, 0.5).status, 'on_track');
});

test('buildDashboard shapes every catalog row for every range and hides CEO when locked', () => {
  const today = '2026-09-30';
  const { datasets, targets } = demoDatasets(today);
  const availability = { ads: true, hsLeads: true, clients: true, retainers: true, whop: true, costs: true, closerEod: true, prospects: true, b2b: false, targets: true };
  const p = buildDashboard({ today, tz: 'America/Toronto', datasets, availability, targets, ceoUnlocked: true });
  assert.equal(p.ceo.locked, false);
  assert.equal(p.sections.length, SECTIONS.length - 1);
  const ids = new Set([...p.ceo.rows, ...p.sections.flatMap(s => s.rows)].map(r => r.id));
  for (const id of ALL_ROW_IDS) assert.ok(ids.has(id), id);
  const cash = p.ceo.rows.find(r => r.id === 'cash_collected');
  for (const k of ['today', 'yesterday', 'l7d', 'l30d', 'mtd', 'lastMonth', 'w1', 'w2', 'w3', 'w4', 'w5']) assert.ok(k in cash.values, k);
  assert.equal(typeof cash.values.mtd, 'number');
  assert.equal(cash.target, 60000);
  assert.ok(['well_ahead', 'ahead', 'on_track', 'watch', 'behind', 'critical'].includes(cash.status));
  const b2bRow = p.sections.find(s => s.id === 'tax_b2b').rows.find(r => r.id === 'b2b_closes');
  assert.equal(b2bRow.values.mtd, null);
  assert.deepEqual(b2bRow.unavailable, ['b2b']);
  assert.equal(b2bRow.status, 'no_data');
  assert.equal(p.series.dates.length, 30);
  assert.equal(p.series.cash_collected.length, 30);
  assert.ok(p.tables.clients.length >= 6);
  assert.ok(p.tables.closers.length === 2);
  const locked = buildDashboard({ today, tz: 'America/Toronto', datasets, availability, targets, ceoUnlocked: false });
  assert.deepEqual(locked.ceo, { locked: true });
});

test('weekly columns partition the MTD total for cumulative rows', () => {
  const today = '2026-09-30';
  const { datasets, targets } = demoDatasets(today);
  const p = buildDashboard({ today, tz: 'UTC', datasets, availability: {}, targets, ceoUnlocked: true });
  const leads = p.sections.find(s => s.id === 'hs_delivery').rows.find(r => r.id === 'leads_billed');
  const weekSum = ['w1', 'w2', 'w3', 'w4', 'w5'].reduce((s, k) => s + (leads.values[k] || 0), 0);
  assert.equal(weekSum, leads.values.mtd);
});

test('the week in progress only covers elapsed days (retainers, monthly costs, per-day rates)', () => {
  const today = '2026-09-16';
  const { datasets, targets } = demoDatasets(today);
  const p = buildDashboard({ today, tz: 'UTC', datasets, availability: {}, targets, ceoUnlocked: true });
  const billed = p.sections.find(s => s.id === 'hs_delivery').rows.find(r => r.id === 'hs_billed_value');
  const direct = sectionValues(datasets, { from: '2026-09-15', to: '2026-09-16' });
  assert.equal(billed.values.w3, direct.hs_billed_value);
  const payroll = p.ceo.rows.find(r => r.id === 'payroll');
  assert.ok(Math.abs(payroll.values.w3 - 2 * (14000 / 30)) < 1e-6);
  assert.ok(Math.abs(billed.values.w1 + billed.values.w2 + billed.values.w3 - billed.values.mtd) < 1e-6);
  assert.equal(billed.values.w4, null);
  assert.equal(p.weeks[2].through, '2026-09-16');
});

test('a locked CEO section withholds money series and the Whop product table', () => {
  const today = '2026-09-30';
  const { datasets, targets } = demoDatasets(today);
  const locked = buildDashboard({ today, tz: 'UTC', datasets, availability: {}, targets, ceoUnlocked: false });
  assert.equal('cash_collected' in locked.series, false);
  assert.equal('profit_business' in locked.series, false);
  assert.ok(Array.isArray(locked.series.leads_billed));
  assert.equal(locked.tables.whopProducts, null);
  const open = buildDashboard({ today, tz: 'UTC', datasets, availability: {}, targets, ceoUnlocked: true });
  assert.ok(Array.isArray(open.series.cash_collected));
  assert.ok(Array.isArray(open.tables.whopProducts));
});

test('an infinite pace is reported as a flag with the right status', () => {
  const r = paceFor({ cumulative: true, dir: 'lower' }, 0, 500, 0.5);
  assert.equal(r.pace, null);
  assert.equal(r.paceInfinite, true);
  assert.equal(r.status, 'well_ahead');
});

test('an unconfigured campaign client still joins to the Airtable client of the same name', () => {
  const ds = {
    ads: { rows: [{ date: '2026-09-29', campaign: '(New) Someone LLC - Tree Service', campaignId: 'z', line: 'hs_b2c', client: '(New) Someone LLC', spend: 10, clicks: 1, impressions: 10, fbLeads: 0 }] },
    hsLeads: { rows: [{ date: '2026-09-29', client: 'Someone LLC', kind: 'billed', price: 50 }] },
    retainers,
  };
  const act = clientActivity(ds, R('2026-09-29', '2026-09-29'));
  const someone = [...act.values()].filter(c => c.key === 'someone llc');
  assert.equal(someone.length, 1);
  const c = someone[0];
  assert.equal(c.spend, 10);
  assert.equal(c.leads, 1);
  assert.equal(c.unmapped, true);
});
