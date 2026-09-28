import React, { useState, useEffect, useMemo } from 'react';

// Client roster, short names, Airtable names and revenue rules come from
// /api/config (see lib/clients.js). They are fetched after sign-in instead of
// being compiled into this public page chunk.

// Revenue for one day of rows for a client, from its rule descriptor.
function revenueFor(client, { leads, days = 1 }) {
  if (!client || client.paused || !client.rule) return 0;
  const rule = client.rule;
  if (rule.type === 'perLead') return leads * rule.rate;
  if (rule.type === 'weekly') return (days / 7) * rule.perWeek;
  if (rule.type === 'tiered') {
    const lifetimeTotal = client.lifetimeTotal != null ? client.lifetimeTotal : leads;
    const lifetimeBefore = lifetimeTotal - leads;
    const tier1Remaining = Math.max(0, rule.tier1Leads - lifetimeBefore);
    const tier1Leads = Math.min(leads, tier1Remaining);
    const tier2Leads = leads - tier1Leads;
    return tier1Leads * rule.tier1Rate + tier2Leads * rule.tier2Rate;
  }
  return 0;
}

const isClientCampaign = (c) => c.startsWith('(');
const clientFromCampaign = (c) => isClientCampaign(c) ? c.replace(/\s*-\s*Tree Service.*$/, '') : c;

const fmt$ = (n) => '$' + (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtSigned$ = (n) => (n >= 0 ? '+' : '−') + '$' + Math.abs(n).toFixed(2);
const fmtPct = (n) => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
const fmtNum = (n) => (n ?? 0).toLocaleString();

const selectBase = {
  width: '100%', appearance: 'none', background: 'white',
  border: '1px solid #e8e3da', borderRadius: 11,
  padding: '10px 34px 10px 13px', fontSize: 13.5,
  color: '#1f1b16', fontFamily: 'inherit',
  cursor: 'pointer', outline: 'none',
};

const ChevronIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8a7d6b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const Select = ({ value, onChange, options }) => (
  <div style={{ position: 'relative' }}>
    <select value={value} onChange={(e) => onChange(e.target.value)} style={selectBase}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
    <ChevronIcon />
  </div>
);

export default function DailyBreakdown() {
  const [rows, setRows] = useState([]);
  const [leadsByKey, setLeadsByKey] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [leadsStats, setLeadsStats] = useState(null);
  const [campaignFilter, setCampaignFilter] = useState('All campaigns');
  const [clients, setClients] = useState({});

  const shortName = (full) => (clients[full] && clients[full].short) || full;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      fetch('/api/windsor').then(r => r.json()),
      fetch('/api/leads').then(r => r.json()),
      fetch('/api/config').then(r => r.json()),
    ])
      .then(([windsorData, leadsData, configData]) => {
        if (cancelled) return;
        if (configData.error) {
          setError('Config: ' + configData.error);
          setLoading(false);
          return;
        }
        if (windsorData.error) {
          setError('Windsor: ' + windsorData.error);
          setLoading(false);
          return;
        }
        if (leadsData.error) {
          setError('Airtable leads: ' + leadsData.error);
          setLoading(false);
          return;
        }
        setClients(configData.clients || {});
        setRows(windsorData.rows || []);
        setLeadsByKey(leadsData.leadsByKey || {});
        setLeadsStats(leadsData.stats || null);
        setFetchedAt(windsorData.fetched_at);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(String(err));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const earliestDate = useMemo(() => {
    if (rows.length === 0) return null;
    return rows.reduce((m, r) => r.date < m ? r.date : m, rows[0].date);
  }, [rows]);
  const latestDate = useMemo(() => {
    if (rows.length === 0) return null;
    return rows.reduce((m, r) => r.date > m ? r.date : m, rows[0].date);
  }, [rows]);

  // Get billed-lead count from Airtable for a given (windsorClient, date)
  const billedLeadsFor = (windsorClient, date) => {
    const airtableName = clients[windsorClient] && clients[windsorClient].airtable;
    if (!airtableName) return 0;
    return leadsByKey[`${airtableName}|${date}`] || 0;
  };

  const filteredRows = useMemo(() => {
    const filtered = rows.filter(r => {
      if (campaignFilter === 'All campaigns') return true;
      return clientFromCampaign(r.campaign) === campaignFilter;
    });
    const spendByCampaign = {};
    for (const r of filtered) {
      spendByCampaign[r.campaign] = (spendByCampaign[r.campaign] || 0) + r.spend;
    }
    return filtered.filter(r => spendByCampaign[r.campaign] > 0);
  }, [rows, campaignFilter]);

  const allClients = useMemo(() => {
    const spendByClient = {};
    for (const r of rows) {
      if (!isClientCampaign(r.campaign)) continue;
      const c = clientFromCampaign(r.campaign);
      spendByClient[c] = (spendByClient[c] || 0) + r.spend;
    }
    const active = Object.keys(spendByClient).filter(c => spendByClient[c] > 0).sort();
    return ['All campaigns', ...active];
  }, [rows]);

  const dailyRows = useMemo(() => {
    const out = filteredRows.map(r => {
      const client = clientFromCampaign(r.campaign);
      // Override Windsor's lead count with Airtable's billed lead count
      const leads = billedLeadsFor(client, r.date);
      const revenue = revenueFor(clients[client], { leads, days: 1 });
      const profit = revenue - r.spend;
      const margin = revenue > 0 ? (profit / revenue) * 100 : (r.spend > 0 ? -100 : 0);
      return {
        date: r.date,
        client,
        spend: r.spend,
        leads,
        cpl: leads > 0 ? r.spend / leads : null,
        revenue,
        profit,
        margin,
        clicks: r.clicks,
        cpc: r.clicks > 0 ? r.spend / r.clicks : 0,
        ctr: r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0,
        cpm: r.impressions > 0 ? (r.spend / r.impressions) * 1000 : 0,
        cvr: r.clicks > 0 ? (leads / r.clicks) * 100 : 0,
        impressions: r.impressions,
      };
    });
    return out.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return a.client.localeCompare(b.client);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredRows, leadsByKey, clients]);

  const totals = useMemo(() => {
    const t = dailyRows.reduce((acc, r) => ({
      spend: acc.spend + r.spend, leads: acc.leads + r.leads, revenue: acc.revenue + r.revenue,
      clicks: acc.clicks + r.clicks, impressions: acc.impressions + r.impressions,
    }), { spend:0, leads:0, revenue:0, clicks:0, impressions:0 });
    return {
      ...t,
      cpl: t.leads > 0 ? t.spend / t.leads : null,
      profit: t.revenue - t.spend,
      margin: t.revenue > 0 ? ((t.revenue - t.spend) / t.revenue) * 100 : 0,
      cpc: t.clicks > 0 ? t.spend / t.clicks : 0,
      ctr: t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0,
      cpm: t.impressions > 0 ? (t.spend / t.impressions) * 1000 : 0,
      cvr: t.clicks > 0 ? (t.leads / t.clicks) * 100 : 0,
    };
  }, [dailyRows]);

  const uniqueDays = useMemo(() => new Set(dailyRows.map(r => r.date)).size, [dailyRows]);
  const uniqueClients = useMemo(() => new Set(dailyRows.map(r => r.client)).size, [dailyRows]);

  const downloadCSV = () => {
    const headers = ['date','client','spend','leads','cpl','revenue','profit','margin_pct','clicks','cpc','ctr_pct','cpm','cvr_pct','impressions'];
    const rowsOut = dailyRows.map(r => [
      r.date,
      shortName('(' + r.client.slice(1)),
      r.spend.toFixed(2),
      r.leads,
      r.cpl != null ? r.cpl.toFixed(2) : '',
      r.revenue.toFixed(2),
      r.profit.toFixed(2),
      r.margin.toFixed(1),
      r.clicks,
      r.cpc.toFixed(2),
      r.ctr.toFixed(2),
      r.cpm.toFixed(2),
      r.cvr.toFixed(2),
      r.impressions,
    ]);
    const csv = [headers.join(','), ...rowsOut.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `clover-daily-all-time.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  // Footer rate-card summary, built from /api/config rather than hard-coded.
  const pricingLabel = useMemo(() => Object.values(clients)
    .filter(c => c && c.rule && !c.paused && c.rule.type !== 'none')
    .map(c => {
      const r = c.rule;
      if (r.type === 'perLead') return `${c.short} $${r.rate}`;
      if (r.type === 'weekly') return `${c.short} $${r.perWeek % 1000 === 0 ? (r.perWeek / 1000) + 'k' : r.perWeek}/week`;
      if (r.type === 'tiered') return `${c.short} tiered`;
      return null;
    })
    .filter(Boolean)
    .join(', '), [clients]);

  const lastSyncLabel = fetchedAt
    ? new Date(fetchedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—';

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f4f1ec',
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
      color: '#1f1b16',
      padding: '36px 28px 64px',
      WebkitFontSmoothing: 'antialiased',
    }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>

        <header style={{ marginBottom: 22 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', color: '#8a7d6b', textTransform: 'uppercase', marginBottom: 6 }}>
                Clover · B2C Performance
              </div>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em' }}>Daily breakdown · all time</h1>
              <div style={{ fontSize: 12, color: '#8a7d6b', marginTop: 4 }}>
                {earliestDate && latestDate ? `${earliestDate} → ${latestDate} · ${uniqueDays} day${uniqueDays !== 1 ? 's' : ''} · ${uniqueClients} active client${uniqueClients !== 1 ? 's' : ''} · ${dailyRows.length} rows` : '—'}
                {leadsStats && ` · ${leadsStats.billedLeads}/${leadsStats.totalLeads} leads billed`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <a href="/" style={{ fontSize: 12, padding: '7px 12px', background: 'transparent', color: '#1f1b16', border: '0.5px solid #d3cfc5', borderRadius: 8, textDecoration: 'none' }}>Tracker</a>
              <button style={{ fontSize: 12, padding: '7px 12px', background: '#1f1b16', color: '#f4f1ec', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Daily</button>
              <button onClick={downloadCSV} style={{ fontSize: 12, padding: '7px 12px', background: 'transparent', color: '#1f1b16', border: '0.5px solid #d3cfc5', borderRadius: 8, cursor: 'pointer' }}>Download CSV</button>
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: '#8a7d6b', marginTop: 8 }}>
            {loading ? 'Loading…' : `Fetched: ${lastSyncLabel}`}
          </div>
        </header>

        {error && (
          <div style={{ padding: 16, marginBottom: 18, background: '#f6e6e2', border: '1px solid #e8c8be', borderRadius: 14 }}>
            <div style={{ fontSize: 13, color: '#9a3924', fontWeight: 500 }}>Couldn't load data</div>
            <div style={{ fontSize: 12, color: '#5e5345', marginTop: 4 }}>{error}</div>
          </div>
        )}

        <div style={{ background: 'white', border: '1px solid #e8e3da', borderRadius: 14, padding: 12, marginBottom: 14 }}>
          <Select value={campaignFilter} onChange={setCampaignFilter} options={allClients} />
        </div>

        <div style={{ background: 'white', border: '1px solid #e8e3da', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr style={{ background: '#faf7f1' }}>
                  <Th>Date</Th>
                  <Th>Client</Th>
                  <Th align="right">Spend</Th>
                  <Th align="right">Leads</Th>
                  <Th align="right">CPL</Th>
                  <Th align="right">Revenue</Th>
                  <Th align="right">Profit</Th>
                  <Th align="right">Margin</Th>
                  <Th align="right">Clicks</Th>
                  <Th align="right">CPC</Th>
                  <Th align="right">CTR</Th>
                  <Th align="right">CPM</Th>
                  <Th align="right">CVR</Th>
                  <Th align="right">Impressions</Th>
                </tr>
              </thead>
              <tbody>
                {loading && (<tr><td colSpan={14} style={{ padding: 28, textAlign: 'center', color: '#8a7d6b' }}>Loading…</td></tr>)}
                {!loading && dailyRows.length === 0 && (<tr><td colSpan={14} style={{ padding: 28, textAlign: 'center', color: '#8a7d6b' }}>No rows match the current filter.</td></tr>)}
                {dailyRows.map((r, i) => {
                  const prev = dailyRows[i - 1];
                  const dateBreak = prev && prev.date !== r.date;
                  return (
                    <tr key={`${r.date}-${r.client}`} style={{ borderTop: dateBreak ? '1px solid #e8e3da' : (i === 0 ? 'none' : '0.5px solid #f4efe7') }}>
                      <Td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{r.date}</Td>
                      <Td style={{ whiteSpace: 'nowrap' }}>{shortName('(' + r.client.slice(1))}</Td>
                      <Td align="right">{fmt$(r.spend)}</Td>
                      <Td align="right" style={{ color: r.leads === 0 ? '#b94a3b' : '#1f1b16' }}>{r.leads}</Td>
                      <Td align="right">{r.cpl != null ? fmt$(r.cpl) : '—'}</Td>
                      <Td align="right">{fmt$(r.revenue)}</Td>
                      <Td align="right" style={{ color: r.profit >= 0 ? '#3a6b29' : '#9a3924' }}>{fmtSigned$(r.profit)}</Td>
                      <Td align="right" style={{ color: r.margin >= 0 ? '#3a6b29' : '#9a3924' }}>{fmtPct(r.margin)}</Td>
                      <Td align="right">{fmtNum(r.clicks)}</Td>
                      <Td align="right">{fmt$(r.cpc)}</Td>
                      <Td align="right">{r.ctr.toFixed(2)}%</Td>
                      <Td align="right">{fmt$(r.cpm)}</Td>
                      <Td align="right">{r.cvr.toFixed(2)}%</Td>
                      <Td align="right" style={{ color: '#8a7d6b' }}>{fmtNum(r.impressions)}</Td>
                    </tr>
                  );
                })}
                {dailyRows.length > 0 && (
                  <tr style={{ borderTop: '1.5px solid #efe9e0', background: '#faf7f1', fontWeight: 500 }}>
                    <Td style={{ fontWeight: 500 }}>Total</Td>
                    <Td style={{ color: '#8a7d6b' }}>{uniqueDays} day{uniqueDays !== 1 ? 's' : ''} · {uniqueClients} client{uniqueClients !== 1 ? 's' : ''}</Td>
                    <Td align="right">{fmt$(totals.spend)}</Td>
                    <Td align="right">{totals.leads}</Td>
                    <Td align="right">{totals.cpl != null ? fmt$(totals.cpl) : '—'}</Td>
                    <Td align="right">{fmt$(totals.revenue)}</Td>
                    <Td align="right" style={{ color: totals.profit >= 0 ? '#3a6b29' : '#9a3924' }}>{fmtSigned$(totals.profit)}</Td>
                    <Td align="right" style={{ color: totals.margin >= 0 ? '#3a6b29' : '#9a3924' }}>{fmtPct(totals.margin)}</Td>
                    <Td align="right">{fmtNum(totals.clicks)}</Td>
                    <Td align="right">{fmt$(totals.cpc)}</Td>
                    <Td align="right">{totals.ctr.toFixed(2)}%</Td>
                    <Td align="right">{fmt$(totals.cpm)}</Td>
                    <Td align="right">{totals.cvr.toFixed(2)}%</Td>
                    <Td align="right" style={{ color: '#8a7d6b' }}>{fmtNum(totals.impressions)}</Td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ fontSize: 11, color: '#a99c87', textAlign: 'center', marginTop: 20, lineHeight: 1.7 }}>
          All-time daily breakdown. Lead counts pulled from Airtable (billed leads only — $price, not Free/Replacement/Prepay/Unbilled). PROS counts all leads (flat retainer).<br />
          {pricingLabel ? `Pricing: ${pricingLabel}.` : null}
        </div>
      </div>
    </div>
  );
}

const Th = ({ children, align = 'left' }) => (
  <th style={{
    textAlign: align, padding: '9px 12px',
    fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
    color: '#8a7d6b', borderBottom: '1px solid #efe9e0', whiteSpace: 'nowrap',
  }}>{children}</th>
);

const Td = ({ children, align = 'left', style = {} }) => (
  <td style={{ padding: '8px 12px', textAlign: align, color: '#3a3128', ...style }}>{children}</td>
);
