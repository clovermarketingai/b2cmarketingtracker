// Whop payments (REST API v1). Server-only.
//
// Cash collected, refunds and processor fees for the CEO section come from
// GET https://api.whop.com/api/v1/payments. Each payment is normalised with
// normalisePayment() into the shape compute.js expects:
//   { date, gross, net, fees, refunded, product, status, id, currency }
// `date` is the LOCAL calendar day (DASHBOARD_TZ) of paid_at (falling back to
// created_at), so a payment made at 23:30 Toronto time on the 3rd is counted on
// the 3rd even though Whop stores it as 03:30 UTC on the 4th.

import { SourceError, unconfigured, fetchJson } from './_shared.js';
import { localDateOf, addDays, businessTz } from '../dates.js';

const LABEL = 'Whop';
const ENDPOINT = 'https://api.whop.com/api/v1/payments';
const PAGE_SIZE = 100;
/** Hard cap on pages followed in one pull (60 x 100 = 6,000 payments). */
export const MAX_PAGES = 60;
/** Days subtracted from `from` for created_after, so late paid_at values are not missed. */
export const CREATED_AFTER_SLACK_DAYS = 3;
const TIMEOUT_MS = 30000;

/** Payment statuses that count as collected cash. Anything else is dropped. */
export const KEPT_STATUSES = new Set(['paid', 'partially_refunded', 'refunded', 'succeeded', 'completed']);

/** True when WHOP_API_KEY and WHOP_COMPANY_ID are both set. */
export function isConfigured() {
  return !!((process.env.WHOP_API_KEY || '').trim() && (process.env.WHOP_COMPANY_ID || '').trim());
}

/** Setup instructions shown on the dashboard when unconfigured. */
export function setupHint() {
  return 'Set WHOP_API_KEY (Whop API key) and WHOP_COMPANY_ID (biz_...). Set WHOP_AMOUNTS_IN_CENTS=1 only if Whop returns integer cents.';
}

/** True when WHOP_AMOUNTS_IN_CENTS is "1" / "true" / "yes". */
export function amountsInCents(env = process.env) {
  return /^(1|true|yes)$/i.test(String(env.WHOP_AMOUNTS_IN_CENTS || '').trim());
}

const round2 = (n) => Math.round(n * 100) / 100;

/** First value that is neither null nor undefined, as a finite Number (else null). */
function firstNumber(...vals) {
  for (const v of vals) {
    if (v == null || v === '') continue;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** ISO instant for `from` (YYYY-MM-DD) minus the slack days, at UTC midnight. */
export function createdAfterISO(from, slackDays = CREATED_AFTER_SLACK_DAYS) {
  return `${addDays(from, -slackDays)}T00:00:00.000Z`;
}

/**
 * Build the first-page request URL.
 * @param {{ companyId: string, from: string, after?: string }} p
 * @returns {string}
 */
export function buildUrl({ companyId, from, after }) {
  const qs = new URLSearchParams();
  qs.set('company_id', companyId);
  qs.set('first', String(PAGE_SIZE));
  qs.set('created_after', createdAfterISO(from));
  qs.set('order', 'created_at');
  qs.set('direction', 'desc');
  if (after) qs.set('after', after);
  return `${ENDPOINT}?${qs}`;
}

/**
 * Pure normaliser for one raw Whop payment. Returns null when the payment's
 * status is not a collected-cash status or it has no usable date.
 *
 * @param {object} p  raw payment from the API
 * @param {{ tz?: string, cents?: boolean }} [opts]
 * @returns {{ id: string|null, date: string, status: string, gross: number, net: number|null, fees: number|null, refunded: number, product: string, currency: string|null } | null}
 */
export function normalisePayment(p, { tz = businessTz(), cents = false } = {}) {
  if (!p || typeof p !== 'object') return null;
  const status = String(p.status || '').toLowerCase();
  if (!KEPT_STATUSES.has(status)) return null;
  const date = localDateOf(p.paid_at || p.created_at, tz);
  if (!date) return null;

  let gross = firstNumber(p.total, p.final_amount, p.amount, p.subtotal);
  if (gross == null) gross = 0;
  let net = p.amount_after_fees != null && p.amount_after_fees !== '' ? firstNumber(p.amount_after_fees) : null;
  let fees = net != null
    ? round2(gross - net)
    : (p.application_fee && p.application_fee.amount != null ? firstNumber(p.application_fee.amount) : null);
  let refunded = Number(p.refunded_amount) || 0;

  if (cents) {
    gross = gross / 100;
    if (net != null) net = net / 100;
    if (fees != null) fees = fees / 100;
    refunded = refunded / 100;
  }

  const product = p.product?.title || p.product?.name || p.plan?.title || p.plan?.name || p.membership?.product?.title || '(no product)';
  const currency = p.currency ? String(p.currency).toUpperCase() : null;

  return {
    id: p.id != null ? String(p.id) : null,
    date,
    status,
    gross: round2(gross),
    net: net != null ? round2(net) : null,
    fees: fees != null ? round2(fees) : null,
    refunded: round2(refunded),
    product: String(product),
    currency,
  };
}

/**
 * Pull the data array and the "next page" cursor out of one response body.
 * Accepts the current { data, page_info: { has_next_page, end_cursor } } shape
 * and, defensively, the older { data, pagination: { next_page } } shape.
 * @param {unknown} body
 * @returns {{ data: Array<object>, next: string|null }}
 */
export function parsePage(body) {
  if (!body || typeof body !== 'object') throw new SourceError(`${LABEL}: empty or non-JSON response`, { body });
  if (body.error) {
    const msg = typeof body.error === 'string' ? body.error : (body.error.message || body.error.type || JSON.stringify(body.error).slice(0, 300));
    throw new SourceError(`${LABEL}: ${msg}`, { body: body.error });
  }
  const data = Array.isArray(body.data) ? body.data : Array.isArray(body.payments) ? body.payments : null;
  if (!data) {
    const keys = Object.keys(body).slice(0, 10).join(', ') || 'none';
    throw new SourceError(`${LABEL}: response has no data array (keys: ${keys})`, { body });
  }
  let next = null;
  const pi = body.page_info;
  if (pi && typeof pi === 'object') {
    if (pi.has_next_page && pi.end_cursor) next = String(pi.end_cursor);
  } else if (body.pagination && typeof body.pagination === 'object' && body.pagination.next_page != null && body.pagination.next_page !== '') {
    next = String(body.pagination.next_page);
  }
  return { data, next };
}

/**
 * Normalise a list of raw payments into rows + meta (pure; used by fetchPayments
 * and directly testable).
 * @param {Array<object>} raw
 * @param {{ tz?: string, cents?: boolean, warnings?: string[] }} [opts]
 * @returns {{ rows: Array<object>, meta: { fetched: number, kept: number, statuses: Record<string, number>, feesReported: number, currencies: string[], warnings: string[] } }}
 */
export function normalisePayments(raw, { tz = businessTz(), cents = false, warnings = [] } = {}) {
  const rows = [];
  const statuses = {};
  const currencies = new Set();
  let feesReported = 0;
  let noDate = 0;
  const seen = new Set();
  for (const p of raw || []) {
    const status = String(p?.status || '').toLowerCase() || '(blank)';
    statuses[status] = (statuses[status] || 0) + 1;
    const row = normalisePayment(p, { tz, cents });
    if (!row) {
      if (KEPT_STATUSES.has(status)) noDate++;
      continue;
    }
    if (row.id) {
      if (seen.has(row.id)) continue; // cursor pages can overlap when new payments land mid-pull
      seen.add(row.id);
    }
    if (row.fees != null) feesReported++;
    if (row.currency) currencies.add(row.currency);
    rows.push(row);
  }
  const out = [...warnings];
  if (rows.length && feesReported < rows.length) {
    out.push(`processor fees are only reported for ${feesReported} of ${rows.length} payments; the fees row is understated.`);
  }
  if (noDate) out.push(`${noDate} payment(s) had no paid_at/created_at and were skipped.`);
  const nonUsd = [...currencies].filter(c => c !== 'USD');
  if (nonUsd.length) out.push(`payments in ${nonUsd.join(', ')} are summed at face value (no FX conversion).`);
  return {
    rows,
    meta: { fetched: (raw || []).length, kept: rows.length, statuses, feesReported, currencies: [...currencies].sort(), warnings: out },
  };
}

/**
 * Fetch every collected payment whose paid_at/created_at falls on or after
 * `from` (minus a 3-day slack), following cursor pagination.
 * @param {{ from: string, to: string, tz?: string }} p
 * @returns {Promise<{ rows: Array<object>, meta: object }>}
 */
export async function fetchPayments({ from, to, tz = businessTz() } = {}) {
  const apiKey = (process.env.WHOP_API_KEY || '').trim();
  const companyId = (process.env.WHOP_COMPANY_ID || '').trim();
  if (!apiKey) throw unconfigured('Whop payments', 'Set WHOP_API_KEY in Vercel.');
  if (!companyId) throw unconfigured('Whop payments', 'Set WHOP_COMPANY_ID (biz_...) in Vercel.');
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new SourceError(`${LABEL}: fetchPayments needs from=YYYY-MM-DD (got ${JSON.stringify(from)})`);

  const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' };
  const raw = [];
  const warnings = [];
  let after;
  let pages = 0;
  const seenCursors = new Set();
  do {
    const body = await fetchJson(buildUrl({ companyId, from, after }), { headers, label: LABEL, timeoutMs: TIMEOUT_MS });
    const { data, next } = parsePage(body);
    raw.push(...data);
    pages++;
    if (next && seenCursors.has(next)) {
      warnings.push('pagination cursor repeated; stopped early.');
      after = null;
    } else {
      if (next) seenCursors.add(next);
      after = next;
    }
    if (after && pages >= MAX_PAGES) {
      warnings.push(`stopped after ${MAX_PAGES} pages (${raw.length} payments); older payments in the window may be missing.`);
      after = null;
    }
  } while (after);

  const result = normalisePayments(raw, { tz, cents: amountsInCents(), warnings });
  result.meta.pages = pages;
  result.meta.window = { from, to, createdAfter: createdAfterISO(from) };
  return result;
}
