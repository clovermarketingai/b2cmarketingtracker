// Daily per-client P&L for the /daily page. Pure.
//
// One row per (date, client). A client with several campaigns on one day is
// ONE row: spend/clicks/impressions are summed across its campaigns and its
// leads are counted once (the old page emitted one row per campaign and
// therefore counted the same day's leads once per campaign).
//
// Revenue = Σ Lead Cost of billed leads that day + retainer ÷ 7 for retainer
// clients. The rate card in lib/clients.js is used only for display names and
// to flag leads whose Lead Cost disagrees with the card.

import { clientResolver, div } from './compute.js';
import { CLIENTS } from '../clients.js';

const pct = (x) => (x == null ? null : x * 100);
const nextDay = (iso) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const r2 = (n) => Math.round(n * 100) / 100;

function rateFor(cfg) {
  if (!cfg || !cfg.rule) return null;
  if (cfg.rule.type === 'perLead') return Number(cfg.rule.rate) || null;
  return null; // weekly (retainer) and tiered carry no single per-lead rate
}

/**
 * @param {object} p
 * @param {{rows:Array}} p.ads        Windsor rows (line hs_b2c only are used)
 * @param {{rows:Array}} p.hsLeads    Airtable lead rows
 * @param {Array} p.retainers         retainersFromConfig()
 * @param {object} [p.clients]        CLIENTS map (for short names / rate reconciliation)
 * @param {string} [p.clientFilter]   resolved client key to keep, or null for all
 */
export function buildDaily({ ads, hsLeads, retainers, clients = CLIENTS, clientFilter = null, today = null }) {
  const res = clientResolver(retainers);
  const configByAirtable = new Map(Object.entries(clients).map(([k, c]) => [String(c.airtable || k).trim().toLowerCase(), { key: k, ...c }]));
  const cells = new Map(); // `${date}|${clientKey}` -> row
  const get = (date, entry) => {
    const id = `${date}|${entry.key}`;
    let row = cells.get(id);
    if (!row) {
      row = {
        date, client: entry.key, name: entry.short, airtable: entry.airtable, windsor: entry.windsor, unmapped: !!entry.unmapped,
        campaigns: 0, spend: 0, clicks: 0, impressions: 0, fbLeads: 0,
        leads: 0, billed: 0, free: 0, replacement: 0, prepay: 0, unbilled: 0,
        revenue: 0, leadRevenue: 0, retainer: 0,
      };
      cells.set(id, row);
    }
    return row;
  };

  for (const a of ads?.rows || []) {
    if (a.line !== 'hs_b2c') continue;
    const entry = res.fromAds(a.client || a.campaign);
    const row = get(a.date, entry);
    row.campaigns++;
    row.spend += Number(a.spend) || 0;
    row.clicks += Number(a.clicks) || 0;
    row.impressions += Number(a.impressions) || 0;
    row.fbLeads += Number(a.fbLeads) || 0;
  }

  const mismatches = new Map(); // `${client}|${price}` -> count
  for (const l of hsLeads?.rows || []) {
    const entry = res.fromLeads(l.client);
    const row = get(l.date, entry);
    row.leads++;
    const kind = l.kind === 'billed' || l.kind === 'free' || l.kind === 'replacement' || l.kind === 'prepay' ? l.kind : 'unbilled';
    row[kind]++;
    if (kind === 'billed') {
      const price = Number(l.price) || 0;
      row.leadRevenue += price;
      row.revenue += price;
      const cfg = configByAirtable.get(String(entry.airtable || l.client).trim().toLowerCase());
      const rate = rateFor(cfg);
      if (rate != null && price > 0 && Math.abs(price - rate) > 0.005) {
        const k = `${entry.short}|${price}`;
        mismatches.set(k, (mismatches.get(k) || 0) + 1);
      }
    }
  }

  // Retainer: perWeek ÷ 7 on EVERY calendar day the retainer is live, whether
  // or not ads delivered or leads arrived that day. Live = from the rule's
  // `from` date (lib/clients.js) or, failing that, the client's first day with
  // any activity, through `to` or today.
  const lastDate = today || [...cells.keys()].reduce((m, k) => (k.slice(0, 10) > m ? k.slice(0, 10) : m), '');
  for (const ret of retainers || []) {
    if (ret.paused || !(Number(ret.perWeek) > 0)) continue;
    const entry = res.fromLeads(ret.airtable || ret.client);
    const perDay = Number(ret.perWeek) / 7;
    const own = [...cells.values()].filter(r => r.client === entry.key).map(r => r.date).sort();
    const start = ret.from || own[0];
    if (!start) continue;
    const end = ret.to && ret.to < lastDate ? ret.to : lastDate;
    for (let d = start; d <= end; d = nextDay(d)) {
      const row = get(d, entry);
      row.retainer = perDay;
      row.revenue += perDay;
    }
  }

  let rows = [...cells.values()];
  if (clientFilter) rows = rows.filter(r => r.client === clientFilter);

  rows = rows.map(r => {
    const profit = r.revenue - r.spend;
    return {
      ...r,
      spend: r2(r.spend), revenue: r2(r.revenue), leadRevenue: r2(r.leadRevenue), retainer: r2(r.retainer),
      cpl: div(r.spend, r.billed),
      cplAll: div(r.spend, r.leads),
      profit: r2(profit),
      margin: pct(div(profit, r.revenue)),
      cpc: div(r.spend, r.clicks),
      ctr: pct(div(r.clicks, r.impressions)),
      cpm: r.impressions ? (r.spend / r.impressions) * 1000 : null,
      cvr: pct(div(r.billed, r.clicks)),
    };
  }).sort((a, b) => (a.date !== b.date ? b.date.localeCompare(a.date) : a.name.localeCompare(b.name)));

  const t = rows.reduce((acc, r) => {
    for (const k of ['spend', 'clicks', 'impressions', 'fbLeads', 'leads', 'billed', 'free', 'replacement', 'prepay', 'unbilled', 'revenue', 'leadRevenue', 'retainer']) acc[k] += r[k];
    return acc;
  }, { spend: 0, clicks: 0, impressions: 0, fbLeads: 0, leads: 0, billed: 0, free: 0, replacement: 0, prepay: 0, unbilled: 0, revenue: 0, leadRevenue: 0, retainer: 0 });
  const totals = {
    ...t,
    spend: r2(t.spend), revenue: r2(t.revenue),
    cpl: div(t.spend, t.billed), cplAll: div(t.spend, t.leads),
    profit: r2(t.revenue - t.spend), margin: pct(div(t.revenue - t.spend, t.revenue)),
    cpc: div(t.spend, t.clicks), ctr: pct(div(t.clicks, t.impressions)),
    cpm: t.impressions ? (t.spend / t.impressions) * 1000 : null, cvr: pct(div(t.billed, t.clicks)),
    days: new Set(rows.map(r => r.date)).size,
    clients: new Set(rows.map(r => r.client)).size,
  };

  const clientOptions = [...new Map([...cells.values()].map(r => [r.client, { key: r.client, name: r.name, unmapped: r.unmapped }])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));

  const warnings = [];
  const unmappedAds = clientOptions.filter(c => c.unmapped);
  if (unmappedAds.length) warnings.push(`${unmappedAds.length} client name${unmappedAds.length > 1 ? 's are' : ' is'} not in lib/clients.js, so ads and leads may not join: ${unmappedAds.map(c => c.name).join(', ')}`);
  for (const [k, n] of mismatches) {
    const [name, price] = k.split('|');
    warnings.push(`${n} ${name} lead${n > 1 ? 's' : ''} billed at $${price}, which differs from the rate card.`);
  }

  return { rows, totals, clientOptions, warnings };
}
