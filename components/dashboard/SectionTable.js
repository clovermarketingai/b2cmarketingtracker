import React from 'react';
import { formatRange } from '../../lib/dashboard/format.js';
import { MetricCell, ValueCell, DeltaCell, TargetCell, PaceCell, StatusCell, rowClass } from './cells.js';

// Team-section rows that carry a sparkline when the payload has the series.
const SPARK = {
  leads_billed: 'leads_billed',
  leads_sent: 'leads_sent',
  hs_profit: 'hs_profit',
  closes: 'closes',
  calls_connected: 'calls_connected',
};

/**
 * One team section (Home Service, Sales, CSM, Tax): weeks of the month, MTD,
 * the selected range with its delta, then target / pace / goal status.
 * @param {{ section: { id: string, title: string, rows: Array<object> }, weeks: Array<object>, ranges: object, series: object, selected: string }} props
 */
export default function SectionTable({ section, weeks = [], ranges, series, selected }) {
  const rows = section?.rows || [];
  const sel = ranges?.[selected];
  if (!rows.length) return <div className="cc-empty">No rows in this section.</div>;
  return (
    <div className="cc-scroll">
      <table className="cc-tbl" aria-label={section.title}>
        <thead>
          <tr>
            <th scope="col">Metric</th>
            {weeks.map(w => (
              <th scope="col" key={w.id} title={`${w.from} to ${w.to}${w.future ? ' (not started)' : w.partial ? ' (in progress)' : ''}`}>
                {w.label}
                <span className="cc-hint">{w.future ? 'upcoming' : w.partial ? 'partial' : formatRange(w)}</span>
              </th>
            ))}
            {/* The standalone MTD column only when MTD is not already the selected range. */}
            {selected !== 'mtd' ? <th scope="col" title={`${ranges?.mtd?.from || ''} to ${ranges?.mtd?.to || ''}`}>MTD actual</th> : null}
            <th scope="col" className="cc-sel" title={sel ? `${sel.from} to ${sel.to}` : undefined}>
              {sel ? sel.label : 'Selected'}<span className="cc-hint">{selected === 'mtd' ? 'MTD actual · selected range' : 'selected range'}</span>
            </th>
            <th scope="col" className="cc-sel" title={`Change vs the previous ${sel?.label || 'period'}`}>vs prev</th>
            <th scope="col">Monthly target</th>
            <th scope="col" title="Actual ÷ expected. Above 100% is ahead.">Pace</th>
            <th scope="col">Goal status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id} className={rowClass(row)}>
              <MetricCell row={row} series={series} sparkId={SPARK[row.id]} />
              {weeks.map(w => (
                <ValueCell key={w.id} row={row} rangeId={w.id} blank={!!w.future} title={w.partial ? `Partial week: ${w.from} to ${w.to} so far` : undefined} />
              ))}
              {selected !== 'mtd' ? <ValueCell row={row} rangeId="mtd" /> : null}
              <ValueCell row={row} rangeId={selected} selected />
              <DeltaCell row={row} rangeId={selected} />
              <TargetCell row={row} />
              <PaceCell row={row} />
              <StatusCell row={row} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
