import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCampaign, parseLineRules, clientFromCampaign, LINES } from '../lib/dashboard/sources/adsLines.js';
import {
  normaliseRows, windsorData, buildUrl, fetchAds, fetchAllTimeAds, isConfigured, setupHint, ALL_TIME_FROM,
} from '../lib/dashboard/sources/windsor.js';
import { SourceError } from '../lib/dashboard/sources/_shared.js';
import { CLIENTS } from '../lib/clients.js';

const clientsLike = {
  '(Nico) PROS Tree & Landscape': { short: 'Nico PROS' },
  '(Nico) PROS Tree': { short: 'Nico short' },
  '(Ed) Protree Services LLC': { short: 'Ed Protree' },
};

/* ---------------------------------------------------------------------------
 * classification
 * ------------------------------------------------------------------------ */

test('parseLineRules: valid, empty and bad input', () => {
  assert.deepEqual(parseLineRules(''), { rules: [], warning: null });
  assert.deepEqual(parseLineRules(undefined), { rules: [], warning: null });

  const ok = parseLineRules('[{"match":"^retarget","line":"hs_b2c"},{"match":"brand","line":"other"}]');
  assert.equal(ok.warning, null);
  assert.equal(ok.rules.length, 2);
  assert.ok(ok.rules[0].match instanceof RegExp);
  assert.ok(ok.rules[0].match.flags.includes('i'));
  assert.equal(ok.rules[1].line, 'other');

  const badJson = parseLineRules('[{match: nope');
  assert.deepEqual(badJson.rules, []);
  assert.match(badJson.warning, /not valid JSON/);

  const notArray = parseLineRules('{"match":"x","line":"other"}');
  assert.deepEqual(notArray.rules, []);
  assert.match(notArray.warning, /must be a JSON array/);

  const partial = parseLineRules('[{"match":"(unclosed","line":"other"},{"match":"x","line":"nope"},{"line":"other"},{"match":"good","line":"tax_b2b"}]');
  assert.equal(partial.rules.length, 1);
  assert.equal(partial.rules[0].line, 'tax_b2b');
  assert.match(partial.warning, /regex "\(unclosed" is invalid/);
  assert.match(partial.warning, /unknown line "nope"/);
  assert.match(partial.warning, /rule 3 has no "match"/);
});

test('classifyCampaign: default rules in order', () => {
  const opts = { clients: clientsLike };
  assert.deepEqual(LINES, ['hs_b2c', 'hs_b2b', 'tax_b2b', 'other']);

  // (2) "(" prefix -> hs_b2c with the LONGEST matching CLIENTS key, case-insensitive
  const nico = classifyCampaign('(NICO) pros tree & landscape - Tree Service Leads', opts);
  assert.equal(nico.line, 'hs_b2c');
  assert.equal(nico.client, '(Nico) PROS Tree & Landscape');
  assert.equal(nico.clientKnown, true);

  // (2) no key matches -> text before the first " - "
  const unknown = classifyCampaign('(Bob) Bobs Trees - Leads - v2', opts);
  assert.equal(unknown.line, 'hs_b2c');
  assert.equal(unknown.client, '(Bob) Bobs Trees');
  assert.equal(unknown.clientKnown, false);

  // (2) no " - " -> the whole name
  const whole = classifyCampaign('(Bob) Bobs Trees', opts);
  assert.equal(whole.client, '(Bob) Bobs Trees');
  assert.equal(whole.clientKnown, false);

  // "(" prefix wins even if the name mentions b2b
  assert.equal(classifyCampaign('(Ed) Protree Services LLC - B2B test', opts).line, 'hs_b2c');

  // (3) b2b + tax -> tax_b2b, in either order
  assert.deepEqual(classifyCampaign('B2B Tax - Firms - Lead Form', opts).line, 'tax_b2b');
  assert.deepEqual(classifyCampaign('TAX accountants b2b', opts).line, 'tax_b2b');
  assert.equal(classifyCampaign('B2B Tax - Firms', opts).client, null);

  // (4) b2b alone -> hs_b2b
  assert.equal(classifyCampaign('B2B Home Service - Owners', opts).line, 'hs_b2b');
  assert.equal(classifyCampaign('owners b2b acquisition', opts).line, 'hs_b2b');

  // (5) everything else -> other
  assert.equal(classifyCampaign('Retargeting - Site visitors', opts).line, 'other');
  assert.equal(classifyCampaign('', opts).line, 'other');
  assert.equal(classifyCampaign(null, opts).line, 'other');
  assert.equal(classifyCampaign(undefined).line, 'other');
});

test('classifyCampaign: env rules override the defaults, in order', () => {
  const { rules } = parseLineRules(JSON.stringify([
    { match: 'retarget', line: 'hs_b2b' },
    { match: '^\\(Special\\)', line: 'tax_b2b' },
    { match: 'promote', line: 'hs_b2c' },
    { match: 'b2b', line: 'other' },
  ]));
  const opts = { rules, clients: clientsLike };
  assert.equal(classifyCampaign('RETARGETING - Site visitors', opts).line, 'hs_b2b');
  assert.equal(classifyCampaign('(Special) Someone - Leads', opts).line, 'tax_b2b');
  assert.equal(classifyCampaign('(Special) Someone - Leads', opts).client, null);
  // env rule that resolves to hs_b2c still gets a client
  const promoted = classifyCampaign('Promote (Ed) Protree Services LLC', opts);
  assert.equal(promoted.line, 'hs_b2c');
  assert.equal(promoted.client, 'Promote (Ed) Protree Services LLC');
  assert.equal(promoted.clientKnown, false);
  // first matching rule wins; later rules and defaults do not run
  assert.equal(classifyCampaign('B2B Tax retarget', opts).line, 'hs_b2b');
  assert.equal(classifyCampaign('B2B Tax firms', opts).line, 'other');
  // rules with string matchers or unknown lines are tolerated
  assert.equal(classifyCampaign('B2B Home Service', { rules: [{ match: 'home', line: 'tax_b2b' }] }).line, 'tax_b2b');
  assert.equal(classifyCampaign('B2B Home Service', { rules: [{ match: 'home', line: 'bogus' }, { match: '[', line: 'other' }] }).line, 'hs_b2b');
});

test('clientFromCampaign: prefix and fallback', () => {
  assert.deepEqual(clientFromCampaign('(Nico) PROS Tree & Landscape - Leads', clientsLike), { client: '(Nico) PROS Tree & Landscape', known: true });
  assert.deepEqual(clientFromCampaign('(Nico) PROS Tree - Leads', clientsLike), { client: '(Nico) PROS Tree', known: true });
  assert.deepEqual(clientFromCampaign('  (X) Y - Z ', clientsLike), { client: '(X) Y', known: false });
  assert.deepEqual(clientFromCampaign('', clientsLike), { client: '', known: false });
  // real roster: every key classifies to itself
  for (const key of Object.keys(CLIENTS)) {
    const c = classifyCampaign(`${key} - Tree Service Leads`, { clients: CLIENTS });
    assert.equal(c.line, 'hs_b2c');
    assert.equal(c.client, key);
  }
});

/* ---------------------------------------------------------------------------
 * normalisation
 * ------------------------------------------------------------------------ */

const fixture = {
  data: [
    // duplicates (one per ad set) that must be summed
    { date: '2026-09-29', campaign: '(Ed) Protree Services LLC - Tree Service Leads', campaign_id: '111', spend: '10.10', actions_lead: '2', clicks: '15', impressions: '1000' },
    { date: '2026-09-29T00:00:00', campaign: '(Ed) Protree Services LLC - Tree Service Leads', campaign_id: 111, spend: 5.25, actions_lead: 1, clicks: 5, impressions: 500 },
    // strings for numbers + a non-numeric value
    { date: '2026-09-30', campaign: '(Ed) Protree Services LLC - Tree Service Leads', campaign_id: '111', spend: '7', actions_lead: null, clicks: 'n/a', impressions: '' },
    // unknown client, hs_b2c
    { date: '2026-09-29', campaign: '(Zed) Unknown Tree Co - Leads', campaign_id: '222', spend: 3, actions_lead: 0, clicks: 1, impressions: 10 },
    // b2b lines
    { date: '2026-09-29', campaign: 'B2B Tax - Firms - Lead Form', campaign_id: '333', spend: 20, actions_lead: 4, clicks: 30, impressions: 3000 },
    { date: '2026-09-29', campaign: 'B2B Home Service - Owners', campaign_id: '444', spend: 12, actions_lead: 1, clicks: 9, impressions: 900 },
    // unclassified
    { date: '2026-09-29', campaign: 'Retargeting - Site visitors', campaign_id: '555', spend: '4.5', actions_lead: 0, clicks: 2, impressions: 200 },
    { date: '2026-09-30', campaign: 'Brand awareness', campaign_id: '666', spend: 0, actions_lead: 0, clicks: 0, impressions: 50 },
    // dropped: no campaign / no date / bad date / not an object
    { date: '2026-09-29', campaign: '', campaign_id: '777', spend: 99 },
    { date: null, campaign: 'Ghost', campaign_id: '888', spend: 99 },
    { date: 'yesterday', campaign: 'Ghost 2', campaign_id: '889', spend: 99 },
    null,
    // no campaign_id -> keyed by name
    { date: '2026-09-29', campaign: 'No id campaign', spend: 1, clicks: 1, impressions: 1 },
    { date: '2026-09-29', campaign: 'No id campaign', spend: 1, clicks: 1, impressions: 1 },
  ],
};

test('normaliseRows: dedupes, coerces, classifies, drops and warns', () => {
  const { rows, meta } = normaliseRows(fixture, { clients: clientsLike });

  assert.equal(meta.fetchedRows, 14);
  assert.equal(meta.dropped, 4);
  assert.deepEqual(meta.droppedDetail, { noCampaign: 2, noDate: 2, excluded: 0 });

  const ed29 = rows.find(r => r.campaignId === '111' && r.date === '2026-09-29');
  assert.deepEqual(ed29, {
    date: '2026-09-29', campaign: '(Ed) Protree Services LLC - Tree Service Leads', campaignId: '111',
    line: 'hs_b2c', client: '(Ed) Protree Services LLC', spend: 15.35, clicks: 20, impressions: 1500, fbLeads: 3,
  });
  const ed30 = rows.find(r => r.campaignId === '111' && r.date === '2026-09-30');
  assert.deepEqual([ed30.spend, ed30.clicks, ed30.impressions, ed30.fbLeads], [7, 0, 0, 0]);

  assert.equal(rows.filter(r => r.campaignId === '111').length, 2);
  const noId = rows.filter(r => r.campaign === 'No id campaign');
  assert.equal(noId.length, 1);
  assert.equal(noId[0].campaignId, null);
  assert.equal(noId[0].spend, 2);

  assert.equal(rows.find(r => r.campaignId === '333').line, 'tax_b2b');
  assert.equal(rows.find(r => r.campaignId === '444').line, 'hs_b2b');
  assert.equal(rows.find(r => r.campaignId === '555').line, 'other');
  assert.equal(rows.find(r => r.campaignId === '222').client, '(Zed) Unknown Tree Co');
  assert.ok(rows.every(r => r.line !== 'hs_b2c' ? r.client === null : typeof r.client === 'string'));
  assert.ok(rows.every(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date)));

  // sorted by date then campaign
  const dates = rows.map(r => r.date);
  assert.deepEqual(dates, [...dates].sort());

  // campaigns roll-up
  const c111 = meta.campaigns.find(c => c.campaignId === '111');
  assert.deepEqual(c111, { campaign: '(Ed) Protree Services LLC - Tree Service Leads', campaignId: '111', line: 'hs_b2c', client: '(Ed) Protree Services LLC', spend: 22.35 });
  assert.equal(meta.campaigns[0].campaignId, '111'); // sorted by spend desc
  assert.equal(meta.campaigns.length, 7);

  // unclassified spend: 4.5 + 0 + 2 (no-id campaign)
  assert.equal(meta.unclassifiedSpend, 6.5);
  const uw = meta.warnings.find(w => w.includes('matched no line rule'));
  assert.ok(uw, 'has an unclassified warning');
  assert.match(uw, /^2 campaigns totalling \$6\.50 matched no line rule: /);
  assert.ok(uw.includes('Retargeting - Site visitors') && uw.includes('No id campaign'));
  assert.ok(!uw.includes('Brand awareness'), 'zero-spend campaigns are not listed by name');

  const cw = meta.warnings.filter(w => w.includes('not in lib/clients.js'));
  assert.deepEqual(cw, ['campaign (Zed) Unknown Tree Co - Leads is not in lib/clients.js; its leads cannot be joined']);
});

test('normaliseRows: accepts a bare array, applies env rules and passes warnings through', () => {
  const { rules, warning } = parseLineRules('[{"match":"retarget","line":"hs_b2b"}]');
  assert.equal(warning, null);
  const { rows, meta } = normaliseRows(
    [{ date: '2026-09-01', campaign: 'Retargeting - Site visitors', campaign_id: '1', spend: 3 }],
    { rules, clients: clientsLike, warnings: ['pre-existing'] },
  );
  assert.equal(rows[0].line, 'hs_b2b');
  assert.equal(meta.unclassifiedSpend, 0);
  assert.deepEqual(meta.warnings, ['pre-existing']);

  const empty = normaliseRows({ data: [] });
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.meta.fetchedRows, 0);
  assert.deepEqual(empty.meta.warnings, []);
});

test('windsorData / normaliseRows: error bodies throw SourceError', () => {
  assert.throws(() => normaliseRows({ error: 'Invalid API key' }), (e) => e instanceof SourceError && /Windsor\.ai: Invalid API key/.test(e.message));
  assert.throws(() => windsorData({ error: { message: 'quota exceeded', type: 'limit' } }), /Windsor\.ai: quota exceeded/);
  assert.throws(() => windsorData({ status: 'ok' }), /no data array \(keys: status\)/);
  assert.throws(() => windsorData(null), (e) => e instanceof SourceError && /empty or non-JSON/.test(e.message));
  assert.throws(() => windsorData('text'), SourceError);
  assert.deepEqual(windsorData([]), []);
});

test('buildUrl: fields, range and optional accounts', () => {
  const u = new URL(buildUrl({ apiKey: 'k', from: '2026-09-01', to: '2026-09-30' }));
  assert.equal(u.origin + u.pathname, 'https://connectors.windsor.ai/facebook');
  assert.equal(u.searchParams.get('api_key'), 'k');
  assert.equal(u.searchParams.get('fields'), 'date,campaign,campaign_id,spend,actions_lead,clicks,impressions');
  assert.equal(u.searchParams.get('date_from'), '2026-09-01');
  assert.equal(u.searchParams.get('date_to'), '2026-09-30');
  assert.equal(u.searchParams.get('select_accounts'), null);
  const u2 = new URL(buildUrl({ apiKey: 'k', from: '2026-09-01', to: '2026-09-30', accounts: ' act_1 , act_2,, ' }));
  assert.equal(u2.searchParams.get('select_accounts'), 'act_1,act_2');
  assert.equal(new URL(buildUrl({ apiKey: 'k', from: 'a', to: 'b', accounts: ' , ' })).searchParams.get('select_accounts'), null);
});

/* ---------------------------------------------------------------------------
 * fetchAds with fetch mocked
 * ------------------------------------------------------------------------ */

const ENV_KEYS = ['WINDSOR_API_KEY', 'WINDSOR_ACCOUNTS', 'ADS_LINE_RULES', 'DASHBOARD_TZ'];

function withEnv(values, fn) {
  const saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, values);
  const restore = () => {
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  };
  return Promise.resolve().then(fn).finally(restore);
}

function mockFetch(responder) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const r = typeof responder === 'function' ? await responder(String(url), init) : responder;
    const { status = 200, body = null } = r;
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('isConfigured / setupHint', () => withEnv({}, () => {
  assert.equal(isConfigured(), false);
  assert.match(setupHint(), /WINDSOR_API_KEY/);
  process.env.WINDSOR_API_KEY = '  ';
  assert.equal(isConfigured(), false);
  process.env.WINDSOR_API_KEY = 'abc';
  assert.equal(isConfigured(), true);
}));

test('fetchAds: unconfigured throws a SourceError with the env var in the hint', () => withEnv({}, async () => {
  await assert.rejects(fetchAds({ from: '2026-09-01', to: '2026-09-30', tz: 'America/Toronto' }),
    (e) => e instanceof SourceError && e.missingConfig === true && /WINDSOR_API_KEY/.test(e.hint));
}));

test('fetchAds: builds the request, normalises and reports meta', () => withEnv({ WINDSOR_API_KEY: 'secret', WINDSOR_ACCOUNTS: 'act_9', ADS_LINE_RULES: '[{"match":"brand","line":"hs_b2b"}]' }, async () => {
  const m = mockFetch({ status: 200, body: fixture });
  try {
    const out = await fetchAds({ from: '2026-08-31', to: '2026-10-01', tz: 'America/Toronto' });
    assert.equal(m.calls.length, 1);
    const u = new URL(m.calls[0].url);
    assert.equal(u.hostname, 'connectors.windsor.ai');
    assert.equal(u.searchParams.get('api_key'), 'secret');
    assert.equal(u.searchParams.get('date_from'), '2026-08-31');
    assert.equal(u.searchParams.get('date_to'), '2026-10-01');
    assert.equal(u.searchParams.get('select_accounts'), 'act_9');
    assert.equal(m.calls[0].init.cache, 'no-store');
    assert.ok(m.calls[0].init.signal, 'passes an abort signal');

    assert.equal(out.rows.length, 8);
    assert.equal(out.meta.fetchedRows, 14);
    assert.equal(out.meta.dropped, 4);
    assert.equal(out.meta.from, '2026-08-31');
    assert.equal(out.meta.to, '2026-10-01');
    // env rule applied: "Brand awareness" is hs_b2b now
    assert.equal(out.rows.find(r => r.campaignId === '666').line, 'hs_b2b');
    // real CLIENTS map: Ed is known, Zed is not
    assert.equal(out.rows.find(r => r.campaignId === '111').client, '(Ed) Protree Services LLC');
    assert.ok(out.meta.warnings.some(w => w.startsWith('campaign (Zed) Unknown Tree Co - Leads is not in lib/clients.js')));
    assert.ok(!out.meta.warnings.some(w => w.includes('(Ed) Protree')));
    assert.ok(out.meta.warnings.some(w => /matched no line rule/.test(w)));
  } finally { m.restore(); }
}));

test('fetchAds: bad ADS_LINE_RULES becomes a warning, not a failure', () => withEnv({ WINDSOR_API_KEY: 'k', ADS_LINE_RULES: 'not json' }, async () => {
  const m = mockFetch({ status: 200, body: { data: [] } });
  try {
    const out = await fetchAds({ from: '2026-09-01', to: '2026-09-02' });
    assert.deepEqual(out.rows, []);
    assert.equal(out.meta.warnings.length, 1);
    assert.match(out.meta.warnings[0], /ADS_LINE_RULES is not valid JSON/);
    assert.equal(new URL(m.calls[0].url).searchParams.get('select_accounts'), null);
  } finally { m.restore(); }
}));

test('fetchAds: 200 with { error }, missing data, HTTP errors and network errors all throw SourceError', () => withEnv({ WINDSOR_API_KEY: 'k' }, async () => {
  const range = { from: '2026-09-01', to: '2026-09-02' };
  let m = mockFetch({ status: 200, body: { error: 'Invalid API key' } });
  try {
    await assert.rejects(fetchAds(range), (e) => e instanceof SourceError && e.message === 'Windsor.ai: Invalid API key');
  } finally { m.restore(); }

  m = mockFetch({ status: 200, body: { message: 'nothing here' } });
  try {
    await assert.rejects(fetchAds(range), (e) => e instanceof SourceError && /no data array/.test(e.message));
  } finally { m.restore(); }

  m = mockFetch({ status: 401, body: { error: { message: 'Unauthorized' } } });
  try {
    await assert.rejects(fetchAds(range), (e) => e instanceof SourceError && e.status === 401 && /Windsor\.ai: 401 Unauthorized/.test(e.message));
  } finally { m.restore(); }

  m = mockFetch({ status: 200, body: 'not json at all' });
  try {
    await assert.rejects(fetchAds(range), (e) => e instanceof SourceError && /empty or non-JSON/.test(e.message));
  } finally { m.restore(); }

  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('ECONNRESET'); };
  try {
    await assert.rejects(fetchAds(range), (e) => e instanceof SourceError && /Windsor\.ai: ECONNRESET/.test(e.message));
  } finally { globalThis.fetch = original; }

  await assert.rejects(fetchAds({ from: '2026-09-02', to: '2026-09-01' }), /is after to/);
  await assert.rejects(fetchAds({ from: '09/01/2026', to: '2026-09-01' }), /must be YYYY-MM-DD/);
}));

test('fetchAllTimeAds: pulls from 2024-01-01 through today in the business timezone', () => withEnv({ WINDSOR_API_KEY: 'k' }, async () => {
  const m = mockFetch({ status: 200, body: { data: [{ date: '2025-05-05', campaign: 'B2B Home Service', campaign_id: '1', spend: '2' }] } });
  try {
    // 03:30Z on Sep 30 is still Sep 29 in Toronto
    const out = await fetchAllTimeAds({ tz: 'America/Toronto', now: new Date('2026-09-30T03:30:00Z') });
    const u = new URL(m.calls[0].url);
    assert.equal(ALL_TIME_FROM, '2024-01-01');
    assert.equal(u.searchParams.get('date_from'), '2024-01-01');
    assert.equal(u.searchParams.get('date_to'), '2026-09-29');
    assert.equal(out.rows.length, 1);
    assert.equal(out.rows[0].line, 'hs_b2b');
    assert.equal(out.meta.to, '2026-09-29');
  } finally { m.restore(); }
}));

test('ADS_EXCLUDE_CAMPAIGN_IDS drops those campaigns and reports the spend', async () => {
  const { normaliseRows } = await import('../lib/dashboard/sources/windsor.js');
  const raw = { data: [
    { date: '2026-09-29', campaign: 'B2B Tax - Firms', campaign_id: '111', spend: '10', clicks: 1, impressions: 10, actions_lead: 0 },
    { date: '2026-09-29', campaign: 'B2B Tax - Other business', campaign_id: '222', spend: '99', clicks: 1, impressions: 10, actions_lead: 0 },
  ] };
  const out = normaliseRows(raw, { excludeIds: new Set(['222']) });
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].campaignId, '111');
  assert.ok(out.meta.warnings.some(w => w.includes('ADS_EXCLUDE_CAMPAIGN_IDS') && w.includes('$99.00')));
});

test('WINDSOR_CLICK_FIELD swaps the click field in the request and the normaliser', async () => {
  const { buildUrl, normaliseRows, clickField } = await import('../lib/dashboard/sources/windsor.js');
  const prev = process.env.WINDSOR_CLICK_FIELD;
  process.env.WINDSOR_CLICK_FIELD = 'inline_link_clicks';
  try {
    assert.equal(clickField(), 'inline_link_clicks');
    const url = new URL(buildUrl({ apiKey: 'k', from: '2026-09-01', to: '2026-09-02' }));
    assert.ok(url.searchParams.get('fields').includes('inline_link_clicks'));
    assert.ok(!url.searchParams.get('fields').split(',').includes('clicks'));
    const out = normaliseRows({ data: [{ date: '2026-09-01', campaign: '(Ed) Protree Services LLC - A', campaign_id: '1', spend: 1, inline_link_clicks: 7, clicks: 99, impressions: 10, actions_lead: 0 }] });
    assert.equal(out.rows[0].clicks, 7);
  } finally {
    if (prev === undefined) delete process.env.WINDSOR_CLICK_FIELD; else process.env.WINDSOR_CLICK_FIELD = prev;
  }
  assert.equal(clickField('bad field!'), 'clicks');
});
