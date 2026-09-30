// Deterministic demo datasets so the dashboard can be developed, screenshotted
// and smoke-tested without any credentials (GET /api/metrics?demo=1).
// Numbers are synthetic. Shapes are exactly what the live connectors return.

import { addDays, eachDay, monthStart, daysBetween } from './dates.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export const DEMO_CLIENTS = [
  { client: '(Nico) PROS Tree & Landscape', short: 'Nico PROS', airtable: 'PROS Tree & Landscape (Phoenix)', perWeek: 1000, paused: false },
  { client: '(Ed) Protree Services LLC', short: 'Ed Protree', airtable: 'Protree Services LLC', perWeek: 0, paused: false, price: 85 },
  { client: '(Leonardo) HLI Tree Experts', short: 'Leonardo HLI', airtable: 'HLI Tree Experts', perWeek: 0, paused: false, price: 80 },
  { client: '(Chris) Five Star Tree Service Long Island', short: 'Chris Five Star', airtable: 'Five Star Tree Service Long Island', perWeek: 0, paused: false, price: 75 },
  { client: '(Mario) Arborcare Group', short: 'Mario Arborcare', airtable: 'Arborcare group', perWeek: 0, paused: false, price: 65 },
  { client: '(Edgar) Vema Tree Service', short: 'Edgar Vema', airtable: 'Vema Tree Service', perWeek: 0, paused: false, price: 90 },
  { client: '(Cesar) Cesar Tree Service Inc', short: 'Cesar', airtable: 'Cesar Tree Service Inc', perWeek: 0, paused: true, price: 0 },
];

export function demoDatasets(today) {
  const r = rng(20260930);
  const from = addDays(monthStart(addDays(monthStart(today), -1)), -10);
  const days = eachDay(from, today);

  const ads = { rows: [] };
  const hsLeads = { rows: [] };
  const whop = { rows: [] };
  const closerEod = { rows: [] };
  const prospects = { rows: [] };
  const b2b = { rows: [] };
  const costs = { rows: [] };
  const clients = { rows: DEMO_CLIENTS.map((c, i) => ({ name: c.airtable, createdDate: addDays(from, -200 + i * 40) })) };

  const closers = ['Tyler', 'Jeshua'];
  const products = ['Tree Service Leads', 'Tax Leads Batch', 'Setup fee'];

  for (const d of days) {
    const dow = new Date(d + 'T00:00:00Z').getUTCDay();
    for (const c of DEMO_CLIENTS) {
      if (c.paused) continue;
      const spend = 40 + r() * 90;
      const impressions = Math.round(spend * (30 + r() * 20));
      const clicks = Math.round(impressions * (0.015 + r() * 0.02));
      const fbLeads = Math.round(clicks * (0.10 + r() * 0.12));
      ads.rows.push({ date: d, campaign: `${c.client} - Tree Service Leads`, campaignId: `c_${c.short.replace(/\W+/g, '')}`, line: 'hs_b2c', client: c.client, spend: +spend.toFixed(2), clicks, impressions, fbLeads });
      const leadsToday = Math.max(0, Math.round(fbLeads * (0.7 + r() * 0.5)) - (r() < 0.08 ? 3 : 0));
      for (let i = 0; i < leadsToday; i++) {
        const roll = r();
        let kind = 'billed', price = c.price;
        if (c.perWeek) { kind = 'billed'; price = 0; }
        else if (roll < 0.07) { kind = 'replacement'; price = 0; }
        else if (roll < 0.10) { kind = 'free'; price = 0; }
        else if (roll < 0.12) { kind = 'unbilled'; price = 0; }
        hsLeads.rows.push({ date: d, client: c.airtable, kind, price });
      }
    }
    // Client-acquisition and tax campaigns
    const acq = 60 + r() * 60;
    ads.rows.push({ date: d, campaign: 'B2B Home Service - Owners', campaignId: 'c_hsb2b', line: 'hs_b2b', client: null, spend: +acq.toFixed(2), clicks: Math.round(acq * 1.1), impressions: Math.round(acq * 45), fbLeads: Math.round(1 + r() * 3) });
    const tax = 150 + r() * 120;
    ads.rows.push({ date: d, campaign: 'B2B Tax - Firms - Lead Form', campaignId: 'c_taxb2b', line: 'tax_b2b', client: null, spend: +tax.toFixed(2), clicks: Math.round(tax * 0.9), impressions: Math.round(tax * 40), fbLeads: Math.round(1 + r() * 4) });
    if (r() < 0.15) ads.rows.push({ date: d, campaign: 'Retargeting - Site visitors', campaignId: 'c_other', line: 'other', client: null, spend: +(5 + r() * 10).toFixed(2), clicks: 10, impressions: 800, fbLeads: 0 });

    // Tax CRM leads, cohorted to created date
    const taxLeads = Math.round(1 + r() * 4);
    for (let i = 0; i < taxLeads; i++) {
      const booked = r() < 0.55, showed = booked && r() < 0.7, closed = showed && r() < 0.25;
      b2b.rows.push({ date: d, booked, showed, closed, upfrontCash: closed ? 2500 + Math.round(r() * 3) * 500 : 0 });
    }

    // Closers (no Sundays)
    if (dow !== 0) {
      for (const closer of closers) {
        const attempted = Math.round(25 + r() * 30);
        const connected = Math.round(attempted * (0.25 + r() * 0.2));
        const offers = Math.round(connected * (0.3 + r() * 0.3));
        const closes = r() < 0.6 ? Math.round(offers * (0.15 + r() * 0.25)) : 0;
        closerEod.rows.push({ date: d, closer, attempted, connected, offers, closes, energy: 6 + Math.round(r() * 4), focus: 6 + Math.round(r() * 4) });
        const newProspects = Math.round(2 + r() * 5);
        for (let i = 0; i < newProspects; i++) {
          const contacted = r() < 0.8;
          const booked = contacted && r() < 0.45;
          prospects.rows.push({ date: d, closer, status: booked ? 'Booked' : contacted ? 'Contacted' : 'Follow Up', contacted, booked, appointmentDate: booked ? addDays(d, Math.round(r() * 3)) : null, speedToLead: contacted ? Math.round(60 + r() * 3000) : null });
        }
      }
    }

    // Whop cash: client top-ups and tax batches
    const payments = Math.round(r() * 3 + (dow === 1 ? 2 : 0));
    for (let i = 0; i < payments; i++) {
      const product = products[Math.floor(r() * products.length)];
      const gross = product === 'Tax Leads Batch' ? 2500 + Math.round(r() * 3) * 500 : product === 'Setup fee' ? 500 : 300 + Math.round(r() * 8) * 50;
      const fees = +(gross * 0.029 + 0.3).toFixed(2);
      const refunded = r() < 0.03 ? gross : 0;
      whop.rows.push({ date: d, gross, net: +(gross - fees).toFixed(2), fees, refunded, product, status: refunded ? 'refunded' : 'paid' });
    }
  }

  // Monthly recurring costs and one-offs
  for (const m of new Set(days.map(d => d.slice(0, 7)))) {
    costs.rows.push({ date: m + '-01', category: 'Payroll', amount: 14000, period: 'monthly', note: 'Closers + VA' });
    costs.rows.push({ date: m + '-01', category: 'Software', amount: 1250, period: 'monthly', note: 'Airtable, Windsor, GHL, Slack' });
    costs.rows.push({ date: m + '-01', category: 'Messaging', amount: 900, period: 'monthly', note: 'SMS + dialer' });
    costs.rows.push({ date: m + '-01', category: 'Personal projects', amount: 1500, period: 'monthly', note: '' });
    costs.rows.push({ date: m + '-15', category: 'Affiliates', amount: 1200, period: 'once', note: 'Referral payout' });
  }

  const retainers = DEMO_CLIENTS.map(c => ({ client: c.client, airtable: c.airtable, short: c.short, perWeek: c.perWeek, paused: c.paused }));

  const targets = {
    cash_collected: { [today.slice(0, 7)]: 60000 },
    profit_all: { [today.slice(0, 7)]: 15000 },
    leads_billed: { [today.slice(0, 7)]: 900 },
    cpl_billed: { [today.slice(0, 7)]: 45 },
    closes: { [today.slice(0, 7)]: 12 },
    close_rate: { [today.slice(0, 7)]: 20 },
    calls_connected: { [today.slice(0, 7)]: 700 },
    clients_active: { [today.slice(0, 7)]: 8 },
    tax_spend: { [today.slice(0, 7)]: 7000 },
    b2b_closes: { [today.slice(0, 7)]: 8 },
  };

  return { datasets: { ads, hsLeads, clients, retainers, whop, costs, closerEod, prospects, b2b }, targets, span: { from, to: today, days: daysBetween(from, today) } };
}
