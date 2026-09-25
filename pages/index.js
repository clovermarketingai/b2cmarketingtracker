import React, { useState, useEffect, useMemo, useCallback } from 'react';

const FALLBACK_CLOSERS = ['Tyler', 'Jeshua'];
const DATE_PRESETS = ['Today', 'Yesterday', 'Last 7 days', 'Last 14 days', 'Last 30 days', 'Month to date', 'Custom'];

// Prospect statuses that mean "we haven't contacted them yet"
const UNCONTACTED_STATUSES = new Set(['Hotlist', 'Follow Up']);

const pad2 = (n) => String(n).padStart(2, '0');
const toISODate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayISO = () => toISODate(new Date());
const fmtPct1 = (n) => n.toFixed(1) + '%';

// Format seconds → "X sec", "X min", "X hr Y min"
function fmtSpeedToLead(seconds) {
  if (seconds == null || isNaN(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} sec`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  const hours = Math.floor(s / 3600);
  const mins = Math.round((s % 3600) / 60);
  return mins > 0 ? `${hours} hr ${mins} min` : `${hours} hr`;
}

function presetToRange(preset) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === 'Today') return { start: toISODate(today), end: toISODate(today) };
  if (preset === 'Yesterday') {
    const y = new Date(today); y.setDate(y.getDate() - 1);
    return { start: toISODate(y), end: toISODate(y) };
  }
  if (preset === 'Last 7 days') {
    const s = new Date(today); s.setDate(s.getDate() - 6);
    return { start: toISODate(s), end: toISODate(today) };
  }
  if (preset === 'Last 14 days') {
    const s = new Date(today); s.setDate(s.getDate() - 13);
    return { start: toISODate(s), end: toISODate(today) };
  }
  if (preset === 'Last 30 days') {
    const s = new Date(today); s.setDate(s.getDate() - 29);
    return { start: toISODate(s), end: toISODate(today) };
  }
  if (preset === 'Month to date') {
    const s = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start: toISODate(s), end: toISODate(today) };
  }
  return { start: null, end: null };
}

function dateInRange(iso, range) {
  if (!iso) return false;
  if (!range || !range.start || !range.end) return true;
  const datePart = iso.includes('T') ? iso.slice(0, 10) : iso;
  return datePart >= range.start && datePart <= range.end;
}

// Contact rate from Prospect statuses, all-time, per closer
// closer can be 'All' to mean every closer combined
function computeContactRate(prospects, closer) {
  const filtered = prospects.filter(p => closer === 'All' || p.closer === closer);
  const total = filtered.length;
  if (total === 0) return { total: 0, contacted: 0, uncontacted: 0, rate: 0 };
  const uncontacted = filtered.filter(p => UNCONTACTED_STATUSES.has(p.status)).length;
  const contacted = total - uncontacted;
  return { total, contacted, uncontacted, rate: (contacted / total) * 100 };
}

// Speed to Lead — average seconds between lead landing (Created At) and first call (Time Called)
// Only includes prospects that have BOTH created + speedToLead value set, and Created At in the window.
function computeSpeedToLead(prospects, closer, dateRange) {
  const eligible = prospects.filter(p =>
    (closer === 'All' || p.closer === closer) &&
    p.speedToLead != null &&
    dateInRange(p.createdAt, dateRange)
  );
  const called = eligible.length;
  if (called === 0) return { avgSec: null, called: 0, totalInWindow: 0 };
  const sum = eligible.reduce((s, p) => s + p.speedToLead, 0);
  // How many prospects landed in this window overall (called or not)?
  const totalInWindow = prospects.filter(p =>
    (closer === 'All' || p.closer === closer) && dateInRange(p.createdAt, dateRange)
  ).length;
  return { avgSec: sum / called, called, totalInWindow };
}

export default function CloserTracker() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [entries, setEntries] = useState([]);
  const [prospects, setProspects] = useState([]);
  const [closersFromAirtable, setClosersFromAirtable] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetch('/api/eod-list').then(r => r.json()),
      fetch('/api/prospects').then(r => r.json()).catch(() => ({ prospects: [], closers: [] })),
    ])
      .then(([eodData, prospectsData]) => {
        if (eodData.error) {
          setError('EOD: ' + eodData.error + (eodData.body ? ': ' + eodData.body : ''));
        } else {
          setEntries(eodData.entries || []);
        }
        if (prospectsData && !prospectsData.error) {
          setProspects(prospectsData.prospects || []);
          setClosersFromAirtable(prospectsData.closers || []);
        }
        setFetchedAt(eodData.fetched_at || null);
        setLoading(false);
      })
      .catch(err => { setError(String(err)); setLoading(false); });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const closers = useMemo(() => {
    const s = new Set(closersFromAirtable);
    for (const e of entries) if (e.closer) s.add(e.closer);
    const list = Array.from(s).sort();
    return list.length > 0 ? list : FALLBACK_CLOSERS;
  }, [closersFromAirtable, entries]);

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f4f1ec',
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
      color: '#1f1b16',
      padding: '36px 28px 64px',
      WebkitFontSmoothing: 'antialiased',
      lineHeight: 1.5,
    }}>
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>

        <header style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', color: '#8a7d6b', textTransform: 'uppercase', marginBottom: 6 }}>
              Clover · Closer Performance
            </div>
            <h1 style={{ margin: 0, fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em' }}>Closer Dashboard</h1>
            <div style={{ fontSize: 12, color: '#8a7d6b', marginTop: 4 }}>
              {loading ? 'Loading…' : fetchedAt ? `Live from Airtable · synced ${new Date(fetchedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : 'Live from Airtable'}
            </div>
          </div>
          <button onClick={refresh} style={{
            fontSize: 12, padding: '8px 14px', background: 'transparent', color: '#1f1b16',
            border: '1px solid #d3cfc5', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
          }}>Refresh</button>
        </header>

        <Tabs activeTab={activeTab} setActiveTab={setActiveTab} />

        {error && (
          <div style={{ padding: 14, marginBottom: 16, background: '#f6e6e2', border: '1px solid #e8c8be', borderRadius: 12, fontSize: 12.5 }}>
            <div style={{ color: '#9a3924', fontWeight: 500 }}>Couldn't load data</div>
            <div style={{ color: '#5e5345', marginTop: 4 }}>{error}</div>
          </div>
        )}

        {activeTab === 'dashboard' && <Dashboard entries={entries} prospects={prospects} closers={closers} loading={loading} />}
        {activeTab === 'leaderboard' && <Leaderboard entries={entries} prospects={prospects} closers={closers} />}
        {activeTab === 'eod' && <EodForm entries={entries} closers={closers} onSubmitted={refresh} />}

        <div style={{ fontSize: 11.5, color: '#a99c87', textAlign: 'center', marginTop: 28, lineHeight: 1.7 }}>
          Calls, offers, closes & close rate from Closer EOD (date-filtered). Contact rate from Prospect statuses (all-time, per closer). Speed to Lead from Prospect Created At → Time Called (date-filtered by lead arrival).
        </div>

      </div>
    </div>
  );
}

function Tabs({ activeTab, setActiveTab }) {
  const tabs = [
    { id: 'dashboard',  label: 'Dashboard' },
    { id: 'leaderboard',label: 'Leaderboard' },
    { id: 'eod',        label: 'EOD Report' },
  ];
  return (
    <div style={{
      display: 'flex', gap: 4, marginBottom: 18, padding: 4,
      background: '#ece8df', borderRadius: 11, width: 'fit-content',
    }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
          padding: '9px 18px', border: 'none',
          background: activeTab === t.id ? 'white' : 'transparent',
          color: activeTab === t.id ? '#1f1b16' : '#5e5345',
          fontSize: 13, fontWeight: 500,
          borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
          boxShadow: activeTab === t.id ? '0 1px 3px rgba(0,0,0,0.04)' : 'none',
        }}>{t.label}</button>
      ))}
    </div>
  );
}

function DateFilter({ datePreset, setDatePreset, customStart, setCustomStart, customEnd, setCustomEnd }) {
  if (datePreset === 'Custom') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <SelectInline value={datePreset} onChange={setDatePreset} options={DATE_PRESETS} />
        <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} style={{ ...inputStyle, cursor: 'text' }} />
        <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} style={{ ...inputStyle, cursor: 'text' }} />
      </div>
    );
  }
  return <SelectInline value={datePreset} onChange={setDatePreset} options={DATE_PRESETS} />;
}

function Dashboard({ entries, prospects, closers, loading }) {
  const [closer, setCloser] = useState('All');
  const [datePreset, setDatePreset] = useState('Last 7 days');
  const [customStart, setCustomStart] = useState(todayISO());
  const [customEnd, setCustomEnd] = useState(todayISO());

  useEffect(() => {
    if (closer !== 'All' && closers.length > 0 && !closers.includes(closer)) {
      setCloser('All');
    }
  }, [closers, closer]);

  const dateRange = useMemo(() => {
    if (datePreset === 'Custom') return { start: customStart, end: customEnd };
    return presetToRange(datePreset);
  }, [datePreset, customStart, customEnd]);

  const closerOptions = useMemo(() => ['All', ...closers], [closers]);

  const filteredEod = useMemo(() =>
    entries.filter(e =>
      (closer === 'All' || e.closer === closer) && dateInRange(e.date, dateRange)
    ),
    [entries, closer, dateRange]
  );

  const calls = filteredEod.reduce((s, e) => s + e.calls, 0);
  const offers = filteredEod.reduce((s, e) => s + e.offers, 0);
  const closes = filteredEod.reduce((s, e) => s + e.closes, 0);
  const closeRate = calls > 0 ? (closes / calls) * 100 : 0;

  // Contact rate is all-time, NOT date-filtered, per closer
  const contact = useMemo(() => computeContactRate(prospects, closer), [prospects, closer]);

  // Speed to Lead IS date-filtered (by Created At)
  const speed = useMemo(() => computeSpeedToLead(prospects, closer, dateRange), [prospects, closer, dateRange]);

  const closeRateGood = calls > 0 && closeRate >= 20;
  const contactRateGood = contact.total > 0 && contact.rate >= 80;
  const speedGood = speed.avgSec != null && speed.avgSec <= 300; // 5 min or better

  return (
    <>
      <div style={{ background: 'white', border: '1px solid #e8e3da', borderRadius: 14, padding: 12, marginBottom: 18, display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 10, alignItems: 'start' }}>
        <SelectInline value={closer} onChange={setCloser} options={closerOptions} />
        <DateFilter
          datePreset={datePreset} setDatePreset={setDatePreset}
          customStart={customStart} setCustomStart={setCustomStart}
          customEnd={customEnd} setCustomEnd={setCustomEnd}
        />
      </div>

      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.14em', color: '#8a7d6b', textTransform: 'uppercase', marginBottom: 10, paddingLeft: 4 }}>
        Performance
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 22 }}>
        <Kpi
          label="Calls Connected"
          value={calls}
          sub={`${filteredEod.length} EOD ${filteredEod.length === 1 ? 'entry' : 'entries'}`}
        />
        <Kpi
          label="Offers Given"
          value={offers}
          sub={calls > 0 ? `${offers}/${calls} calls` : '—'}
        />
        <Kpi
          label="Closes"
          value={closes}
          sub={offers > 0 ? `${closes}/${offers} offers` : '—'}
          tone="accent"
        />
        <Kpi
          label="Close Rate"
          value={calls > 0 ? fmtPct1(closeRate) : '—'}
          sub={calls > 0 ? 'closes ÷ calls' : 'No calls in window'}
          tone={closeRateGood ? 'good' : 'default'}
        />
        <Kpi
          label="Contact Rate"
          value={contact.total > 0 ? fmtPct1(contact.rate) : '—'}
          sub={contact.total > 0 ? `${contact.contacted}/${contact.total} prospects (all-time)` : 'No prospects assigned'}
          tone={contactRateGood ? 'good' : 'default'}
        />
        <Kpi
          label="Speed to Lead"
          value={fmtSpeedToLead(speed.avgSec)}
          sub={speed.called > 0 ? `${speed.called}/${speed.totalInWindow} leads called` : 'No leads called in window'}
          tone={speedGood ? 'good' : 'default'}
        />
      </div>

      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.14em', color: '#8a7d6b', textTransform: 'uppercase', marginBottom: 10, paddingLeft: 4 }}>
        Recent EOD submissions
      </div>
      <Card>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#8a7d6b', fontSize: 13 }}>Loading…</div>
        ) : filteredEod.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#8a7d6b', fontSize: 13 }}>No submissions in this window.</div>
        ) : (
          filteredEod.map((e, i) => <PastEntry key={e.id} entry={e} first={i === 0} />)
        )}
      </Card>
    </>
  );
}

function Leaderboard({ entries, prospects, closers }) {
  const [datePreset, setDatePreset] = useState('Last 7 days');
  const [customStart, setCustomStart] = useState(todayISO());
  const [customEnd, setCustomEnd] = useState(todayISO());

  const dateRange = useMemo(() => {
    if (datePreset === 'Custom') return { start: customStart, end: customEnd };
    return presetToRange(datePreset);
  }, [datePreset, customStart, customEnd]);

  const rows = closers.map(c => {
    const filteredEod = entries.filter(e => e.closer === c && dateInRange(e.date, dateRange));
    const calls = filteredEod.reduce((s, e) => s + e.calls, 0);
    const offers = filteredEod.reduce((s, e) => s + e.offers, 0);
    const closes = filteredEod.reduce((s, e) => s + e.closes, 0);
    const contact = computeContactRate(prospects, c);
    const speed = computeSpeedToLead(prospects, c, dateRange);
    return {
      closer: c,
      calls, offers, closes,
      closeRate: calls > 0 ? (closes / calls) * 100 : 0,
      contactRate: contact.rate,
      contactTotal: contact.total,
      speedAvgSec: speed.avgSec,
      speedCalled: speed.called,
    };
  }).sort((a, b) => {
    if (b.closeRate !== a.closeRate) return b.closeRate - a.closeRate;
    return b.closes - a.closes;
  });

  return (
    <>
      <div style={{ background: 'white', border: '1px solid #e8e3da', borderRadius: 14, padding: 12, marginBottom: 18 }}>
        <DateFilter
          datePreset={datePreset} setDatePreset={setDatePreset}
          customStart={customStart} setCustomStart={setCustomStart}
          customEnd={customEnd} setCustomEnd={setCustomEnd}
        />
      </div>

      <Card>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#faf7f1' }}>
              <Th style={{ width: 60 }}>Rank</Th>
              <Th>Closer</Th>
              <Th right>Calls</Th>
              <Th right>Offers</Th>
              <Th right>Closes</Th>
              <Th right>Close rate</Th>
              <Th right>Contact rate</Th>
              <Th right>Speed to lead</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const rankBg = i === 0 ? '#fdf2dc' : i === 1 ? '#ece8df' : i === 2 ? '#f5e9dc' : '#f4efe7';
              const rankColor = i === 0 ? '#8a6310' : i === 1 ? '#5e5345' : i === 2 ? '#8a5e2d' : '#8a7d6b';
              return (
                <Tr key={r.closer} first={i === 0}>
                  <Td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: '50%', fontSize: 13, fontWeight: 600, background: rankBg, color: rankColor }}>{i + 1}</span>
                  </Td>
                  <Td style={{ fontWeight: 500, color: '#1f1b16' }}>{r.closer}</Td>
                  <Td right>{r.calls}</Td>
                  <Td right>{r.offers}</Td>
                  <Td right>{r.closes}</Td>
                  <Td right>{r.calls > 0 ? fmtPct1(r.closeRate) : '—'}</Td>
                  <Td right>{r.contactTotal > 0 ? fmtPct1(r.contactRate) : '—'}</Td>
                  <Td right>{fmtSpeedToLead(r.speedAvgSec)}</Td>
                </Tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function EodForm({ entries, closers, onSubmitted }) {
  const [closer, setCloser] = useState(closers[0] || 'Tyler');
  const [date, setDate] = useState(todayISO());
  const [energy, setEnergy] = useState(null);
  const [focus, setFocus] = useState(null);
  const [biology, setBiology] = useState(null);
  const [calls, setCalls] = useState('');
  const [offers, setOffers] = useState('');
  const [closes, setCloses] = useState('');
  const [rollup, setRollup] = useState('');
  const [objections, setObjections] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (closers.length > 0 && !closers.includes(closer)) {
      setCloser(closers[0]);
    }
  }, [closers, closer]);

  useEffect(() => {
    const existing = entries.find(e => e.closer === closer && e.date === date);
    if (existing) {
      setEnergy(existing.energy);
      setFocus(existing.focus);
      setBiology(existing.biology ? 'Yes' : null);
      setCalls(String(existing.calls ?? ''));
      setOffers(String(existing.offers ?? ''));
      setCloses(String(existing.closes ?? ''));
      setRollup(existing.rollup ?? '');
      setObjections(existing.objections ?? '');
    } else {
      setEnergy(null); setFocus(null); setBiology(null);
      setCalls(''); setOffers(''); setCloses('');
      setRollup(''); setObjections('');
    }
  }, [closer, date, entries]);

  const callsNum = Number(calls) || 0;
  const offersNum = Number(offers) || 0;
  const closesNum = Number(closes) || 0;
  const offerRate = callsNum > 0 ? (offersNum / callsNum) * 100 : 0;
  const closeOfCall = callsNum > 0 ? (closesNum / callsNum) * 100 : 0;

  const handleClear = () => {
    setEnergy(null); setFocus(null); setBiology(null);
    setCalls(''); setOffers(''); setCloses('');
    setRollup(''); setObjections('');
  };

  const handleSubmit = async () => {
    if (callsNum === 0 && offersNum === 0 && closesNum === 0) {
      setToast({ msg: 'Add at least one metric before submitting.', error: true });
      setTimeout(() => setToast(null), 2400);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/eod-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          closer, date,
          energy, focus,
          biology: biology === 'Yes',
          calls: callsNum, offers: offersNum, closes: closesNum,
          rollup, objections,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setToast({ msg: 'Save failed. ' + (json.error || ''), error: true });
      } else {
        setToast({ msg: json.replaced ? 'EOD updated.' : 'EOD submitted.', error: false });
        onSubmitted && onSubmitted();
      }
    } catch (err) {
      setToast({ msg: 'Network error.', error: true });
    }
    setSubmitting(false);
    setTimeout(() => setToast(null), 2400);
  };

  return (
    <>
      <Card style={{ padding: '24px 26px' }}>

        <FormSection title="Who & when" first>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Closer">
              <SelectInline value={closer} onChange={setCloser} options={closers} />
            </Field>
            <Field label="Date">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Self-assessment">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Energy today">
              <ScaleRow value={energy} onChange={setEnergy} />
            </Field>
            <Field label="Focus today">
              <ScaleRow value={focus} onChange={setFocus} />
            </Field>
          </div>
          <div style={{ marginTop: 18 }}>
            <Field label="Protected my biology (food, water, exercise, sleep)">
              <YnRow value={biology} onChange={setBiology} style={{ maxWidth: 220 }} />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Today's metrics">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <Field label="Calls connected"><input type="number" min="0" value={calls} onChange={(e) => setCalls(e.target.value)} placeholder="0" style={inputStyle} /></Field>
            <Field label="Offers given"><input type="number" min="0" value={offers} onChange={(e) => setOffers(e.target.value)} placeholder="0" style={inputStyle} /></Field>
            <Field label="Closes"><input type="number" min="0" value={closes} onChange={(e) => setCloses(e.target.value)} placeholder="0" style={inputStyle} /></Field>
          </div>
          <div style={{ fontSize: 11.5, color: '#8a7d6b', marginTop: 12, padding: '10px 12px', background: '#faf7f1', borderRadius: 8 }}>
            {(callsNum === 0 && offersNum === 0 && closesNum === 0) ? 'Rates will calculate once you fill in the metrics.' : (
              <>Offer rate: <strong>{offerRate.toFixed(1)}%</strong> · Close rate: <strong>{closeOfCall.toFixed(1)}%</strong></>
            )}
          </div>
        </FormSection>

        <FormSection title="Roll-up">
          <Field label="Daily roll-up — breakdown of all calls you took">
            <textarea value={rollup} onChange={(e) => setRollup(e.target.value)} placeholder="One line per call: prospect name, outcome, key takeaway…" style={{ ...inputStyle, minHeight: 90, resize: 'vertical', cursor: 'text' }} />
          </Field>
          <Field label="Most common objections you heard today">
            <textarea value={objections} onChange={(e) => setObjections(e.target.value)} placeholder="What came up most often today?" style={{ ...inputStyle, minHeight: 70, resize: 'vertical', cursor: 'text' }} />
          </Field>
        </FormSection>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button onClick={handleClear} disabled={submitting} style={{
            padding: '11px 18px', background: 'transparent', color: '#1f1b16',
            border: '1px solid #d3cfc5', borderRadius: 11, cursor: 'pointer',
            fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
          }}>Clear form</button>
          <button onClick={handleSubmit} disabled={submitting} style={{
            padding: '11px 22px', background: '#1f1b16', color: '#f4f1ec',
            border: 'none', borderRadius: 11, cursor: submitting ? 'wait' : 'pointer',
            fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
            opacity: submitting ? 0.7 : 1,
          }}>{submitting ? 'Saving…' : 'Submit EOD report'}</button>
        </div>

      </Card>

      {toast && (
        <div style={{
          position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
          background: toast.error ? '#9a3924' : '#1f1b16',
          color: '#f4f1ec', padding: '12px 22px', borderRadius: 11,
          fontSize: 13, fontWeight: 500, boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
        }}>{toast.msg}</div>
      )}
    </>
  );
}

function Card({ children, style = {} }) {
  return <div style={{
    background: 'white', border: '1px solid #e8e3da', borderRadius: 14,
    boxShadow: '0 1px 0 rgba(0,0,0,0.02), 0 4px 14px -8px rgba(60,40,20,0.06)',
    overflow: 'hidden', ...style,
  }}>{children}</div>;
}

function Kpi({ label, value, sub, tone = 'default' }) {
  const palette = {
    default: { bg: 'white', border: '#e8e3da', labelColor: '#8a7d6b', valueColor: '#1f1b16', subColor: '#8a7d6b' },
    accent:  { bg: '#e8e4ff', border: '#d4ccff', labelColor: '#4c3fb5', valueColor: '#1f1b16', subColor: '#4c3fb5' },
    good:    { bg: '#e8f3e3', border: '#c8e0bc', labelColor: '#3a6b29', valueColor: '#1f1b16', subColor: '#3a6b29' },
    warn:    { bg: '#fdf2dc', border: '#f0d99b', labelColor: '#8a6310', valueColor: '#1f1b16', subColor: '#8a6310' },
    muted:   { bg: 'white', border: '#e8e3da', labelColor: '#8a7d6b', valueColor: '#a99c87', subColor: '#a99c87' },
  }[tone] || { bg: 'white', border: '#e8e3da', labelColor: '#8a7d6b', valueColor: '#1f1b16', subColor: '#8a7d6b' };
  return (
    <div style={{ background: palette.bg, border: `1px solid ${palette.border}`, borderRadius: 14, padding: '14px 16px', minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: palette.labelColor, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: palette.valueColor, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: palette.subColor, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

const inputStyle = {
  width: '100%', appearance: 'none', background: 'white',
  border: '1px solid #e8e3da', borderRadius: 11,
  padding: '10px 13px', fontSize: 13.5, color: '#1f1b16',
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
};

function SelectInline({ value, onChange, options }) {
  return (
    <div style={{ position: 'relative' }}>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, paddingRight: 36, cursor: 'pointer' }}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <div style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-65%) rotate(45deg)', width: 7, height: 7, borderRight: '1.5px solid #8a7d6b', borderBottom: '1.5px solid #8a7d6b', pointerEvents: 'none' }} />
    </div>
  );
}

function FormSection({ title, children, first }) {
  return (
    <div style={{ paddingTop: first ? 0 : 18, marginTop: first ? 0 : 18, borderTop: first ? 'none' : '1px solid #f1ece4' }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', color: '#8a7d6b', textTransform: 'uppercase', marginBottom: 16 }}>{title}</div>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: '#1f1b16', marginBottom: 8, display: 'block', lineHeight: 1.4 }}>{label}</label>
      {children}
    </div>
  );
}

function ScaleRow({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 5 }}>
      {[1,2,3,4,5,6,7,8,9,10].map(n => {
        const selected = value === n;
        return (
          <button key={n} type="button" onClick={() => onChange(n)} style={{
            flex: 1, padding: '9px 0',
            border: '1px solid ' + (selected ? '#1f1b16' : '#e8e3da'),
            borderRadius: 8,
            background: selected ? '#1f1b16' : 'white',
            color: selected ? '#f4f1ec' : '#3a3128',
            fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit',
            fontVariantNumeric: 'tabular-nums',
          }}>{n}</button>
        );
      })}
    </div>
  );
}

function YnRow({ value, onChange, style = {} }) {
  return (
    <div style={{ display: 'flex', gap: 6, ...style }}>
      {['Yes', 'No'].map(label => {
        const selected = value === label;
        const selectedBg = label === 'Yes' ? '#e8f3e3' : '#f6e6e2';
        const selectedBorder = label === 'Yes' ? '#c8e0bc' : '#e8c8be';
        const selectedColor = label === 'Yes' ? '#3a6b29' : '#9a3924';
        return (
          <button key={label} type="button" onClick={() => onChange(label)} style={{
            flex: 1, padding: '9px 0',
            border: '1px solid ' + (selected ? selectedBorder : '#e8e3da'),
            borderRadius: 8,
            background: selected ? selectedBg : 'white',
            color: selected ? selectedColor : '#3a3128',
            fontWeight: selected ? 500 : 400,
            fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit',
          }}>{label}</button>
        );
      })}
    </div>
  );
}

function Th({ children, right, style = {} }) {
  return <th style={{
    textAlign: right ? 'right' : 'left', padding: '11px 16px',
    fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
    color: '#8a7d6b', borderBottom: '1px solid #efe9e0', whiteSpace: 'nowrap', ...style,
  }}>{children}</th>;
}

function Tr({ children, first }) {
  return <tr style={{ borderTop: first ? 'none' : '1px solid #f4efe7' }}>{children}</tr>;
}

function Td({ children, right, style = {} }) {
  return <td style={{ padding: '12px 16px', textAlign: right ? 'right' : 'left', color: '#3a3128', fontVariantNumeric: 'tabular-nums', verticalAlign: 'middle', ...style }}>{children}</td>;
}

function PastEntry({ entry, first }) {
  const submittedAt = entry.submittedAt ? new Date(entry.submittedAt) : null;
  const timeStr = submittedAt ? submittedAt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
  return (
    <div style={{ padding: '16px 20px', borderTop: first ? 'none' : '1px solid #f4efe7' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{entry.date} · {entry.closer}</div>
        <div style={{ fontSize: 11.5, color: '#8a7d6b' }}>submitted {timeStr}</div>
      </div>
      <div style={{ fontSize: 12, color: '#5e5345' }}>
        <strong style={{ color: '#1f1b16', fontWeight: 500 }}>{entry.calls}</strong> calls ·
        {' '}<strong style={{ color: '#1f1b16', fontWeight: 500 }}>{entry.offers}</strong> offers ·
        {' '}<strong style={{ color: '#1f1b16', fontWeight: 500 }}>{entry.closes}</strong> closes ·
        {' '}Energy <strong style={{ color: '#1f1b16', fontWeight: 500 }}>{entry.energy ?? '—'}</strong>/10 ·
        {' '}Focus <strong style={{ color: '#1f1b16', fontWeight: 500 }}>{entry.focus ?? '—'}</strong>/10
      </div>
    </div>
  );
}
