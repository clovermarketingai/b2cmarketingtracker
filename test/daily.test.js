import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDaily } from '../lib/dashboard/daily.js';

const retainers = [
  { client: '(Nico) PROS Tree & Landscape', airtable: 'PROS Tree & Landscape (Phoenix)', short: 'Nico PROS', perWeek: 700, paused: false },
  { client: '(Ed) Protree Services LLC', airtable: 'Protree Services LLC', short: 'Ed Protree', perWeek: 0, paused: false },
];
const clients = {
  '(Nico) PROS Tree & Landscape': { short: 'Nico PROS', airtable: 'PROS Tree & Landscape (Phoenix)', rule: { type: 'weekly', perWeek: 700 } },
  '(Ed) Protree Services LLC': { short: 'Ed Protree', airtable: 'Protree Services LLC', rule: { type: 'perLead', rate: 85 } },
};
const ads = { rows: [
  { date: '2026-09-29', campaign: '(Ed) Protree Services LLC - A', campaignId: 'a', line: 'hs_b2c', client: '(Ed) Protree Services LLC', spend: 100, clicks: 50, impressions: 5000, fbLeads: 4 },
  { date: '2026-09-29', campaign: '(Ed) Protree Services LLC - B', campaignId: 'b', line: 'hs_b2c', client: '(Ed) Protree Services LLC', spend: 50, clicks: 25, impressions: 2500, fbLeads: 1 },
  { date: '2026-09-29', campaign: '(Nico) PROS Tree & Landscape - X', campaignId: 'c', line: 'hs_b2c', client: '(Nico) PROS Tree & Landscape', spend: 30, clicks: 10, impressions: 1000, fbLeads: 2 },
  { date: '2026-09-29', campaign: 'B2B Tax', campaignId: 'e', line: 'tax_b2b', client: null, spend: 200, clicks: 100, impressions: 8000, fbLeads: 5 },
] };
const hsLeads = { rows: [
  { date: '2026-09-29', client: 'Protree Services LLC', kind: 'billed', price: 85 },
  { date: '2026-09-29', client: 'Protree Services LLC', kind: 'billed', price: 75 },
  { date: '2026-09-29', client: 'Protree Services LLC', kind: 'replacement', price: 0 },
  { date: '2026-09-29', client: 'PROS Tree & Landscape (Phoenix)', kind: 'billed', price: 0 },
  { date: '2026-09-28', client: 'Protree Services LLC', kind: 'billed', price: 85 },
] };

test('one row per (date, client); leads counted once across campaigns', () => {
  const d = buildDaily({ ads, hsLeads, retainers, clients });
  assert.equal(d.rows.length, 3);
  const ed = d.rows.find(r => r.date === '2026-09-29' && r.name === 'Ed Protree');
  assert.equal(ed.campaigns, 2);
  assert.equal(ed.spend, 150);
  assert.equal(ed.leads, 3);
  assert.equal(ed.billed, 2);
  assert.equal(ed.replacement, 1);
  assert.equal(ed.revenue, 160);
  assert.equal(ed.cpl, 75);
  assert.equal(ed.profit, 10);
  const nico = d.rows.find(r => r.name === 'Nico PROS');
  assert.equal(nico.retainer, 100);
  assert.equal(nico.revenue, 100);
  assert.equal(nico.billed, 1);
  assert.equal(d.totals.spend, 180);           // B2B Tax campaign excluded
  assert.equal(d.totals.revenue, 345);
  assert.equal(d.totals.days, 2);
  assert.equal(d.totals.clients, 2);
  assert.equal(d.totals.cpl, 180 / 4);
});

test('rate-card mismatches and unmapped names are reported', () => {
  const d = buildDaily({ ads, hsLeads, retainers, clients });
  assert.ok(d.warnings.some(w => w.includes('Ed Protree') && w.includes('$75')));
  const d2 = buildDaily({ ads: { rows: [{ date: '2026-09-29', campaign: '(New) Someone', campaignId: 'z', line: 'hs_b2c', client: '(New) Someone', spend: 10, clicks: 1, impressions: 10, fbLeads: 0 }] }, hsLeads: { rows: [] }, retainers, clients });
  assert.ok(d2.warnings.some(w => w.includes('not in lib/clients.js')));
  assert.equal(d2.rows[0].unmapped, true);
});

test('client filter keeps only that client', () => {
  const d = buildDaily({ ads, hsLeads, retainers, clients, clientFilter: 'pros tree & landscape (phoenix)' });
  assert.equal(d.rows.length, 1);
  assert.equal(d.rows[0].name, 'Nico PROS');
});
