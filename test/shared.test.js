import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson, SourceError, formulaString, airtableList } from '../lib/dashboard/sources/_shared.js';

function mockFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    const r = responses.shift();
    if (!r) throw new Error('no more mock responses');
    return { ok: r.status >= 200 && r.status < 300, status: r.status, headers: { get: (k) => (r.headers || {})[k.toLowerCase()] || null }, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
  };
  return calls;
}

test('fetchJson retries 429 and 5xx with backoff and honours Retry-After', async () => {
  const orig = globalThis.fetch;
  try {
    const waits = [];
    const calls = mockFetch([
      { status: 429, headers: { 'retry-after': '2' }, body: { error: { message: 'slow down' } } },
      { status: 503, body: 'bad gateway' },
      { status: 200, body: { ok: 1 } },
    ]);
    const out = await fetchJson('https://x.test/a', { label: 'T', _sleep: async (ms) => { waits.push(ms); } });
    assert.deepEqual(out, { ok: 1 });
    assert.equal(calls.length, 3);
    assert.deepEqual(waits, [2000, 800]);
  } finally { globalThis.fetch = orig; }
});

test('fetchJson gives up after the retry budget and never retries a 4xx other than 429 or a POST', async () => {
  const orig = globalThis.fetch;
  try {
    mockFetch([{ status: 500, body: 'x' }, { status: 500, body: 'x' }, { status: 500, body: 'x' }]);
    await assert.rejects(() => fetchJson('https://x.test/a', { label: 'T', _sleep: async () => {} }), (e) => e instanceof SourceError && e.status === 500 && /after 2 retries/.test(e.message));
    const calls = mockFetch([{ status: 404, body: { error: { type: 'NOT_FOUND' } } }]);
    await assert.rejects(() => fetchJson('https://x.test/b', { label: 'T' }), (e) => e instanceof SourceError && e.status === 404);
    assert.equal(calls.length, 1);
    const calls2 = mockFetch([{ status: 429, body: 'x' }]);
    await assert.rejects(() => fetchJson('https://x.test/c', { label: 'T', method: 'POST', body: '{}', _sleep: async () => {} }), (e) => e.status === 429);
    assert.equal(calls2.length, 1);
  } finally { globalThis.fetch = orig; }
});

test('airtableList follows offsets and encodes fields and formulas', async () => {
  const orig = globalThis.fetch;
  try {
    const calls = mockFetch([
      { status: 200, body: { records: [{ id: 'a' }], offset: 'o1' } },
      { status: 200, body: { records: [{ id: 'b' }] } },
    ]);
    const rows = await airtableList({ token: 't', baseId: 'app1', table: 'My Table', params: { fields: ['Lead Cost', 'Assigned Client'], filterByFormula: `IS_AFTER(CREATED_TIME(), DATETIME_PARSE(${formulaString('2026-09-01')}))` } });
    assert.deepEqual(rows.map(r => r.id), ['a', 'b']);
    const u = new URL(calls[0].url);
    assert.equal(u.pathname, '/v0/app1/My%20Table');
    assert.deepEqual(u.searchParams.getAll('fields[]'), ['Lead Cost', 'Assigned Client']);
    assert.ok(u.searchParams.get('filterByFormula').includes('"2026-09-01"'));
    assert.equal(new URL(calls[1].url).searchParams.get('offset'), 'o1');
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer t');
  } finally { globalThis.fetch = orig; }
});
