// Pure display formatting for the Command Center UI. No React, no I/O, no
// clock: everything here is deterministic so it can run in node --test and in
// the browser alike. Locale is pinned to en-US so numbers never change shape
// between the owner's machine and a teammate's.

const LOCALE = 'en-US';
export const DASH = '—'; // em dash for "no value"

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Coerce a value to a finite number, or null. Strings that parse as numbers
 * are accepted so raw API values can be passed straight through.
 * @param {unknown} v
 * @returns {number|null}
 */
export function toNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[,$%\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Integer/decimal number with thousands separators.
 * @param {number} n
 * @param {number} maxFrac maximum fraction digits
 * @param {number} [minFrac] minimum fraction digits (default 0)
 */
function sep(n, maxFrac, minFrac = 0) {
  return n.toLocaleString(LOCALE, { minimumFractionDigits: minFrac, maximumFractionDigits: maxFrac });
}

/**
 * Compact magnitude: 12.4K, 1.2M, 3.1B. Values under 1000 are returned with
 * the given number of decimals.
 * @param {number} n absolute value
 * @param {number} smallDecimals decimals to use under 1000
 */
function compactMagnitude(n, smallDecimals) {
  if (n < 1000) return sep(n, smallDecimals, smallDecimals);
  if (n < 1e6) return `${trimZero((n / 1e3).toFixed(1))}K`;
  if (n < 1e9) return `${trimZero((n / 1e6).toFixed(1))}M`;
  return `${trimZero((n / 1e9).toFixed(1))}B`;
}

const trimZero = (s) => s.replace(/\.0$/, '');

/**
 * Currency (USD) formatter.
 * - compact: under $1,000 -> "$123.45"; otherwise "$12.4K" / "$1.2M".
 * - full:    always two decimals with thousands separators: "$12,345.67".
 * Negatives are prefixed with "-": "-$1,234.00".
 * @param {number} n
 * @param {{ compact?: boolean }} [opts]
 */
export function formatCurrency(n, { compact = false } = {}) {
  if (!isNum(n)) return DASH;
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const body = compact ? compactMagnitude(abs, 2) : sep(abs, 2, 2);
  return `${sign}$${body}`;
}

/**
 * Seconds -> "45 sec" / "3 min" / "1 hr 12 min" / "2 hr".
 * @param {number} seconds
 */
export function formatSeconds(seconds) {
  if (!isNum(seconds)) return DASH;
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} sec`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  const hours = Math.floor(s / 3600);
  const mins = Math.round((s % 3600) / 60);
  if (mins === 60) return `${hours + 1} hr`;
  return mins > 0 ? `${hours} hr ${mins} min` : `${hours} hr`;
}

/**
 * Format a metric value for display by catalog unit.
 *   currency -> formatCurrency (compact only when opts.compact)
 *   percent  -> "88.8%"   ratio -> "3.2x"   seconds -> "1 hr 12 min"
 *   decimal  -> "1.4"     number -> "12,345" (up to 2 decimals if fractional)
 *   null / NaN / non-numeric -> "—"
 * @param {unknown} value
 * @param {'currency'|'number'|'percent'|'ratio'|'seconds'|'decimal'|string} unit
 * @param {{ compact?: boolean }} [opts]
 * @returns {string}
 */
export function formatValue(value, unit, { compact = false } = {}) {
  const n = toNumber(value);
  if (n == null) return DASH;
  switch (unit) {
    case 'currency': return formatCurrency(n, { compact });
    case 'percent': return `${sep(n, 1, 1)}%`;
    case 'ratio': return `${sep(n, 1, 1)}x`;
    case 'seconds': return formatSeconds(n);
    case 'decimal': return sep(n, 1, 1);
    case 'number':
    default:
      if (compact && Math.abs(n) >= 10000) return `${n < 0 ? '-' : ''}${compactMagnitude(Math.abs(n), 0)}`;
      return Number.isInteger(n) ? sep(n, 0) : sep(n, 2);
  }
}

/**
 * Signed absolute difference in the row's unit ("+$1,234.00", "-3", "+2.3 pts").
 * @param {number} diff
 * @param {string} unit
 */
export function formatSignedValue(diff, unit) {
  if (!isNum(diff)) return DASH;
  const sign = diff > 0 ? '+' : diff < 0 ? '-' : '';
  const abs = Math.abs(diff);
  if (unit === 'percent') return `${sign}${sep(abs, 1, 1)} pts`;
  if (unit === 'currency') return `${sign}$${sep(abs, 2, 2)}`;
  if (unit === 'ratio') return `${sign}${sep(abs, 1, 1)}x`;
  if (unit === 'seconds') return `${sign}${formatSeconds(abs)}`;
  if (unit === 'decimal') return `${sign}${sep(abs, 1, 1)}`;
  return `${sign}${Number.isInteger(abs) ? sep(abs, 0) : sep(abs, 2)}`;
}

/**
 * Delta of value vs a previous period.
 * text: relative change "+12.3%" (percentage-point difference "+2.3 pts" for
 *       percent-unit rows, where a relative change would be misleading).
 * abs:  the signed absolute difference in the row's unit ("+$1,234.00").
 * tone: 'good' | 'bad' | 'neutral' honouring dir ('lower' = a decrease is
 *       good; 'none' is always neutral). Neutral with text "—" when either
 *       side is missing or prev is 0 (no meaningful base).
 * @param {unknown} value
 * @param {unknown} prev
 * @param {string} unit
 * @param {'higher'|'lower'|'none'} dir
 * @returns {{ text: string, abs: string, pct: number|null, diff: number|null, tone: 'good'|'bad'|'neutral' }}
 */
export function formatDelta(value, prev, unit, dir = 'higher') {
  const v = toNumber(value);
  const p = toNumber(prev);
  if (v == null || p == null || p === 0) return { text: DASH, abs: DASH, pct: null, diff: null, tone: 'neutral' };
  const diff = v - p;
  const pct = (diff / Math.abs(p)) * 100;
  const sign = diff > 0 ? '+' : diff < 0 ? '-' : '';
  const text = unit === 'percent'
    ? `${sign}${sep(Math.abs(diff), 1, 1)} pts`
    : `${sign}${sep(Math.abs(pct), 1, 1)}%`;
  let tone = 'neutral';
  if (diff !== 0 && dir !== 'none') {
    const up = diff > 0;
    tone = (up === (dir !== 'lower')) ? 'good' : 'bad';
  }
  return { text, abs: formatSignedValue(diff, unit), pct, diff, tone };
}

/**
 * Pace to target as a percentage string: 1.318 -> "132%". Infinity -> "∞".
 * @param {number|null} pace
 */
export function formatPace(pace) {
  if (pace == null) return DASH;
  if (pace === Infinity) return '∞';
  if (!isNum(pace)) return DASH;
  return `${sep(pace * 100, 0)}%`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * 'YYYY-MM-DD' -> "Sep 30, 2026" (or "Sep 30" when year is false). Parsed as
 * calendar parts so it never shifts across time zones.
 * @param {string} iso
 * @param {{ year?: boolean, weekday?: boolean }} [opts]
 */
export function formatDay(iso, { year = true, weekday = false } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return DASH;
  const [, y, mo, d] = m;
  const mi = Number(mo) - 1;
  if (mi < 0 || mi > 11) return DASH;
  let out = `${MONTHS[mi]} ${Number(d)}`;
  if (weekday) {
    const dt = new Date(Date.UTC(Number(y), mi, Number(d)));
    out = `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getUTCDay()]}, ${out}`;
  }
  if (year) out += `, ${y}`;
  return out;
}

/**
 * Short "Sep 24 – Sep 30" label for an inclusive range.
 * @param {{ from: string, to: string }} r
 */
export function formatRange(r) {
  if (!r || !r.from || !r.to) return DASH;
  if (r.from === r.to) return formatDay(r.from, { year: false });
  return `${formatDay(r.from, { year: false })} – ${formatDay(r.to, { year: false })}`;
}

/**
 * ISO timestamp -> "Sep 30, 11:00 AM EDT" in the given zone. Falls back to the
 * raw string when the zone or timestamp is unusable.
 * @param {string|number|Date} iso
 * @param {string} tz IANA zone
 */
export function formatTimestamp(iso, tz) {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  try {
    return new Intl.DateTimeFormat(LOCALE, {
      timeZone: tz || undefined, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

/**
 * Milliseconds -> "0.4s" / "812 ms".
 * @param {number} ms
 */
export function formatMs(ms) {
  if (!isNum(ms)) return DASH;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
