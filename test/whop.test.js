import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalisePayment, normalisePayments, parsePage, buildUrl, createdAfterISO, fetchPayments,
  isConfigured, setupHint, amountsInCents, KEPT_STATUSES, MAX_PAGES,
} from '../lib/dashboard/sources/whop.js';
import { SourceError } from '../lib/dashboard/sources/_shared.js';

const TZ = 'America/Toronto';

async function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v == null) delete process.env[k]; else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v == null) delete process.env[k]; else process.env[k] = v; }
  }
}

function mockFetch(handler) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const r = handler(String(url), init, calls.length);
    const status = r.status || 200;
    return { ok: status >= 200 && status < 300, status, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

/* ---------------------------------------------------------------------------
 * normalisePayment
 * ------------------------------------------------------------------------ */

test('KEPT_STATUSES is the documented set', () => {
  assert.deepEqual([...KEPT_STATUSES].sort(), ['completed', 'paid', 'partially_refunded', 'refunded', 'succeeded']);
});

test('normalisePayment: basic paid payment with amount_after_fees', () => {
  const row = normalisePayment({
    id: 'pay_1', status: 'PAID', paid_at: '2026-09-10T15:00:00Z', total: 500, amount_after_fees: 478.35, currency: 'usd',
    product: { title: 'Growth Program' },
  }, { tz: TZ });
  assert.deepEqual(row, {
    id: 'pay_1', date: '2026-09-10', status: 'paid', gross: 500, net: 478.35, fees: 21.65, refunded: 0, product: 'Growth Program', currency: 'USD',
  });
});

test('normalisePayment: unknown / missing statuses are excluded', () => {
  for (const status of ['pending', 'failed', 'open', 'draft', '', undefined, 'void']) {
    assert.equal(normalisePayment({ id: 'x', status, paid_at: '2026-09-10T15:00:00Z', total: 10 }, { tz: TZ }), null, `status ${status}`);
  }
  assert.equal(normalisePayment(null, { tz: TZ }), null);
  assert.equal(normalisePayment('nope', { tz: TZ }), null);
});

test('normalisePayment: missing fees -> fees null (application_fee fallback used when present)', () => {
  const noFees = normalisePayment({ id: 'a', status: 'paid', created_at: '2026-09-10T15:00:00Z', total: 100 }, { tz: TZ });
  assert.equal(noFees.net, null);
  assert.equal(noFees.fees, null);
  assert.equal(noFees.gross, 100);

  const appFee = normalisePayment({ id: 'b', status: 'paid', created_at: '2026-09-10T15:00:00Z', total: 100, application_fee: { amount: 3.2 } }, { tz: TZ });
  assert.equal(appFee.net, null);
  assert.equal(appFee.fees, 3.2);

  // amount_after_fees wins over application_fee
  const both = normalisePayment({ id: 'c', status: 'paid', created_at: '2026-09-10T15:00:00Z', total: 100, amount_after_fees: 97, application_fee: { amount: 50 } }, { tz: TZ });
  assert.equal(both.fees, 3);
});

test('normalisePayment: gross falls back through total, final_amount, amount, subtotal', () => {
  const at = '2026-09-10T15:00:00Z';
  assert.equal(normalisePayment({ status: 'paid', paid_at: at, final_amount: 40, amount: 41, subtotal: 42 }, { tz: TZ }).gross, 40);
  assert.equal(normalisePayment({ status: 'paid', paid_at: at, amount: '41', subtotal: 42 }, { tz: TZ }).gross, 41);
  assert.equal(normalisePayment({ status: 'paid', paid_at: at, subtotal: 42 }, { tz: TZ }).gross, 42);
  assert.equal(normalisePayment({ status: 'paid', paid_at: at, total: 0, amount: 99 }, { tz: TZ }).gross, 0, 'a defined 0 is kept');
  assert.equal(normalisePayment({ status: 'paid', paid_at: at, total: null, amount: 99 }, { tz: TZ }).gross, 99, 'null is skipped');
  assert.equal(normalisePayment({ status: 'paid', paid_at: at }, { tz: TZ }).gross, 0, 'nothing -> 0');
});

test('normalisePayment: refunded amounts and refunded status', () => {
  const r = normalisePayment({ id: 'r', status: 'refunded', paid_at: '2026-09-10T15:00:00Z', total: 200, amount_after_fees: 190, refunded_amount: '200' }, { tz: TZ });
  assert.equal(r.status, 'refunded');
  assert.equal(r.gross, 200);
  assert.equal(r.refunded, 200);
  const partial = normalisePayment({ id: 'p', status: 'partially_refunded', paid_at: '2026-09-10T15:00:00Z', total: 200, refunded_amount: 50 }, { tz: TZ });
  assert.equal(partial.refunded, 50);
  const bad = normalisePayment({ id: 'q', status: 'paid', paid_at: '2026-09-10T15:00:00Z', total: 200, refunded_amount: 'n/a' }, { tz: TZ });
  assert.equal(bad.refunded, 0);
});

test('normalisePayment: cents flag divides gross, net, fees and refunded by 100', () => {
  const row = normalisePayment({
    id: 'c', status: 'succeeded', paid_at: '2026-09-10T15:00:00Z', total: 50000, amount_after_fees: 48325, refunded_amount: 1000,
  }, { tz: TZ, cents: true });
  assert.equal(row.gross, 500);
  assert.equal(row.net, 483.25);
  assert.equal(row.fees, 16.75);
  assert.equal(row.refunded, 10);

  const appFee = normalisePayment({ id: 'd', status: 'paid', paid_at: '2026-09-10T15:00:00Z', total: 10000, application_fee: { amount: 320 } }, { tz: TZ, cents: true });
  assert.equal(appFee.gross, 100);
  assert.equal(appFee.fees, 3.2);
  assert.equal(appFee.net, null);
});

test('normalisePayment: paid_at wins over created_at and the date shifts across midnight in America/Toronto', () => {
  // 03:30 UTC on Mar 4 is 22:30 EST on Mar 3 (before DST).
  const est = normalisePayment({ status: 'paid', paid_at: '2026-03-04T03:30:00Z', created_at: '2026-03-01T00:00:00Z', total: 1 }, { tz: TZ });
  assert.equal(est.date, '2026-03-03');
  // 03:30 UTC on Jul 4 is 23:30 EDT on Jul 3.
  const edt = normalisePayment({ status: 'paid', paid_at: '2026-07-04T03:30:00Z', total: 1 }, { tz: TZ });
  assert.equal(edt.date, '2026-07-03');
  // 04:30 UTC on Jul 4 is 00:30 EDT on Jul 4.
  const edt2 = normalisePayment({ status: 'paid', paid_at: '2026-07-04T04:30:00Z', total: 1 }, { tz: TZ });
  assert.equal(edt2.date, '2026-07-04');
  // created_at is the fallback when paid_at is absent.
  const created = normalisePayment({ status: 'paid', created_at: '2026-07-04T03:30:00Z', total: 1 }, { tz: TZ });
  assert.equal(created.date, '2026-07-03');
  // UTC zone keeps the UTC day.
  const utc = normalisePayment({ status: 'paid', paid_at: '2026-07-04T03:30:00Z', total: 1 }, { tz: 'UTC' });
  assert.equal(utc.date, '2026-07-04');
  // Unix-second timestamps as numbers are not valid Date input in ms; ISO strings are what Whop sends.
  const none = normalisePayment({ status: 'paid', total: 1 }, { tz: TZ });
  assert.equal(none, null, 'no date -> dropped');
  const garbage = normalisePayment({ status: 'paid', paid_at: 'yesterday-ish', total: 1 }, { tz: TZ });
  assert.equal(garbage, null);
});

test('normalisePayment: product name fallbacks', () => {
  const at = '2026-09-10T15:00:00Z';
  assert.equal(normalisePayment({ status: 'paid', paid_at: at, product: { name: 'P name' } }, { tz: TZ }).product, 'P name');
  assert.equal(normalisePayment({ status: 'paid', paid_at: at, plan: { title: 'Plan T' } }, { tz: TZ }).product, 'Plan T');
  assert.equal(normalisePayment({ status: 'paid', paid_at: at, plan: { name: 'Plan N' } }, { tz: TZ }).product, 'Plan N');
  assert.equal(normalisePayment({ status: 'paid', paid_at: at, membership: { product: { title: 'Mem P' } } }, { tz: TZ }).product, 'Mem P');
  assert.equal(normalisePayment({ status: 'paid', paid_at: at }, { tz: TZ }).product, '(no product)');
});

/* ---------------------------------------------------------------------------
 * normalisePayments (list) + meta
 * ------------------------------------------------------------------------ */

test('normalisePayments: meta counts, fee warning, currency warning, dedup by id', () => {
  const at = '2026-09-10T15:00:00Z';
  const out = normalisePayments([
    { id: '1', status: 'paid', paid_at: at, total: 100, amount_after_fees: 97, currency: 'usd' },
    { id: '2', status: 'paid', paid_at: at, total: 100, currency: 'USD' },
    { id: '2', status: 'paid', paid_at: at, total: 100, currency: 'USD' }, // duplicate page overlap
    { id: '3', status: 'pending', paid_at: at, total: 100 },
    { id: '4', status: 'refunded', paid_at: at, total: 50, refunded_amount: 50, currency: 'cad', amount_after_fees: 48 },
    { id: '5', status: 'paid', total: 5 }, // no date
  ], { tz: TZ });
  assert.equal(out.meta.fetched, 6);
  assert.equal(out.meta.kept, 3);
  assert.deepEqual(out.meta.statuses, { paid: 4, pending: 1, refunded: 1 });
  assert.equal(out.meta.feesReported, 2);
  assert.deepEqual(out.meta.currencies, ['CAD', 'USD']);
  assert.ok(out.meta.warnings.some(w => /processor fees are only reported for 2 of 3 payments/.test(w)), out.meta.warnings.join(' | '));
  assert.ok(out.meta.warnings.some(w => /CAD/.test(w)));
  assert.ok(out.meta.warnings.some(w => /1 payment\(s\) had no paid_at/.test(w)));
  assert.deepEqual(out.rows.map(r => r.id), ['1', '2', '4']);
});

test('normalisePayments: no warnings when everything is clean', () => {
  const out = normalisePayments([
    { id: '1', status: 'paid', paid_at: '2026-09-10T15:00:00Z', total: 100, amount_after_fees: 97, currency: 'usd' },
  ], { tz: TZ });
  assert.deepEqual(out.meta.warnings, []);
  assert.deepEqual(normalisePayments([], { tz: TZ }).meta, { fetched: 0, kept: 0, statuses: {}, feesReported: 0, currencies: [], warnings: [] });
});

/* ---------------------------------------------------------------------------
 * parsePage / buildUrl
 * ------------------------------------------------------------------------ */

test('parsePage: page_info shape, legacy pagination shape, and errors', () => {
  assert.deepEqual(parsePage({ data: [1], page_info: { has_next_page: true, end_cursor: 'abc' } }), { data: [1], next: 'abc' });
  assert.deepEqual(parsePage({ data: [1], page_info: { has_next_page: false, end_cursor: 'abc' } }), { data: [1], next: null });
  assert.deepEqual(parsePage({ data: [1], page_info: { has_next_page: true } }), { data: [1], next: null });
  assert.deepEqual(parsePage({ data: [2], pagination: { next_page: 2 } }), { data: [2], next: '2' });
  assert.deepEqual(parsePage({ data: [2], pagination: { next_page: null } }), { data: [2], next: null });
  assert.deepEqual(parsePage({ payments: [3] }), { data: [3], next: null });
  assert.throws(() => parsePage(null), SourceError);
  assert.throws(() => parsePage({ error: { message: 'Unauthorized' } }), /Whop: Unauthorized/);
  assert.throws(() => parsePage({ error: 'nope' }), /Whop: nope/);
  assert.throws(() => parsePage({ foo: 1 }), /no data array \(keys: foo\)/);
});

test('buildUrl / createdAfterISO', () => {
  assert.equal(createdAfterISO('2026-09-05'), '2026-09-02T00:00:00.000Z');
  assert.equal(createdAfterISO('2026-03-02'), '2026-02-27T00:00:00.000Z');
  const u = new URL(buildUrl({ companyId: 'biz_1', from: '2026-09-05' }));
  assert.equal(u.origin + u.pathname, 'https://api.whop.com/api/v1/payments');
  assert.equal(u.searchParams.get('company_id'), 'biz_1');
  assert.equal(u.searchParams.get('first'), '50');
  assert.equal(u.searchParams.get('created_after'), '2026-09-02T00:00:00.000Z');
  assert.equal(u.searchParams.get('order'), 'created_at');
  assert.equal(u.searchParams.get('direction'), 'desc');
  assert.equal(u.searchParams.get('after'), null);
  assert.equal(new URL(buildUrl({ companyId: 'biz_1', from: '2026-09-05', after: 'cur' })).searchParams.get('after'), 'cur');
});

/* ---------------------------------------------------------------------------
 * config
 * ------------------------------------------------------------------------ */

test('isConfigured / amountsInCents / setupHint', async () => {
  await withEnv({ WHOP_API_KEY: null, WHOP_COMPANY_ID: null, WHOP_AMOUNTS_IN_CENTS: null }, async () => {
    assert.equal(isConfigured(), false);
    assert.equal(amountsInCents(), false);
    process.env.WHOP_API_KEY = 'k';
    assert.equal(isConfigured(), false);
    process.env.WHOP_COMPANY_ID = 'biz_x';
    assert.equal(isConfigured(), true);
    process.env.WHOP_AMOUNTS_IN_CENTS = '1';
    assert.equal(amountsInCents(), true);
    process.env.WHOP_AMOUNTS_IN_CENTS = '0';
    assert.equal(amountsInCents(), false);
  });
  assert.match(setupHint(), /WHOP_API_KEY/);
  assert.match(setupHint(), /WHOP_COMPANY_ID/);
});

/* ---------------------------------------------------------------------------
 * fetchPayments with mocked fetch
 * ------------------------------------------------------------------------ */

test('fetchPayments: throws unconfigured with env var names', async () => {
  await withEnv({ WHOP_API_KEY: null, WHOP_COMPANY_ID: 'biz_1' }, async () => {
    await assert.rejects(fetchPayments({ from: '2026-09-01', to: '2026-09-30', tz: TZ }), (e) => e instanceof SourceError && e.missingConfig && /WHOP_API_KEY/.test(e.hint));
  });
  await withEnv({ WHOP_API_KEY: 'k', WHOP_COMPANY_ID: null }, async () => {
    await assert.rejects(fetchPayments({ from: '2026-09-01', to: '2026-09-30', tz: TZ }), (e) => e instanceof SourceError && e.missingConfig && /WHOP_COMPANY_ID/.test(e.hint));
  });
  await withEnv({ WHOP_API_KEY: 'k', WHOP_COMPANY_ID: 'biz_1' }, async () => {
    await assert.rejects(fetchPayments({ from: 'bad', to: '2026-09-30', tz: TZ }), /from=YYYY-MM-DD/);
  });
});

test('fetchPayments: follows cursor pagination, sends the bearer header, applies cents', async () => {
  await withEnv({ WHOP_API_KEY: 'secret', WHOP_COMPANY_ID: 'biz_1', WHOP_AMOUNTS_IN_CENTS: '1' }, async () => {
    const m = mockFetch((url) => {
      const after = new URL(url).searchParams.get('after');
      if (!after) return { body: { data: [{ id: 'p1', status: 'paid', paid_at: '2026-09-10T15:00:00Z', total: 10000, amount_after_fees: 9700 }], page_info: { has_next_page: true, end_cursor: 'c1' } } };
      if (after === 'c1') return { body: { data: [{ id: 'p2', status: 'paid', paid_at: '2026-09-09T15:00:00Z', total: 5000, amount_after_fees: 4850 }], page_info: { has_next_page: true, end_cursor: 'c2' } } };
      return { body: { data: [{ id: 'p3', status: 'failed', paid_at: '2026-09-08T15:00:00Z', total: 1 }], page_info: { has_next_page: false, end_cursor: null } } };
    });
    try {
      const out = await fetchPayments({ from: '2026-09-01', to: '2026-09-30', tz: TZ });
      assert.equal(m.calls.length, 3);
      assert.equal(m.calls[0].init.headers.Authorization, 'Bearer secret');
      assert.equal(new URL(m.calls[0].url).searchParams.get('created_after'), '2026-08-29T00:00:00.000Z');
      assert.equal(new URL(m.calls[1].url).searchParams.get('after'), 'c1');
      assert.equal(new URL(m.calls[2].url).searchParams.get('after'), 'c2');
      assert.equal(out.meta.pages, 3);
      assert.equal(out.meta.fetched, 3);
      assert.equal(out.meta.kept, 2);
      assert.deepEqual(out.rows.map(r => [r.id, r.date, r.gross, r.fees]), [['p1', '2026-09-10', 100, 3], ['p2', '2026-09-09', 50, 1.5]]);
      assert.deepEqual(out.meta.warnings, []);
      assert.deepEqual(out.meta.window, { from: '2026-09-01', to: '2026-09-30', createdAfter: '2026-08-29T00:00:00.000Z' });
    } finally { m.restore(); }
  });
});

test('fetchPayments: legacy pagination shape is followed too', async () => {
  await withEnv({ WHOP_API_KEY: 'secret', WHOP_COMPANY_ID: 'biz_1', WHOP_AMOUNTS_IN_CENTS: null }, async () => {
    const m = mockFetch((url) => {
      const after = new URL(url).searchParams.get('after');
      if (!after) return { body: { data: [{ id: 'a', status: 'paid', paid_at: '2026-09-10T15:00:00Z', total: 10, amount_after_fees: 9 }], pagination: { next_page: 2 } } };
      return { body: { data: [{ id: 'b', status: 'paid', paid_at: '2026-09-10T15:00:00Z', total: 10, amount_after_fees: 9 }], pagination: { next_page: null } } };
    });
    try {
      const out = await fetchPayments({ from: '2026-09-01', to: '2026-09-30', tz: TZ });
      assert.equal(m.calls.length, 2);
      assert.equal(new URL(m.calls[1].url).searchParams.get('after'), '2');
      assert.equal(out.rows.length, 2);
      assert.equal(out.rows[0].gross, 10);
    } finally { m.restore(); }
  });
});

test('fetchPayments: page cap adds a warning instead of looping forever', async () => {
  await withEnv({ WHOP_API_KEY: 'secret', WHOP_COMPANY_ID: 'biz_1', WHOP_AMOUNTS_IN_CENTS: null }, async () => {
    let n = 0;
    const m = mockFetch(() => {
      n++;
      return { body: { data: [{ id: `p${n}`, status: 'paid', paid_at: '2026-09-10T15:00:00Z', total: 1, amount_after_fees: 1 }], page_info: { has_next_page: true, end_cursor: `c${n}` } } };
    });
    try {
      const out = await fetchPayments({ from: '2026-09-01', to: '2026-09-30', tz: TZ });
      assert.equal(m.calls.length, MAX_PAGES);
      assert.equal(out.meta.pages, MAX_PAGES);
      assert.equal(out.rows.length, MAX_PAGES);
      assert.ok(out.meta.warnings.some(w => new RegExp(`stopped after ${MAX_PAGES} pages`).test(w)), out.meta.warnings.join(' | '));
    } finally { m.restore(); }
  });
});

test('fetchPayments: repeated cursor stops early with a warning', async () => {
  await withEnv({ WHOP_API_KEY: 'secret', WHOP_COMPANY_ID: 'biz_1', WHOP_AMOUNTS_IN_CENTS: null }, async () => {
    const m = mockFetch(() => ({ body: { data: [], page_info: { has_next_page: true, end_cursor: 'same' } } }));
    try {
      const out = await fetchPayments({ from: '2026-09-01', to: '2026-09-30', tz: TZ });
      assert.equal(m.calls.length, 2);
      assert.ok(out.meta.warnings.some(w => /cursor repeated/.test(w)));
    } finally { m.restore(); }
  });
});

test('fetchPayments: upstream HTTP errors become SourceError with status', async () => {
  await withEnv({ WHOP_API_KEY: 'secret', WHOP_COMPANY_ID: 'biz_1' }, async () => {
    const m = mockFetch(() => ({ status: 401, body: { error: { message: 'Invalid API key' } } }));
    try {
      await assert.rejects(fetchPayments({ from: '2026-09-01', to: '2026-09-30', tz: TZ }), (e) => e instanceof SourceError && e.status === 401 && /Invalid API key/.test(e.message));
    } finally { m.restore(); }
    const m2 = mockFetch(() => ({ status: 200, body: { error: 'rate limited' } }));
    try {
      await assert.rejects(fetchPayments({ from: '2026-09-01', to: '2026-09-30', tz: TZ }), /Whop: rate limited/);
    } finally { m2.restore(); }
  });
});
