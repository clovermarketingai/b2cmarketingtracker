import React from 'react';
import { formatValue } from '../../lib/dashboard/format.js';

/**
 * Build the SVG path data for a series. Null points break the line, so a
 * missing day never reads as zero.
 * @param {Array<number|null>} values
 * @param {number} w
 * @param {number} h
 * @returns {{ line: string, area: string, last: { x: number, y: number } | null }}
 */
export function sparkPath(values, w, h) {
  const nums = values.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return { line: '', area: '', last: null };
  let min = Math.min(...nums, 0);
  let max = Math.max(...nums, 0);
  if (max === min) { max = min + 1; }
  const n = values.length;
  const pad = 1.5;
  const x = (i) => n === 1 ? w / 2 : pad + (i / (n - 1)) * (w - pad * 2);
  const y = (v) => pad + (1 - (v - min) / (max - min)) * (h - pad * 2);
  let line = '';
  let pen = false;
  let last = null;
  const baseline = y(0);
  let area = '';
  let segStart = null;
  values.forEach((v, i) => {
    const ok = typeof v === 'number' && Number.isFinite(v);
    if (!ok) {
      if (pen && segStart != null) area += ` L${x(i - 1).toFixed(1)},${baseline.toFixed(1)} Z`;
      pen = false; segStart = null; return;
    }
    const px = x(i).toFixed(1); const py = y(v).toFixed(1);
    if (!pen) {
      line += `M${px},${py}`;
      area += ` M${px},${baseline.toFixed(1)} L${px},${py}`;
      segStart = i;
    } else {
      line += ` L${px},${py}`;
      area += ` L${px},${py}`;
    }
    pen = true;
    last = { x: Number(px), y: Number(py) };
  });
  if (pen && last) area += ` L${last.x},${baseline.toFixed(1)} Z`;
  return { line, area: area.trim(), last };
}

/**
 * Tiny inline SVG sparkline (last N days).
 * @param {{ values: Array<number|null>, dates?: string[], unit?: string, label?: string, width?: number, height?: number }} props
 */
export default function Sparkline({ values = [], dates = [], unit = 'number', label = '', width = 72, height = 20 }) {
  const { line, area, last } = sparkPath(values, width, height);
  if (!line) return null;
  const nums = values.filter(v => typeof v === 'number' && Number.isFinite(v));
  const first = dates[0] || '';
  const end = dates[dates.length - 1] || '';
  const title = `${label ? label + ': ' : ''}${values.length} days${first && end ? ` (${first} to ${end})` : ''}. Low ${formatValue(Math.min(...nums), unit)}, high ${formatValue(Math.max(...nums), unit)}, latest ${formatValue(values[values.length - 1], unit)}.`;
  return (
    <svg className="cc-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
      <title>{title}</title>
      {area ? <path className="cc-spark-fill" d={area} /> : null}
      <path d={line} />
      {last ? <circle cx={last.x} cy={last.y} r="1.6" /> : null}
    </svg>
  );
}
