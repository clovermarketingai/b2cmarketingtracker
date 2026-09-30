import React from 'react';
import { DATASET_LABEL } from '../../lib/dashboard/catalog.js';
import { formatValue, formatDelta, formatPace, DASH } from '../../lib/dashboard/format.js';
import StatusPill from './StatusPill.js';
import Sparkline from './Sparkline.js';

/** Tooltip text naming the missing source(s) for an unavailable row. */
export function unavailableTitle(row) {
  const missing = (row.unavailable || []).map(k => DATASET_LABEL[k] || k);
  return missing.length ? `Not available: ${missing.join(', ')} is not connected` : 'Not available';
}

/** Whether a row prints values at all. */
export const isUnavailable = (row) => Array.isArray(row.unavailable) && row.unavailable.length > 0;

/** First (sticky) cell: label, optional note, optional sparkline. */
export function MetricCell({ row, series, sparkId }) {
  const unavailable = isUnavailable(row);
  const values = sparkId && series && Array.isArray(series[sparkId]) ? series[sparkId] : null;
  return (
    <th scope="row" title={unavailable ? unavailableTitle(row) : row.formula || undefined}>
      <div className="cc-metric">
        <span className="cc-metric-label">
          {row.label}
          {unavailable ? <span className="cc-metric-note">{unavailableTitle(row)}</span> : null}
        </span>
        {values && !unavailable ? <Sparkline values={values} dates={series.dates || []} unit={row.unit} label={`${row.label}, last 30 days`} /> : null}
      </div>
    </th>
  );
}

/** A plain value cell for a given range id. */
export function ValueCell({ row, rangeId, selected = false, blank = false, title }) {
  const unavailable = isUnavailable(row);
  const v = blank || unavailable ? null : row.values?.[rangeId];
  return (
    <td className={`cc-num${selected ? ' cc-sel' : ''}`} title={unavailable ? unavailableTitle(row) : title}>
      {blank ? '' : formatValue(v, row.unit)}
    </td>
  );
}

// Good/bad glyphs for a delta, matching the StatusPill vocabulary (check = good,
// cross = bad). They are deliberately not up/down arrows: on a lower-is-better
// row "-12.3%" is good, so an arrow would contradict the sign.
const DELTA_GLYPH = { good: '\u2713', bad: '\u2715' };

/** Delta vs the previous period for the selected range. */
export function DeltaCell({ row, rangeId }) {
  if (isUnavailable(row)) return <td className="cc-num" title={unavailableTitle(row)}>{DASH}</td>;
  const cur = row.values?.[rangeId];
  const prev = row.prev?.[rangeId];
  const d = formatDelta(cur, prev, row.unit, row.dir);
  const judged = d.tone === 'good' ? 'better' : d.tone === 'bad' ? 'worse' : null;
  const base = prev == null
    ? 'No previous period value'
    : `Previous period: ${formatValue(prev, row.unit)}${d.diff != null ? ` (${d.abs})` : ''}`;
  const title = judged ? `${base} \u00b7 ${judged} than previous` : base;
  return (
    <td className="cc-num" title={title}>
      <span className={`cc-delta ${d.tone}`}>
        {judged ? <span className="cc-glyph" aria-hidden="true">{DELTA_GLYPH[d.tone]}</span> : null}
        {d.text}
        {judged ? <span className="cc-sr"> ({judged})</span> : null}
      </span>
    </td>
  );
}

/** Monthly target cell. */
export function TargetCell({ row }) {
  const t = row.target;
  return (
    <td className="cc-num" title={t == null ? 'No target set for this month (Dashboard Targets table)' : `Monthly target ${formatValue(t, row.unit)}`}>
      {t == null ? <span className="cc-dim">{DASH}</span> : formatValue(t, row.unit)}
    </td>
  );
}

/** Pace cell: actual ÷ expected-so-far (cumulative rows) or actual ÷ target. */
export function PaceCell({ row }) {
  if (isUnavailable(row)) return <td className="cc-num">{DASH}</td>;
  const title = row.expected == null
    ? 'Pace needs a monthly target'
    : `${row.cumulative ? 'Expected by today' : 'Target'}: ${formatValue(row.expected, row.unit)} · MTD ${formatValue(row.values?.mtd, row.unit)}`;
  const infinite = row.paceInfinite === true || row.pace === Infinity;
  return (
    <td className="cc-num" title={infinite ? `${title} \u00b7 nothing expected yet, or lower-is-better with 0 actual` : title}>
      {infinite ? '\u221e' : formatPace(row.pace)}
    </td>
  );
}

/** Goal status pill from the payload's statusLabel / tone. */
export function StatusCell({ row }) {
  return (
    <td>
      <StatusPill tone={row.tone} label={row.statusLabel || row.status || 'No data'} title={isUnavailable(row) ? unavailableTitle(row) : undefined} />
    </td>
  );
}

/** <tr> class for emphasis + availability. */
export function rowClass(row) {
  const parts = [];
  if (row.emphasis === 'primary') parts.push('cc-primary');
  if (isUnavailable(row)) parts.push('cc-unavail');
  return parts.join(' ') || undefined;
}
