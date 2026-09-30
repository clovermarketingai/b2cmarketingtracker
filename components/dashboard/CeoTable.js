import React from 'react';
import { RANGE_ORDER } from './RangeChips.js';
import { MetricCell, ValueCell, DeltaCell, TargetCell, PaceCell, StatusCell, rowClass } from './cells.js';

// CEO rows that get a 30-day sparkline beside their label (series id per row id).
const SPARK = {
  cash_collected: 'cash_collected',
  profit_business: 'profit_business',
  leads_billed: 'leads_billed',
  closes: 'closes',
  hs_profit: 'hs_profit',
  calls_connected: 'calls_connected',
  leads_sent: 'leads_sent',
  ad_spend_total: 'ad_spend_total',
};

/**
 * The CEO block table: every standard range side by side, then delta for
 * the selected range, target, pace and status.
 * @param {{ section: { rows: Array<object> }, ranges: object, series: object, selected: string }} props
 */
export default function CeoTable({ section, ranges, series, selected }) {
  const rows = section?.rows || [];
  const rangeIds = RANGE_ORDER.filter(id => ranges && ranges[id]);
  if (!rows.length) return <div className="cc-empty">No CEO rows in the payload.</div>;
  return (
    <div className="cc-scroll">
      <table className="cc-tbl" aria-label="CEO metrics, total company">
        <thead>
          <tr>
            <th scope="col">Metric</th>
            {rangeIds.map(id => (
              <th scope="col" key={id} className={id === selected ? 'cc-sel' : undefined} title={`${ranges[id].from} to ${ranges[id].to}`}>
                {id === 'mtd' ? 'MTD' : ranges[id].label}
              </th>
            ))}
            <th scope="col" className="cc-sel" title={`Change vs the previous ${ranges[selected]?.label || 'period'}`}>
              vs prev<span className="cc-hint">{ranges[selected]?.label}</span>
            </th>
            <th scope="col">Monthly target</th>
            <th scope="col" title="Actual ÷ expected. Above 100% is ahead.">Pace</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id} className={rowClass(row)}>
              <MetricCell row={row} series={series} sparkId={SPARK[row.id]} />
              {rangeIds.map(id => <ValueCell key={id} row={row} rangeId={id} selected={id === selected} />)}
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
