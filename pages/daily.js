import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { CSS } from '../components/dashboard/styles.js';
import StatusPill, { sourceTone } from '../components/dashboard/StatusPill.js';
import { formatValue, formatTimestamp, formatDay, DASH } from '../lib/dashboard/format.js';

// All-time daily breakdown, one row per (date, client). Everything is computed
// server-side by /api/daily (lib/dashboard/daily.js); this page only renders,
// filters and exports.

const COLUMNS = [
  { key: 'spend', label: 'Spend', unit: 'currency' },
  { key: 'leads', label: 'Leads', unit: 'number', title: 'Every lead created that day (local date)' },
  { key: 'billed', label: 'Billed', unit: 'number', title: 'Leads whose Lead Cost is a price; every lead for retainer clients' },
  { key: 'free', label: 'Free', unit: 'number' },
  { key: 'replacement', label: 'Repl.', unit: 'number', title: 'Replacement leads' },
  { key: 'unbilled', label: 'Unbilled', unit: 'number', title: 'Unbilled, blank or unrecognised Lead Cost' },
  { key: 'cpl', label: 'CPL', unit: 'currency', title: 'Spend ÷ billed leads' },
  { key: 'revenue', label: 'Revenue', unit: 'currency', title: 'Σ Lead Cost of billed leads + retainer ÷ 7' },
  { key: 'profit', label: 'Profit', unit: 'currency', signed: true },
  { key: 'margin', label: 'Margin', unit: 'percent', signed: true },
  { key: 'fbLeads', label: 'FB leads', unit: 'number', title: 'Facebook-reported leads (reconciliation only)' },
  { key: 'clicks', label: 'Clicks', unit: 'number' },
  { key: 'cpc', label: 'CPC', unit: 'currency' },
  { key: 'ctr', label: 'CTR', unit: 'percent' },
  { key: 'cpm', label: 'CPM', unit: 'currency' },
  { key: 'cvr', label: 'CVR', unit: 'percent', title: 'Billed leads ÷ clicks' },
  { key: 'impressions', label: 'Impr.', unit: 'number' },
];

const CSV_COLUMNS = ['date', 'client', 'campaigns', 'spend', 'leads', 'billed', 'free', 'replacement', 'prepay', 'unbilled', 'cpl', 'revenue', 'leadRevenue', 'retainer', 'profit', 'margin', 'fbLeads', 'clicks', 'cpc', 'ctr', 'cpm', 'cvr', 'impressions'];

function csvCell(v) {
  if (v == null) return '';
  let s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // no spreadsheet formula injection from upstream names
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function Cell({ row, col }) {
  const v = row[col.key];
  const text = formatValue(v, col.unit);
  let cls = 'cc-num';
  if (col.signed && typeof v === 'number') cls += v >= 0 ? ' cc-delta good' : ' cc-delta bad';
  if (col.key === 'leads' && v === 0 && row.spend > 0) cls += ' cc-delta bad';
  return <td className={cls} title={col.title}>{col.signed && typeof v === 'number' && v > 0 ? `+${text}` : text}</td>;
}

export default function DailyBreakdown() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [client, setClient] = useState('all');

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (new URLSearchParams(window.location.search).get('demo') === '1') params.set('demo', '1');
      if (refresh) params.set('refresh', '1');
      const q = params.toString();
      const r = await fetch(`/api/daily${q ? `?${q}` : ''}`, { credentials: 'same-origin', cache: 'no-store' });
      if (r.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent('/daily')}`;
        return;
      }
      let json = null;
      try { json = await r.json(); } catch { json = null; }
      if (!r.ok || !json || json.error) setError((json && (json.message || json.error)) || `Could not load (${r.status}).`);
      else setData(json);
    } catch {
      setError('Network error while loading the daily breakdown.');
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    return client === 'all' ? data.rows : data.rows.filter(r => r.client === client);
  }, [data, client]);

  const totals = useMemo(() => {
    if (!data) return null;
    if (client === 'all') return data.totals;
    const t = rows.reduce((acc, r) => {
      for (const k of ['spend', 'clicks', 'impressions', 'fbLeads', 'leads', 'billed', 'free', 'replacement', 'prepay', 'unbilled', 'revenue']) acc[k] += r[k] || 0;
      return acc;
    }, { spend: 0, clicks: 0, impressions: 0, fbLeads: 0, leads: 0, billed: 0, free: 0, replacement: 0, prepay: 0, unbilled: 0, revenue: 0 });
    const d = (a, b) => (b ? a / b : null);
    return {
      ...t,
      cpl: d(t.spend, t.billed), profit: t.revenue - t.spend, margin: t.revenue ? ((t.revenue - t.spend) / t.revenue) * 100 : null,
      cpc: d(t.spend, t.clicks), ctr: t.impressions ? (t.clicks / t.impressions) * 100 : null,
      cpm: t.impressions ? (t.spend / t.impressions) * 1000 : null, cvr: t.clicks ? (t.billed / t.clicks) * 100 : null,
      days: new Set(rows.map(r => r.date)).size, clients: new Set(rows.map(r => r.client)).size,
    };
  }, [data, rows, client]);

  const earliest = rows.length ? rows[rows.length - 1].date : null;
  const latest = rows.length ? rows[0].date : null;

  const downloadCSV = () => {
    const lines = [CSV_COLUMNS.join(',')];
    for (const r of rows) lines.push(CSV_COLUMNS.map(k => csvCell(k === 'client' ? r.name : r[k])).join(','));
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `clover-daily-${client === 'all' ? 'all-clients' : client.replace(/[^a-z0-9]+/gi, '-')}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="cc">
      <Head><title>Clover · Daily breakdown</title></Head>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="cc-top">
        <div className="cc-top-in">
          <div>
            <div className="cc-title">Daily breakdown</div>
            <div className="cc-sub">
              {data ? `${data.from} → ${data.today} · ${data.tz}` : 'Home Service · all time'}
              {totals ? ` · ${totals.days} day${totals.days === 1 ? '' : 's'} · ${totals.clients} client${totals.clients === 1 ? '' : 's'} · ${rows.length} rows` : ''}
            </div>
          </div>
          <div className="cc-top-right">
            <nav className="cc-nav" aria-label="Pages">
              <a href="/">Command Center</a>
              <a href="/daily" className="on">Daily breakdown</a>
              <a href="/#sources">Data sources</a>
            </nav>
            <span className="cc-asof">{loading ? 'Loading…' : data ? <>Data as of <b>{formatTimestamp(data.fetched_at, data.tz)}</b></> : null}</span>
            <button type="button" className="cc-btn" onClick={() => load({ refresh: true })} disabled={loading || refreshing}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
            <button type="button" className="cc-btn cc-btn-primary" onClick={downloadCSV} disabled={!rows.length}>Download CSV</button>
          </div>
        </div>
      </div>

      <div className="cc-wrap">
        {error ? <div className="cc-banner err" role="alert">{error}</div> : null}
        {data && data.warnings && data.warnings.length ? (
          <div className="cc-banner warn">
            <b>Data notes</b>
            <ul>{data.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </div>
        ) : null}

        <div className="cc-chips" role="group" aria-label="Client filter">
          <span className="cc-chips-label">Client</span>
          <button type="button" className="cc-chip" aria-pressed={client === 'all'} onClick={() => setClient('all')}>All clients</button>
          {(data ? data.clientOptions : []).map(c => (
            <button key={c.key} type="button" className="cc-chip" aria-pressed={client === c.key} onClick={() => setClient(c.key)} title={c.unmapped ? 'Not in lib/clients.js' : undefined}>
              {c.name}{c.unmapped ? ' ?' : ''}
            </button>
          ))}
          {data ? (
            <span className="cc-chip-dates">
              {Object.entries(data.sources).map(([k, s]) => (
                <span key={k} style={{ marginLeft: 8 }}><StatusPill tone={sourceTone(s.status)} label={`${s.label}: ${s.status}`} title={s.error || s.hint || undefined} /></span>
              ))}
            </span>
          ) : null}
        </div>

        <section className="cc-block" aria-labelledby="daily-h">
          <header className="cc-head">
            <h2 id="daily-h">Home Service — daily P&amp;L by client</h2>
            <p>One row per client per day. Spend is summed across the client&apos;s campaigns; leads are counted once, on their local date. Revenue is the Lead Cost of billed leads plus retainers ÷ 7.</p>
          </header>
          <div className="cc-scroll">
            <table className="cc-tbl">
              <thead>
                <tr>
                  <th scope="col">Date · client</th>
                  {COLUMNS.map(c => <th key={c.key} scope="col" title={c.title}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={COLUMNS.length + 1} className="cc-empty">Loading…</td></tr> : null}
                {!loading && rows.length === 0 ? <tr><td colSpan={COLUMNS.length + 1} className="cc-empty">No rows.</td></tr> : null}
                {rows.map((r, i) => {
                  const dateBreak = i > 0 && rows[i - 1].date !== r.date;
                  return (
                    <tr key={`${r.date}|${r.client}`} style={dateBreak ? { boxShadow: 'inset 0 2px 0 #d9dce2' } : undefined}>
                      <td>
                        <div className="cc-metric"><span className="cc-metric-label"><b>{formatDay(r.date, { weekday: true })}</b><span className="cc-metric-note">{r.name}{r.campaigns > 1 ? ` · ${r.campaigns} campaigns` : ''}{r.unmapped ? ' · not in rate card' : ''}</span></span></div>
                      </td>
                      {COLUMNS.map(c => <Cell key={c.key} row={r} col={c} />)}
                    </tr>
                  );
                })}
              </tbody>
              {totals && rows.length ? (
                <tfoot>
                  <tr className="cc-primary">
                    <td>Total · {totals.days} day{totals.days === 1 ? '' : 's'} · {totals.clients} client{totals.clients === 1 ? '' : 's'}</td>
                    {COLUMNS.map(c => <Cell key={c.key} row={totals} col={c} />)}
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </section>

        <p className="cc-foot">
          {earliest && latest ? `${formatDay(earliest)} → ${formatDay(latest)}. ` : ''}
          Billed = Lead Cost is a price (retainer clients: every lead, revenue from the weekly retainer). Free, Replacement, Prepay, Unbilled and blank Lead Cost never bill. Dates are the business day in {data ? data.tz : 'the business timezone'}. {DASH} means not computable.
        </p>
      </div>
    </div>
  );
}
