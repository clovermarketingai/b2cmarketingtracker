import React from 'react';
import StatusPill, { sourceTone } from './StatusPill.js';
import { formatTimestamp, formatMs, formatValue } from '../../lib/dashboard/format.js';

const STATUS_LABEL = { ok: 'OK', stale: 'Stale', error: 'Error', unconfigured: 'Not connected', demo: 'Demo' };

/**
 * One card per data source plus the payload warnings.
 * @param {{ sources: Record<string, object>, warnings: string[], tz: string }} props
 */
export default function SourcesPanel({ sources = {}, warnings = [], tz }) {
  const entries = Object.entries(sources);
  return (
    <>
      {warnings.length ? (
        <div className="cc-banner warn" style={{ margin: '12px 16px 0' }} role="status">
          <strong>Warnings</strong>
          <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      ) : null}
      {entries.length ? (
        <div className="cc-sources">
          {entries.map(([key, s]) => {
            const status = s.status || 'unconfigured';
            const tone = sourceTone(status);
            return (
              <div className="cc-src" key={key} data-source={key}>
                <div className="cc-src-top">
                  <span className="cc-src-label">{s.label || key}</span>
                  <StatusPill tone={tone} label={STATUS_LABEL[status] || status} />
                </div>
                <div className="cc-src-meta">
                  <span title="Rows returned">{formatValue(s.count ?? 0, 'number')} rows</span>
                  <span title="When this source was last fetched">{s.fetchedAt ? formatTimestamp(s.fetchedAt, tz) : 'never fetched'}</span>
                  <span title="Fetch time">{formatMs(s.ms)}</span>
                </div>
                {s.error ? <div className="cc-src-msg err">{s.error}</div> : null}
                {s.hint ? <div className="cc-src-msg">{s.hint}</div> : null}
                {status === 'stale' && !s.error ? <div className="cc-src-msg">Showing the last good pull.</div> : null}
                {s.meta && Array.isArray(s.meta.warnings) && s.meta.warnings.length ? (
                  <div className="cc-src-msg">{s.meta.warnings.join('\n')}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : <div className="cc-empty" style={{ padding: '16px' }}>No sources reported.</div>}
    </>
  );
}
