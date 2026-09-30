import React from 'react';
import { formatRange } from '../../lib/dashboard/format.js';

export const RANGE_ORDER = ['today', 'yesterday', 'l7d', 'l30d', 'mtd', 'lastMonth'];

/**
 * Row of range chips. The selected id drives the "Selected" column and the
 * delta column in every table.
 * @param {{ ranges: Record<string, { id: string, label: string, from: string, to: string }>, value: string, onChange: (id: string) => void }} props
 */
export default function RangeChips({ ranges, value, onChange }) {
  const list = RANGE_ORDER.filter(id => ranges && ranges[id]);
  const sel = ranges && ranges[value];
  return (
    <div className="cc-chips" role="group" aria-label="Comparison range">
      <span className="cc-chips-label">Range</span>
      {list.map(id => (
        <button
          key={id}
          type="button"
          className="cc-chip"
          aria-pressed={id === value}
          onClick={() => onChange(id)}
        >
          {ranges[id].label}
        </button>
      ))}
      {sel ? <span className="cc-chip-dates">{formatRange(sel)} · {sel.days} day{sel.days === 1 ? '' : 's'}</span> : null}
    </div>
  );
}
