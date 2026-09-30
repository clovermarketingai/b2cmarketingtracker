import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { LINE_LABEL } from '../lib/dashboard/catalog.js';
import { formatDay, formatTimestamp, formatValue, DASH } from '../lib/dashboard/format.js';
import { CSS } from '../components/dashboard/styles.js';
import RangeChips from '../components/dashboard/RangeChips.js';
import CeoTable from '../components/dashboard/CeoTable.js';
import SectionTable from '../components/dashboard/SectionTable.js';
import DetailTable from '../components/dashboard/DetailTable.js';
import SourcesPanel from '../components/dashboard/SourcesPanel.js';
import UnlockCard from '../components/dashboard/UnlockCard.js';
import Formulas from '../components/dashboard/Formulas.js';
import StatusPill, { healthPill } from '../components/dashboard/StatusPill.js';
import { withDemo, useDemoQuery } from '../components/dashboard/nav.js';

const DEFAULT_RANGE = 'mtd';
const RANGE_STORAGE_KEY = 'cc.range';

/** Build the /api/metrics URL for the current page mode. */
function metricsUrl({ refresh = false } = {}) {
  const params = new URLSearchParams();
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1') params.set('demo', '1');
  if (refresh) params.set('refresh', '1');
  const q = params.toString();
  return `/api/metrics${q ? `?${q}` : ''}`;
}

const CLIENT_COLUMNS = [
  { key: 'name', label: 'Client', text: true, render: (r) => (<>{r.name || r.key}{r.airtable && r.airtable !== r.name ? <small>{r.airtable}</small> : null}</>) },
  { key: 'health', label: 'Health', text: true, render: (r) => { const p = healthPill(r.health); return <StatusPill tone={p.tone} label={p.label} />; } },
  { key: 'spend', label: 'Spend', unit: 'currency' },
  { key: 'leads', label: 'Leads', unit: 'number' },
  { key: 'billed', label: 'Billed', unit: 'number' },
  { key: 'free', label: 'Free', unit: 'number' },
  { key: 'replacement', label: 'Replacement', unit: 'number' },
  { key: 'unbilled', label: 'Unbilled', unit: 'number' },
  { key: 'billedValue', label: 'Billed value', unit: 'currency' },
  { key: 'cplBilled', label: 'CPL billed', unit: 'currency' },
  { key: 'profit', label: 'Profit', unit: 'currency' },
  { key: 'margin', label: 'Margin', unit: 'percent' },
  { key: 'lastLeadDate', label: 'Last lead', text: true, render: (r) => (r.lastLeadDate ? formatDay(r.lastLeadDate, { year: false }) : DASH) },
  { key: 'daysSinceLastLead', label: 'Days since', unit: 'number' },
];

const CLOSER_COLUMNS = [
  { key: 'closer', label: 'Closer', text: true },
  { key: 'closes', label: 'Closes', unit: 'number' },
  { key: 'closeRate', label: 'Close rate', unit: 'percent' },
  { key: 'attempted', label: 'Attempted', unit: 'number' },
  { key: 'connected', label: 'Connected', unit: 'number' },
  { key: 'contactRate', label: 'Connect rate', unit: 'percent' },
  { key: 'offers', label: 'Offers', unit: 'number' },
  { key: 'prospects', label: 'Prospects', unit: 'number' },
  { key: 'contacted', label: 'Contacted', unit: 'number' },
  { key: 'prospectContactRate', label: 'Contacted %', unit: 'percent' },
  { key: 'booked', label: 'Booked', unit: 'number' },
  { key: 'speedToLead', label: 'Speed to lead', unit: 'seconds' },
  { key: 'eods', label: 'EODs', unit: 'number' },
];

const CAMPAIGN_COLUMNS = [
  { key: 'campaign', label: 'Campaign', text: true, render: (r) => (<>{r.campaign || r.campaignId || '(unnamed)'}{r.client ? <small>{r.client}</small> : null}</>) },
  { key: 'line', label: 'Line', text: true, render: (r) => LINE_LABEL[r.line] || r.line || DASH },
  { key: 'spend', label: 'Spend', unit: 'currency' },
  { key: 'fbLeads', label: 'FB leads', unit: 'number' },
  { key: 'cpl', label: 'CPL', unit: 'currency' },
  { key: 'clicks', label: 'Clicks', unit: 'number' },
  { key: 'cpc', label: 'CPC', unit: 'currency' },
  { key: 'impressions', label: 'Impressions', unit: 'number' },
  { key: 'ctr', label: 'CTR', unit: 'percent' },
  { key: 'rows', label: 'Days', unit: 'number', title: 'Days with a report row' },
];

const WHOP_COLUMNS = [
  { key: 'product', label: 'Product', text: true },
  { key: 'gross', label: 'Cash collected', unit: 'currency' },
  { key: 'refunded', label: 'Refunded', unit: 'currency' },
  { key: 'count', label: 'Payments', unit: 'number' },
];

function Block({ id, title, subtitle, tools, children, bodyPad = true }) {
  return (
    <section className="cc-block" id={id} aria-labelledby={`${id}-h`}>
      <header className="cc-head">
        <h2 id={`${id}-h`}>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
        {tools ? <div className="cc-head-tools">{tools}</div> : null}
      </header>
      {bodyPad ? <div className="cc-body">{children}</div> : children}
    </section>
  );
}

export default function CommandCenter() {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState(DEFAULT_RANGE);
  const demoQuery = useDemoQuery(); // keep ?demo=1 on the page links

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const r = await fetch(metricsUrl({ refresh }), { credentials: 'same-origin', cache: 'no-store' });
      if (r.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }
      let data = null;
      try { data = await r.json(); } catch { data = null; }
      if (!r.ok || !data || data.error) {
        setError((data && (data.message || data.error)) || `Could not load metrics (${r.status}).`);
      } else {
        setPayload(data);
      }
    } catch {
      setError('Network error while loading metrics.');
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(RANGE_STORAGE_KEY);
      if (saved && ['today', 'yesterday', 'l7d', 'l30d', 'mtd', 'lastMonth'].includes(saved)) setRange(saved);
    } catch { /* storage unavailable */ }
    load();
  }, [load]);

  const changeRange = (id) => {
    setRange(id);
    try { window.localStorage.setItem(RANGE_STORAGE_KEY, id); } catch { /* ignore */ }
  };

  const lockCeo = async () => {
    try { await fetch('/api/ceo', { method: 'DELETE', credentials: 'same-origin' }); } catch { /* ignore */ }
    load();
  };

  const p = payload;
  const selected = p && p.ranges && p.ranges[range] ? range : DEFAULT_RANGE;
  const ceoLocked = !!(p && p.ceo && p.ceo.locked);
  const demo = !!(p && p.mode === 'demo');

  const formulaGroups = useMemo(() => {
    if (!p) return [];
    const groups = [];
    if (p.ceo && !p.ceo.locked && p.ceo.rows) groups.push({ id: 'ceo', title: p.ceo.title || 'CEO', rows: p.ceo.rows });
    for (const s of p.sections || []) groups.push({ id: s.id, title: s.title, rows: s.rows });
    return groups;
  }, [p]);

  const sourceSummary = useMemo(() => {
    if (!p || !p.sources) return null;
    const counts = {};
    for (const s of Object.values(p.sources)) counts[s.status] = (counts[s.status] || 0) + 1;
    return counts;
  }, [p]);

  return (
    <div className="cc">
      <Head><title>Clover · Command Center</title></Head>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="cc-top">
        <div className="cc-top-in">
          <div>
            <div className="cc-title">Command Center</div>
            <div className="cc-sub">
              {p ? `${formatDay(p.today, { weekday: true })} · ${p.tz}` : 'Loading…'}
              {demo ? ' · demo data' : ''}
            </div>
          </div>
          <nav className="cc-nav" aria-label="Command Center pages">
            <a href={withDemo('/', demoQuery)} className="on">Command Center</a>
            <a href={withDemo('/daily', demoQuery)}>Daily breakdown</a>
            <a href="#sources">Data sources</a>
          </nav>
          <div className="cc-top-right">
            <span className="cc-asof">Data as of <b>{p && p.generatedAt ? formatTimestamp(p.generatedAt, p.tz) : DASH}</b></span>
            <button type="button" className="cc-btn" onClick={() => load({ refresh: true })} disabled={loading || refreshing} aria-label="Refresh every data source">
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      <main className="cc-wrap">
        {error ? (
          <div className="cc-banner err" role="alert">
            <strong>Could not load the dashboard.</strong> {error}{' '}
            <button type="button" className="cc-btn" style={{ marginLeft: 8 }} onClick={() => load()}>Try again</button>
          </div>
        ) : null}

        {demo ? <div className="cc-banner info" role="status">Demo data: every number on this page is synthetic. Remove <code>?demo=1</code> to see live sources.</div> : null}

        {!p && loading ? <div className="cc-block cc-skel" aria-busy="true">Loading the Command Center…</div> : null}

        {p ? (
          <>
            <RangeChips ranges={p.ranges} value={selected} onChange={changeRange} />

            <Block
              id="ceo"
              title="CEO today — Total company"
              subtitle={p.ceo && p.ceo.subtitle ? p.ceo.subtitle : 'Cash in, every tracked cost, and what is left.'}
              tools={!ceoLocked && p.ceoConfigured ? <button type="button" className="cc-btn" onClick={lockCeo}>Lock</button> : null}
              bodyPad={!ceoLocked}
            >
              {ceoLocked
                ? <UnlockCard configured={p.ceoConfigured} onUnlocked={() => load()} />
                : <CeoTable section={p.ceo} ranges={p.ranges} series={p.series} selected={selected} />}
            </Block>

            {(p.sections || []).map(s => (
              <Block key={s.id} id={`section-${s.id}`} title={s.title} subtitle={s.subtitle}>
                <SectionTable section={s} weeks={p.weeks} ranges={p.ranges} series={p.series} selected={selected} />
              </Block>
            ))}

            <Block id="clients" title="Clients (MTD)" subtitle="Every Home Service client with spend or leads this month. Health: at risk = spend but no lead in 3 days; stalled = no lead in 7 days.">
              <DetailTable label="Clients, month to date" columns={CLIENT_COLUMNS} rows={p.tables?.clients || []} rowKey="key" defaultSort={{ key: 'spend', dir: 'desc' }} empty="No client activity this month." />
            </Block>

            <Block id="closers" title="Closers (MTD)" subtitle="Closer EOD reports joined to the Prospect table by closer name.">
              <DetailTable label="Closers, month to date" columns={CLOSER_COLUMNS} rows={p.tables?.closers || []} rowKey="closer" defaultSort={{ key: 'closes', dir: 'desc' }} empty="No closer activity this month." />
            </Block>

            <Block id="campaigns" title="Campaigns (MTD)" subtitle="Every ad campaign with spend this month and the line it was classified into.">
              <DetailTable label="Campaigns, month to date" columns={CAMPAIGN_COLUMNS} rows={p.tables?.campaigns || []} rowKey={(r) => r.campaignId || r.campaign} defaultSort={{ key: 'spend', dir: 'desc' }} empty="No campaign spend this month." />
            </Block>

            <Block id="whop" title="Whop products (MTD)" subtitle="Cash collected per product from Whop payments.">
              <DetailTable label="Whop products, month to date" columns={WHOP_COLUMNS} rows={p.tables?.whopProducts || []} rowKey="product" defaultSort={{ key: 'gross', dir: 'desc' }} empty="No Whop payments this month." />
            </Block>

            <Block
              id="sources"
              title="Data sources"
              subtitle={sourceSummary ? Object.entries(sourceSummary).map(([k, n]) => `${n} ${k}`).join(' · ') : ''}
              bodyPad={false}
            >
              <SourcesPanel sources={p.sources} warnings={p.warnings || []} tz={p.tz} />
            </Block>

            <Formulas groups={formulaGroups} />

            <footer className="cc-foot">
              <span>Month {p.month} · {formatValue((p.elapsedFraction || 0) * 100, 'percent')} elapsed</span>
              <span>Generated {p.generatedAt ? formatTimestamp(p.generatedAt, p.tz) : DASH}</span>
              <span>Times in {p.tz}</span>
            </footer>
          </>
        ) : null}
      </main>
    </div>
  );
}
