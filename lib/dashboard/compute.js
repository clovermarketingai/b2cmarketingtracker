// Command Center aggregation engine. Pure: no I/O, no clock. Takes the
// normalised datasets produced by lib/dashboard/sources/* and returns exactly
// what the UI and the /api/v1 endpoints serve.
//
// Dataset shapes (every date is a 'YYYY-MM-DD' LOCAL calendar date, see dates.js):
//   ads.rows        [{ date, campaign, campaignId, line, client, spend, clicks, impressions, fbLeads }]
//                   line ∈ hs_b2c | hs_b2b | tax_b2b | other; client = Windsor client key for hs_b2c
//   hsLeads.rows    [{ date, client, kind, price }]  kind ∈ billed|free|replacement|prepay|unbilled|unknown
//   clients.rows    [{ name, createdDate }]
//   retainers       [{ client, airtable, short, perWeek, paused }]   (from lib/clients.js)
//   whop.rows       [{ date, gross, net, fees, refunded, product, status }]
//   costs.rows      [{ date, category, amount, period }]   period ∈ once | monthly
//   closerEod.rows  [{ date, closer, attempted, connected, offers, closes }]
//   prospects.rows  [{ date, closer, status, contacted, booked, appointmentDate, speedToLead }]
//   b2b.rows        [{ date, booked, showed, closed, upfrontCash }]  (one per CRM lead)
//   targets         { [rowId]: { [YYYY-MM]: number } }
//
// Every rate is computed from SUMS over the range, never as an average of
// daily rates. Division by zero yields null ("not computable"), never 0.

import {
  SECTIONS, COST_CATEGORIES, BUSINESS_COST_ROWS, OWNER_COST_ROWS, statusForPace, STATUS,
} from './catalog.js';
import {
  standardRanges, previousRange, weeksOfMonth, daysBetween, addDays, monthKey,
  daysInMonth, monthElapsedFraction, eachDay, RANGE_LABEL,
} from './dates.js';

const num = (v) => (v == null || v === '' ? 0 : Number(v) || 0);
const inRange = (d, r) => d != null && d >= r.from && d <= r.to;
export const div = (a, b) => (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) || b === 0) ? null : a / b;
const pct = (x) => (x == null ? null : x * 100);
const norm = (s) => String(s ?? '').trim().toLowerCase();

/* ---------------------------------------------------------------------------
 * Per-dataset aggregation over one range
 * ------------------------------------------------------------------------ */

const zeroAds = () => ({ spend: 0, clicks: 0, impressions: 0, fbLeads: 0, rows: 0 });

export function adsAgg(ads, r) {
  const t = { hs_b2c: zeroAds(), hs_b2b: zeroAds(), tax_b2b: zeroAds(), other: zeroAds(), all: zeroAds() };
  const byClient = new Map();   // hs_b2c spend per Windsor client key
  const byCampaign = new Map();
  if (!ads) return { ...t, byClient, byCampaign };
  for (const row of ads.rows || []) {
    if (!inRange(row.date, r)) continue;
    const line = t[row.line] ? row.line : 'other';
    for (const b of [t[line], t.all]) {
      b.spend += num(row.spend); b.clicks += num(row.clicks);
      b.impressions += num(row.impressions); b.fbLeads += num(row.fbLeads); b.rows++;
    }
    if (line === 'hs_b2c' && row.client) {
      const c = byClient.get(row.client) || zeroAds();
      c.spend += num(row.spend); c.clicks += num(row.clicks); c.impressions += num(row.impressions); c.fbLeads += num(row.fbLeads); c.rows++;
      byClient.set(row.client, c);
    }
    const ck = row.campaignId || row.campaign;
    const cc = byCampaign.get(ck) || { ...zeroAds(), campaign: row.campaign, campaignId: row.campaignId, line, client: row.client || null };
    cc.spend += num(row.spend); cc.clicks += num(row.clicks); cc.impressions += num(row.impressions); cc.fbLeads += num(row.fbLeads); cc.rows++;
    byCampaign.set(ck, cc);
  }
  return { ...t, byClient, byCampaign };
}

const zeroLeads = () => ({ total: 0, billed: 0, free: 0, replacement: 0, prepay: 0, unbilled: 0, unknown: 0, billedValue: 0, pricedBilled: 0 });

export function leadsAgg(hsLeads, r) {
  const t = zeroLeads();
  const byClient = new Map();
  if (!hsLeads) return { ...t, byClient };
  for (const row of hsLeads.rows || []) {
    if (!inRange(row.date, r)) continue;
    const kind = t[row.kind] != null && row.kind !== 'total' ? row.kind : 'unknown';
    const c = byClient.get(row.client) || zeroLeads();
    for (const b of [t, c]) {
      b.total++;
      b[kind]++;
      if (kind === 'billed') {
        const p = num(row.price);
        b.billedValue += p;
        if (p > 0) b.pricedBilled++;
      }
    }
    byClient.set(row.client, c);
  }
  return { ...t, byClient };
}

/** Retainer revenue inside a range: perWeek ÷ 7 for every day the retainer is live. */
export function retainerRevenue(retainers, r) {
  let total = 0;
  const byClient = new Map();
  for (const ret of retainers || []) {
    if (ret.paused || !(num(ret.perWeek) > 0)) continue;
    const from = ret.from && ret.from > r.from ? ret.from : r.from;
    const to = ret.to && ret.to < r.to ? ret.to : r.to;
    if (from > to) continue;
    const amount = (num(ret.perWeek) / 7) * daysBetween(from, to);
    total += amount;
    byClient.set(ret.airtable || ret.client, (byClient.get(ret.airtable || ret.client) || 0) + amount);
  }
  return { total, byClient };
}

export function whopAgg(whop, r) {
  const t = { gross: 0, net: 0, fees: 0, feesKnown: false, feesMissing: 0, refunded: 0, count: 0 };
  const byProduct = new Map();
  if (!whop) return { ...t, byProduct };
  for (const row of whop.rows || []) {
    if (!inRange(row.date, r)) continue;
    t.count++;
    t.gross += num(row.gross);
    t.refunded += num(row.refunded);
    if (row.fees != null && Number.isFinite(Number(row.fees))) { t.fees += Number(row.fees); t.feesKnown = true; }
    else t.feesMissing++;
    t.net += row.net != null ? num(row.net) : num(row.gross);
    const key = row.product || '(no product)';
    const p = byProduct.get(key) || { product: key, gross: 0, refunded: 0, count: 0 };
    p.gross += num(row.gross); p.refunded += num(row.refunded); p.count++;
    byProduct.set(key, p);
  }
  return { ...t, byProduct };
}

/** Costs by CEO row id. Monthly rows are prorated: amount ÷ days in that month, per day inside the range. */
export function costsAgg(costs, r) {
  const t = {};
  for (const id of Object.values(COST_CATEGORIES)) t[id] = 0;
  t.uncategorised = 0;
  if (!costs) return t;
  for (const row of costs.rows || []) {
    const id = COST_CATEGORIES[row.category] || COST_CATEGORIES[Object.keys(COST_CATEGORIES).find(k => norm(k) === norm(row.category))] || 'uncategorised';
    const amount = num(row.amount);
    if (!row.date) continue;
    if (row.period === 'monthly') {
      const mStart = row.date.slice(0, 7) + '-01';
      const dim = daysInMonth(row.date);
      const mEnd = row.date.slice(0, 7) + '-' + String(dim).padStart(2, '0');
      const from = mStart > r.from ? mStart : r.from;
      const to = mEnd < r.to ? mEnd : r.to;
      if (from > to) continue;
      t[id] += (amount / dim) * daysBetween(from, to);
    } else if (inRange(row.date, r)) {
      t[id] += amount;
    }
  }
  return t;
}

export function eodAgg(closerEod, r) {
  const t = { attempted: 0, connected: 0, offers: 0, closes: 0, count: 0 };
  const byCloser = new Map();
  if (!closerEod) return { ...t, byCloser };
  for (const row of closerEod.rows || []) {
    if (!inRange(row.date, r)) continue;
    const c = byCloser.get(row.closer) || { attempted: 0, connected: 0, offers: 0, closes: 0, count: 0 };
    for (const b of [t, c]) {
      b.attempted += num(row.attempted); b.connected += num(row.connected);
      b.offers += num(row.offers); b.closes += num(row.closes); b.count++;
    }
    byCloser.set(row.closer, c);
  }
  return { ...t, byCloser };
}

export function prospectsAgg(prospects, r) {
  const t = { created: 0, contacted: 0, bookedEver: 0, bookedInRange: 0, speedSum: 0, speedCount: 0 };
  const byCloser = new Map();
  if (!prospects) return { ...t, byCloser };
  const bucket = (closer) => {
    const c = byCloser.get(closer) || { created: 0, contacted: 0, bookedEver: 0, bookedInRange: 0, speedSum: 0, speedCount: 0 };
    byCloser.set(closer, c);
    return c;
  };
  for (const row of prospects.rows || []) {
    const c = bucket(row.closer || '(unassigned)');
    if (inRange(row.date, r)) {
      for (const b of [t, c]) {
        b.created++;
        if (row.contacted) b.contacted++;
        if (row.booked) b.bookedEver++;
        if (row.speedToLead != null && Number.isFinite(Number(row.speedToLead))) { b.speedSum += Number(row.speedToLead); b.speedCount++; }
      }
    }
    if (inRange(row.appointmentDate, r)) { t.bookedInRange++; c.bookedInRange++; }
  }
  return { ...t, byCloser };
}

export function b2bAgg(b2b, r) {
  const t = { leads: 0, booked: 0, showed: 0, closed: 0, cash: 0 };
  if (!b2b) return t;
  for (const row of b2b.rows || []) {
    if (!inRange(row.date, r)) continue;
    t.leads++;
    if (row.booked) t.booked++;
    if (row.showed) t.showed++;
    if (row.closed) { t.closed++; t.cash += num(row.upfrontCash); }
  }
  return t;
}

function clientsNewCount(clients, r) {
  if (!clients) return 0;
  let n = 0;
  for (const c of clients.rows || []) if (inRange(c.createdDate, r)) n++;
  return n;
}

/* ---------------------------------------------------------------------------
 * Client identity: ads rows carry the Windsor key "(Owner) Business", Airtable
 * leads carry the Clients-table name. lib/clients.js maps one to the other.
 * ------------------------------------------------------------------------ */

export function clientResolver(retainersOrConfig) {
  const byWindsor = new Map();
  const byAirtable = new Map();
  for (const c of retainersOrConfig || []) {
    const key = norm(c.airtable || c.client);
    const entry = { key, short: c.short || c.airtable || c.client, airtable: c.airtable || c.client, windsor: c.client, paused: !!c.paused };
    if (c.client) byWindsor.set(norm(c.client), entry);
    if (c.airtable) byAirtable.set(norm(c.airtable), entry);
  }
  return {
    fromAds: (windsorClient) => byWindsor.get(norm(windsorClient)) || { key: norm(windsorClient), short: windsorClient, airtable: null, windsor: windsorClient, paused: false, unmapped: true },
    fromLeads: (airtableName) => byAirtable.get(norm(airtableName)) || { key: norm(airtableName), short: airtableName, airtable: airtableName, windsor: null, paused: false, unmapped: true },
  };
}

/** Per-client activity for a range: spend, leads and lead kinds keyed by resolved client key. */
export function clientActivity(datasets, r) {
  const res = clientResolver(datasets.retainers);
  const out = new Map();
  const get = (entry) => {
    let c = out.get(entry.key);
    if (!c) {
      c = { key: entry.key, name: entry.short, airtable: entry.airtable, windsor: entry.windsor, paused: entry.paused, unmapped: !!entry.unmapped,
        spend: 0, clicks: 0, impressions: 0, fbLeads: 0, leads: 0, billed: 0, free: 0, replacement: 0, prepay: 0, unbilled: 0, unknown: 0, billedValue: 0, retainer: 0, lastLeadDate: null };
      out.set(entry.key, c);
    }
    return c;
  };
  const a = adsAgg(datasets.ads, r);
  for (const [windsorClient, v] of a.byClient) {
    const c = get(res.fromAds(windsorClient));
    c.spend += v.spend; c.clicks += v.clicks; c.impressions += v.impressions; c.fbLeads += v.fbLeads;
    if (!c.windsor) c.windsor = windsorClient;
  }
  const l = leadsAgg(datasets.hsLeads, r);
  for (const [airtableName, v] of l.byClient) {
    const c = get(res.fromLeads(airtableName));
    c.leads += v.total; c.billed += v.billed; c.free += v.free; c.replacement += v.replacement;
    c.prepay += v.prepay; c.unbilled += v.unbilled; c.unknown += v.unknown; c.billedValue += v.billedValue;
    if (!c.airtable) c.airtable = airtableName;
  }
  const ret = retainerRevenue(datasets.retainers, r);
  for (const [airtableName, amount] of ret.byClient) {
    const c = get(res.fromLeads(airtableName));
    c.retainer += amount;
    c.billedValue += amount;
  }
  // Last lead date per client (whole dataset, not just range) so "days since last lead" is honest.
  for (const row of datasets.hsLeads?.rows || []) {
    const e = res.fromLeads(row.client);
    const c = out.get(e.key);
    if (c && (!c.lastLeadDate || row.date > c.lastLeadDate)) c.lastLeadDate = row.date;
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Every catalog row for one range
 * ------------------------------------------------------------------------ */

export function sectionValues(datasets, r) {
  const ads = adsAgg(datasets.ads, r);
  const leads = leadsAgg(datasets.hsLeads, r);
  const ret = retainerRevenue(datasets.retainers, r);
  const whop = whopAgg(datasets.whop, r);
  const costs = costsAgg(datasets.costs, r);
  const eod = eodAgg(datasets.closerEod, r);
  const pros = prospectsAgg(datasets.prospects, r);
  const b2b = b2bAgg(datasets.b2b, r);
  const days = daysBetween(r.from, r.to);

  const v = {};

  // ---- CEO ----
  v.cash_collected = whop.gross;
  v.refunds = whop.refunded;
  v.processor_fees = whop.feesKnown ? whop.fees : null;
  v.hs_b2c_ads = ads.hs_b2c.spend;
  v.hs_b2b_ads = ads.hs_b2b.spend;
  v.tax_b2b_ads = ads.tax_b2b.spend;
  v.other_ads = ads.other.spend;
  v.ad_spend_total = ads.all.spend;
  for (const id of Object.values(COST_CATEGORIES)) v[id] = costs[id];
  v.uncategorised_costs = costs.uncategorised;
  const businessCosts = v.ad_spend_total + BUSINESS_COST_ROWS.reduce((s, id) => s + (v[id] || 0), 0) + v.uncategorised_costs;
  const ownerCosts = OWNER_COST_ROWS.reduce((s, id) => s + (v[id] || 0), 0);
  v.business_costs = businessCosts;
  v.tracked_costs = businessCosts + ownerCosts;
  v.profit_business = v.cash_collected - v.refunds - businessCosts;
  v.profit_all = v.profit_business - ownerCosts;
  v.hs_billed_value = leads.billedValue + ret.total;

  // ---- Home Service delivery ----
  v.hs_spend = ads.hs_b2c.spend;
  v.hs_profit = v.hs_billed_value - v.hs_spend;
  v.hs_margin = pct(div(v.hs_profit, v.hs_billed_value));
  v.leads_sent = leads.total;
  v.leads_billed = leads.billed;
  v.cpl_billed = div(v.hs_spend, leads.billed);
  v.cpl_all = div(v.hs_spend, leads.total);
  v.leads_replacement = leads.replacement;
  v.leads_free = leads.free;
  v.leads_prepay = leads.prepay;
  v.leads_unbilled = leads.unbilled + leads.unknown;
  v.replacement_rate = pct(div(leads.replacement, leads.billed + leads.replacement));
  v.fb_leads = ads.hs_b2c.fbLeads;
  v.clicks = ads.hs_b2c.clicks;
  v.impressions = ads.hs_b2c.impressions;
  v.ctr = pct(div(ads.hs_b2c.clicks, ads.hs_b2c.impressions));
  v.cpc = div(ads.hs_b2c.spend, ads.hs_b2c.clicks);
  v.cpm = ads.hs_b2c.impressions ? (ads.hs_b2c.spend / ads.hs_b2c.impressions) * 1000 : null;
  v.cvr = pct(div(leads.billed, ads.hs_b2c.clicks));

  // ---- Sales ----
  v.closes = eod.closes;
  v.close_rate = pct(div(eod.closes, eod.offers));
  v.calls_attempted = eod.attempted;
  v.calls_connected = eod.connected;
  v.contact_rate = pct(div(eod.connected, eod.attempted));
  v.offers = eod.offers;
  v.offer_rate = pct(div(eod.offers, eod.connected));
  v.new_prospects = pros.created;
  v.booked_calls = pros.bookedInRange;
  v.book_rate = pct(div(pros.bookedEver, pros.created));
  v.prospect_contact_rate = pct(div(pros.contacted, pros.created));
  v.speed_to_lead = div(pros.speedSum, pros.speedCount);
  v.hs_b2b_spend = ads.hs_b2b.spend;
  v.hs_b2b_leads = ads.hs_b2b.fbLeads;
  v.hs_b2b_cpl = div(ads.hs_b2b.spend, ads.hs_b2b.fbLeads);
  v.cost_per_close = div(ads.hs_b2b.spend, eod.closes);
  v.eods_submitted = eod.count;

  // ---- CSM ----
  const activity = clientActivity(datasets, r);
  const active = [...activity.values()].filter(c => c.spend > 0 || c.leads > 0);
  v.clients_active = active.length;
  v.clients_new = clientsNewCount(datasets.clients, r);
  const last3 = { from: addDays(r.to, -2), to: r.to };
  const last7 = { from: addDays(r.to, -6), to: r.to };
  const act3 = clientActivity(datasets, last3);
  const act7 = clientActivity(datasets, last7);
  v.clients_at_risk = [...act3.values()].filter(c => c.spend > 0 && c.leads === 0).length;
  v.clients_stalled = active.filter(c => { const w = act7.get(c.key); return !w || w.leads === 0; }).length;
  v.clients_paused = (datasets.retainers || []).filter(c => c.paused).length;
  v.leads_per_client_day = div(div(leads.total, active.length), days);
  v.free_rate = pct(div(leads.free, leads.billed + leads.free + leads.replacement));
  v.avg_billed_price = div(leads.billedValue, leads.pricedBilled);

  // ---- Tax B2B ----
  v.tax_spend = ads.tax_b2b.spend;
  v.tax_fb_leads = ads.tax_b2b.fbLeads;
  v.tax_cpl_fb = div(ads.tax_b2b.spend, ads.tax_b2b.fbLeads);
  v.tax_ctr = pct(div(ads.tax_b2b.clicks, ads.tax_b2b.impressions));
  v.tax_cpc = div(ads.tax_b2b.spend, ads.tax_b2b.clicks);
  v.tax_cpm = ads.tax_b2b.impressions ? (ads.tax_b2b.spend / ads.tax_b2b.impressions) * 1000 : null;
  v.b2b_leads = b2b.leads;
  v.b2b_cpl = div(ads.tax_b2b.spend, b2b.leads);
  v.b2b_booked = b2b.booked;
  v.b2b_cpb = div(ads.tax_b2b.spend, b2b.booked);
  v.b2b_shows = b2b.showed;
  v.b2b_closes = b2b.closed;
  v.b2b_cpa = div(ads.tax_b2b.spend, b2b.closed);
  v.b2b_cash = b2b.cash;
  v.b2b_roas = div(b2b.cash, ads.tax_b2b.spend);
  v.b2b_lead_to_book = pct(div(b2b.booked, b2b.leads));
  v.b2b_show_rate = pct(div(b2b.showed, b2b.booked));
  v.b2b_close_rate = pct(div(b2b.closed, b2b.showed));

  return v;
}

/* ---------------------------------------------------------------------------
 * Pace and status against a monthly target
 * ------------------------------------------------------------------------ */

export function paceFor(row, mtdActual, target, elapsedFraction) {
  if (target == null || !Number.isFinite(Number(target))) return { pace: null, expected: null, status: 'set_target' };
  if (mtdActual == null || !Number.isFinite(mtdActual)) return { pace: null, expected: null, status: 'no_data' };
  const t = Number(target);
  const expected = row.cumulative ? t * elapsedFraction : t;
  let pace;
  if (expected === 0) pace = mtdActual === 0 ? 1 : (row.dir === 'lower' ? 0 : Infinity);
  else if (row.dir === 'lower') pace = mtdActual === 0 ? Infinity : expected / mtdActual;
  else pace = mtdActual / expected;
  if (row.dir === 'none') return { pace: null, expected, status: 'partial' };
  return { pace, expected, status: statusForPace(pace) };
}

/* ---------------------------------------------------------------------------
 * The payload
 * ------------------------------------------------------------------------ */

export function buildDashboard({ today, tz, datasets = {}, availability = {}, targets = {}, ceoUnlocked = true, sources = {}, warnings = [] }) {
  const ranges = standardRanges(today);
  const weeks = weeksOfMonth(today);
  const month = monthKey(today);
  const elapsedFraction = monthElapsedFraction(today);

  const rangeList = [
    ...Object.values(ranges),
    ...weeks.filter(w => !w.future).map(w => ({ id: w.id, from: w.from, to: w.to })),
  ];
  const prevList = Object.values(ranges).map(r => ({ ...previousRange(r), forRange: r.id }));

  const valuesByRange = {};
  for (const r of rangeList) valuesByRange[r.id] = sectionValues(datasets, r);
  const prevByRange = {};
  for (const p of prevList) prevByRange[p.forRange] = sectionValues(datasets, p);

  const available = (row) => row.needs.every(k => availability[k] !== false);
  const missing = (row) => row.needs.filter(k => availability[k] === false);

  const shapeRow = (row) => {
    const ok = available(row);
    const values = {};
    for (const r of rangeList) values[r.id] = ok ? valuesByRange[r.id][row.id] ?? null : null;
    for (const w of weeks) if (w.future) values[w.id] = null;
    const prev = {};
    for (const p of prevList) prev[p.forRange] = ok ? prevByRange[p.forRange][row.id] ?? null : null;
    const target = targets?.[row.id]?.[month] ?? null;
    const { pace, expected, status } = ok ? paceFor(row, values.mtd, target, elapsedFraction) : { pace: null, expected: null, status: 'no_data' };
    return {
      id: row.id, label: row.label, unit: row.unit, dir: row.dir, cumulative: row.cumulative,
      emphasis: row.emphasis, formula: row.formula, needs: row.needs,
      values, prev, target, expected, pace, status, statusLabel: STATUS[status].label, tone: STATUS[status].tone,
      unavailable: ok ? null : missing(row),
    };
  };

  const sections = [];
  let ceo = { locked: !ceoUnlocked };
  for (const s of SECTIONS) {
    const shaped = { id: s.id, title: s.title, subtitle: s.subtitle, rows: s.rows.map(shapeRow) };
    if (s.ceoOnly) { if (ceoUnlocked) ceo = { locked: false, ...shaped }; }
    else sections.push(shaped);
  }

  // ---- Detail tables (MTD) ----
  const mtd = ranges.mtd;
  const activity = clientActivity(datasets, mtd);
  const clientsTable = [...activity.values()]
    .map(c => ({
      ...c,
      cplBilled: div(c.spend, c.billed),
      profit: c.billedValue - c.spend,
      margin: pct(div(c.billedValue - c.spend, c.billedValue)),
      daysSinceLastLead: c.lastLeadDate ? daysBetween(c.lastLeadDate, today) - 1 : null,
      health: clientHealth(c, today),
    }))
    .sort((a, b) => b.spend - a.spend || b.leads - a.leads);

  const eod = eodAgg(datasets.closerEod, mtd);
  const pros = prospectsAgg(datasets.prospects, mtd);
  const closerNames = new Set([...eod.byCloser.keys(), ...pros.byCloser.keys()]);
  const closersTable = [...closerNames].map(name => {
    const e = eod.byCloser.get(name) || { attempted: 0, connected: 0, offers: 0, closes: 0, count: 0 };
    const p = pros.byCloser.get(name) || { created: 0, contacted: 0, bookedEver: 0, bookedInRange: 0, speedSum: 0, speedCount: 0 };
    return {
      closer: name,
      attempted: e.attempted, connected: e.connected, offers: e.offers, closes: e.closes, eods: e.count,
      contactRate: pct(div(e.connected, e.attempted)), closeRate: pct(div(e.closes, e.offers)),
      prospects: p.created, contacted: p.contacted, booked: p.bookedInRange,
      prospectContactRate: pct(div(p.contacted, p.created)), speedToLead: div(p.speedSum, p.speedCount),
    };
  }).sort((a, b) => b.closes - a.closes || b.connected - a.connected);

  const ads = adsAgg(datasets.ads, mtd);
  const campaignsTable = [...ads.byCampaign.values()]
    .map(c => ({ ...c, cpl: div(c.spend, c.fbLeads), ctr: pct(div(c.clicks, c.impressions)), cpc: div(c.spend, c.clicks) }))
    .sort((a, b) => b.spend - a.spend);

  const whop = whopAgg(datasets.whop, mtd);
  const whopTable = [...whop.byProduct.values()].sort((a, b) => b.gross - a.gross);

  // ---- Daily series for sparklines (last 30 days) ----
  const seriesDays = eachDay(addDays(today, -29), today);
  const seriesIds = ['cash_collected', 'ad_spend_total', 'leads_billed', 'leads_sent', 'closes', 'profit_business', 'hs_profit', 'calls_connected'];
  const series = { dates: seriesDays };
  for (const id of seriesIds) series[id] = [];
  for (const d of seriesDays) {
    const v = sectionValues(datasets, { from: d, to: d });
    for (const id of seriesIds) series[id].push(v[id] ?? null);
  }

  return {
    generatedAt: null, // stamped by the API route
    tz, today, month, elapsedFraction,
    ranges: Object.fromEntries(Object.values(ranges).map(r => [r.id, { ...r, label: RANGE_LABEL[r.id], days: daysBetween(r.from, r.to) }])),
    weeks,
    sources,
    availability,
    ceo,
    sections,
    tables: { clients: clientsTable, closers: closersTable, campaigns: campaignsTable, whopProducts: whopTable },
    series,
    warnings,
  };
}

function clientHealth(c, today) {
  if (c.paused) return 'paused';
  const since = c.lastLeadDate ? daysBetween(c.lastLeadDate, today) - 1 : null;
  if (c.spend > 0 && (since == null || since >= 3)) return 'at_risk';
  if (c.spend === 0 && c.leads === 0) return 'inactive';
  if (since != null && since >= 7) return 'stalled';
  return 'healthy';
}
