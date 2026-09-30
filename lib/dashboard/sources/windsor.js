// Facebook ads through Windsor.ai. Server-only.
//
// Windsor already reports by the ad account's calendar day, so dates are used
// as-is (the ad account should be set to DASHBOARD_TZ). Rows come back one per
// (date, campaign) after summing any ad-set / ad level duplicates.
//
// Output row: { date, campaign, campaignId, line, client, spend, clicks, impressions, fbLeads }

import { SourceError, unconfigured, fetchJson } from './_shared.js';
import { classifyCampaign, parseLineRules } from './adsLines.js';
import { CLIENTS } from '../../clients.js';
import { todayISO, isISODate, businessTz } from '../dates.js';

const LABEL = 'Windsor.ai';
const ENDPOINT = 'https://connectors.windsor.ai/facebook';
const FIELDS = 'date,campaign,campaign_id,spend,actions_lead,clicks,impressions';
const TIMEOUT_MS = 40000;
/** Earliest day the legacy /daily page cares about. */
export const ALL_TIME_FROM = '2024-01-01';
const MAX_NAMES_IN_WARNING = 8;

/** True when WINDSOR_API_KEY is set. */
export function isConfigured() {
  return !!(process.env.WINDSOR_API_KEY || '').trim();
}

/** Setup instructions shown on the dashboard when unconfigured. */
export function setupHint() {
  return 'Set WINDSOR_API_KEY (Windsor.ai API key). Optional: WINDSOR_ACCOUNTS (comma list for select_accounts), ADS_LINE_RULES (JSON [{ "match", "line" }]).';
}

const round2 = (n) => Math.round(n * 100) / 100;
const money = (n) => `$${round2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Build the Windsor request URL.
 * @param {{ apiKey: string, from: string, to: string, accounts?: string }} p
 * @returns {string}
 */
export function buildUrl({ apiKey, from, to, accounts }) {
  const qs = new URLSearchParams();
  qs.set('api_key', apiKey);
  qs.set('fields', FIELDS);
  qs.set('date_from', from);
  qs.set('date_to', to);
  const acc = String(accounts ?? '').split(',').map(s => s.trim()).filter(Boolean).join(',');
  if (acc) qs.set('select_accounts', acc);
  return `${ENDPOINT}?${qs}`;
}

/**
 * The data array out of a Windsor response body. Windsor can answer 200 with
 * { error } or with no data at all; both are upstream errors.
 * @param {unknown} body
 * @returns {Array<object>}
 */
export function windsorData(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') throw new SourceError(`${LABEL}: empty or non-JSON response`, { body });
  if (body.error) {
    const msg = typeof body.error === 'string' ? body.error : (body.error.message || body.error.type || JSON.stringify(body.error).slice(0, 300));
    throw new SourceError(`${LABEL}: ${msg}`, { body: body.error });
  }
  if (!Array.isArray(body.data)) {
    const keys = Object.keys(body).slice(0, 10).join(', ') || 'none';
    throw new SourceError(`${LABEL}: response has no data array (keys: ${keys})`, { body });
  }
  return body.data;
}

/**
 * Pure normaliser shared by fetchAds and fetchAllTimeAds.
 * Accepts the raw Windsor body ({ data: [...] }) or the data array itself.
 * Drops rows without a campaign or a usable date (counted in meta.dropped),
 * sums duplicate (date, campaign_id) rows, classifies every campaign and
 * reports unclassified spend and unknown hs_b2c clients as warnings.
 *
 * @param {unknown} rawData
 * @param {{ rules?: Array<{ match: RegExp|string, line: string }>, clients?: Record<string, unknown>, warnings?: string[] }} [opts]
 * @returns {{ rows: Array<object>, meta: { fetchedRows: number, dropped: number, droppedDetail: { noCampaign: number, noDate: number }, campaigns: Array<object>, unclassifiedSpend: number, warnings: string[] } }}
 */
export function normaliseRows(rawData, { rules = [], clients = CLIENTS, warnings = [] } = {}) {
  const data = windsorData(rawData);
  const byKey = new Map();
  const classCache = new Map();
  const droppedDetail = { noCampaign: 0, noDate: 0 };

  const classify = (name) => {
    if (!classCache.has(name)) classCache.set(name, classifyCampaign(name, { rules, clients }));
    return classCache.get(name);
  };

  for (const raw of data) {
    if (!raw || typeof raw !== 'object') { droppedDetail.noCampaign++; continue; }
    const campaign = String(raw.campaign ?? '').trim();
    if (!campaign) { droppedDetail.noCampaign++; continue; }
    const date = String(raw.date ?? '').slice(0, 10);
    if (!isISODate(date)) { droppedDetail.noDate++; continue; }
    const campaignId = raw.campaign_id == null || raw.campaign_id === '' ? null : String(raw.campaign_id);
    const key = `${date}|${campaignId ?? `name:${campaign}`}`;
    let row = byKey.get(key);
    if (!row) {
      const c = classify(campaign);
      row = { date, campaign, campaignId, line: c.line, client: c.client, spend: 0, clicks: 0, impressions: 0, fbLeads: 0 };
      byKey.set(key, row);
    }
    row.spend += Number(raw.spend) || 0;
    row.clicks += Number(raw.clicks) || 0;
    row.impressions += Number(raw.impressions) || 0;
    row.fbLeads += Number(raw.actions_lead) || 0;
  }

  const rows = [...byKey.values()].map(r => ({ ...r, spend: round2(r.spend) }));
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.campaign.localeCompare(b.campaign)));

  // Per-campaign roll-up for the meta block.
  const byCampaign = new Map();
  for (const r of rows) {
    const ck = r.campaignId ?? `name:${r.campaign}`;
    const c = byCampaign.get(ck) || { campaign: r.campaign, campaignId: r.campaignId, line: r.line, client: r.client, spend: 0 };
    c.spend += r.spend;
    byCampaign.set(ck, c);
  }
  const campaigns = [...byCampaign.values()].map(c => ({ ...c, spend: round2(c.spend) })).sort((a, b) => b.spend - a.spend);

  const out = [...warnings];
  const unclassified = campaigns.filter(c => c.line === 'other');
  const unclassifiedSpend = round2(unclassified.reduce((s, c) => s + c.spend, 0));
  if (unclassifiedSpend > 0) {
    const names = unclassified.filter(c => c.spend > 0).map(c => c.campaign);
    const shown = names.slice(0, MAX_NAMES_IN_WARNING).join(', ') + (names.length > MAX_NAMES_IN_WARNING ? ` (+${names.length - MAX_NAMES_IN_WARNING} more)` : '');
    out.push(`${names.length} campaign${names.length === 1 ? '' : 's'} totalling ${money(unclassifiedSpend)} matched no line rule: ${shown}`);
  }
  const clientKeys = new Set(Object.keys(clients || {}));
  const seen = new Set();
  for (const c of campaigns) {
    if (c.line !== 'hs_b2c' || clientKeys.has(c.client) || seen.has(c.campaign)) continue;
    seen.add(c.campaign);
    out.push(`campaign ${c.campaign} is not in lib/clients.js; its leads cannot be joined`);
  }

  return {
    rows,
    meta: {
      fetchedRows: data.length,
      dropped: droppedDetail.noCampaign + droppedDetail.noDate,
      droppedDetail,
      campaigns,
      unclassifiedSpend,
      warnings: out,
    },
  };
}

function assertRange(from, to) {
  if (!isISODate(from) || !isISODate(to)) throw new SourceError(`${LABEL}: from/to must be YYYY-MM-DD (got ${from} .. ${to})`);
  if (from > to) throw new SourceError(`${LABEL}: from (${from}) is after to (${to})`);
}

async function pull({ from, to }) {
  const apiKey = (process.env.WINDSOR_API_KEY || '').trim();
  if (!apiKey) throw unconfigured('Facebook ads (Windsor.ai)', 'Set WINDSOR_API_KEY.');
  assertRange(from, to);
  const { rules, warning } = parseLineRules(process.env.ADS_LINE_RULES);
  const url = buildUrl({ apiKey, from, to, accounts: process.env.WINDSOR_ACCOUNTS });
  const body = await fetchJson(url, { label: LABEL, timeoutMs: TIMEOUT_MS });
  const result = normaliseRows(body, { rules, clients: CLIENTS, warnings: warning ? [warning] : [] });
  result.meta.from = from;
  result.meta.to = to;
  return result;
}

/**
 * Facebook ad rows by day and campaign for the window (inclusive).
 * `tz` is accepted for the connector contract; Windsor dates are already the
 * ad account's local calendar day and are used as-is.
 *
 * @param {{ from: string, to: string, tz?: string }} p
 * @returns {Promise<{ rows: Array<object>, meta: object }>}
 */
export async function fetchAds({ from, to, tz } = {}) {
  void tz;
  return pull({ from, to });
}

/**
 * Every row from ALL_TIME_FROM through today (business timezone), same
 * normalisation; used by the legacy /daily page.
 *
 * @param {{ tz?: string, now?: Date }} [p]
 * @returns {Promise<{ rows: Array<object>, meta: object }>}
 */
export async function fetchAllTimeAds({ tz, now = new Date() } = {}) {
  const zone = tz || businessTz();
  return pull({ from: ALL_TIME_FROM, to: todayISO(zone, now) });
}
