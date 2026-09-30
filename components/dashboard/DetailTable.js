import React, { useMemo, useState } from 'react';
import { formatValue, DASH } from '../../lib/dashboard/format.js';

/**
 * Sort rows by a column. Nulls always sink to the bottom regardless of
 * direction; strings compare case-insensitively.
 * @param {Array<object>} rows
 * @param {string} key
 * @param {'asc'|'desc'} dir
 */
export function sortRows(rows, key, dir) {
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[key]; const bv = b[key];
    const an = av == null || av === ''; const bn = bv == null || bv === '';
    if (an && bn) return 0;
    if (an) return 1;
    if (bn) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul;
    return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base', numeric: true }) * mul;
  });
}

/**
 * Generic sortable detail table.
 * columns: [{ key, label, unit?, text?, render?(row) -> node, title? }]
 * - unit: catalog unit used by formatValue (numbers right-aligned)
 * - text: left-aligned string column
 * - render: custom cell content (sorting still uses row[key])
 * @param {{ columns: Array<object>, rows: Array<object>, rowKey: string|((row: object) => string), defaultSort?: { key: string, dir?: 'asc'|'desc' }, label: string, empty?: string }} props
 */
export default function DetailTable({ columns, rows = [], rowKey, defaultSort, label, empty = 'Nothing in this range.' }) {
  const [sort, setSort] = useState(defaultSort || { key: columns[0]?.key, dir: 'desc' });
  const sorted = useMemo(() => sortRows(rows, sort.key, sort.dir), [rows, sort]);
  const keyOf = typeof rowKey === 'function' ? rowKey : (r) => r[rowKey];

  const onSort = (key) => {
    setSort(s => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));
  };

  if (!rows.length) return <div className="cc-empty">{empty}</div>;

  return (
    <div className="cc-scroll">
      <table className="cc-tbl" aria-label={label}>
        <thead>
          <tr>
            {columns.map(c => {
              const active = sort.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={`cc-sortable${c.text ? ' cc-text' : ''}`}
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  title={c.title || `Sort by ${c.label}`}
                  onClick={() => onSort(c.key)}
                >
                  {c.label}
                  <span className="cc-sort" aria-hidden="true">{active ? (sort.dir === 'asc' ? '▲' : '▼') : '▽'}</span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => (
            <tr key={keyOf(row)}>
              {columns.map((c, i) => {
                const v = row[c.key];
                let content;
                if (c.render) content = c.render(row);
                else if (c.text) content = v == null || v === '' ? DASH : String(v);
                else content = formatValue(v, c.unit || 'number');
                const cls = [i === 0 ? 'cc-name' : '', c.text ? 'cc-text' : 'cc-num'].filter(Boolean).join(' ');
                return <td key={c.key} className={cls}>{content}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
