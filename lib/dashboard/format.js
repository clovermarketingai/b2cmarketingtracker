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
    // Strip separators, then accept only a plain decimal (optionally signed,
    // optional exponent). Number('') is 0 and Number('0x10') is 16, so a
    // whitespace-only or hex cell must not slip through as a value.
    const s = v.replace(/[,$%\s]/g, '');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
    const n = Number(s);
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

/** Whether a formatted body ("0.00", "$0.0", "0 sec") still shows a non-zero digit. */
const hasMagnitude = (s) => /[1-9]/.test(s);

/**
 * Prefix a sign only when the *printed* body is non-zero, so -0 and -0.001
 * print as "0" / "0.00" rather than "-0" / "-0.00".
 * @param {number} n the signed source value
 * @param {string} body the formatted absolute value
 * @param {string} [plus] prefix for positives ('' or '+')
 */
function signed(n, body, plus = '') {
  if (!hasMagnitude(body)) return body;
  return `${n < 0 ? '-' : n > 0 ? plus : ''}${body}`;
}

/** Locale number of |n| with the sign decided from the rounded text. */
const signedSep = (n, maxFrac, minFrac = 0) => signed(n, sep(Math.abs(n), maxFrac, minFrac));

/**
 * Compact magnitude: 12.4K, 1.2M, 3.1B. Values under 1000 are returned with
 * the given number of decimals.
 * @param {number} n absolute value
 * @param {number} smallDecimals decimals to use under 1000
 */
function compactMagnitude(n, smallDecimals) {
  if (n < 1000) return sep(n, smallDecimals, smallDecimals);
  // Round to one decimal *before* picking the suffix so 999,999 rolls over
  // to "1M" instead of printing "1000K".
  const k = Math.round(n / 100) / 10;
  if (k < 1000) return `${trimZero(k.toFixed(1))}K`;
  const m = Math.round(n / 1e5) / 10;
  if (m < 1000) return `${trimZero(m.toFixed(1))}M`;
  return `${trimZero((Math.round(n / 1e8) / 10).toFixed(1))}B`;
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
  const abs = Math.abs(n);
  const body = compact ? compactMagnitude(abs, 2) : sep(abs, 2, 2);
  return signed(n, `$${body}`);
}

/**
 * Seconds -> "45 sec" / "3 min" / "1 hr 12 min" / "2 hr".
 * @param {number} seconds
 */
export function formatSeconds(seconds) {
  if (!isNum(seconds)) return DASH;
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} sec`;
  // Round to whole minutes first, then pick the unit, so 3,570-3,599 s
  // rolls over to "1 hr" instead of printing "60 min".
  const totalMins = Math.round(s / 60);
  if (totalMins < 60) return `${totalMins} min`;
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return mins ? `${hours} hr ${mins} min` : `${hours} hr`;
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
    case 'percent': return `${signedSep(n, 1, 1)}%`;
    case 'ratio': return `${signedSep(n, 1, 1)}x`;
    case 'seconds': return formatSeconds(n);
    case 'decimal': return signedSep(n, 1, 1);
    case 'number':
    default:
      if (compact && Math.abs(n) >= 10000) return signed(n, compactMagnitude(Math.abs(n), 0));
      return Number.isInteger(n) ? signedSep(n, 0) : signedSep(n, 2);
  }
}

/**
 * Signed absolute difference in the row's unit ("+$1,234.00", "-3", "+2.3 pts").
 * @param {number} diff
 * @param {string} unit
 */
export function formatSignedValue(diff, unit) {
  if (!isNum(diff)) return DASH;
  const abs = Math.abs(diff);
  let body;
  if (unit === 'percent') body = `${sep(abs, 1, 1)} pts`;
  else if (unit === 'currency') body = `$${sep(abs, 2, 2)}`;
  else if (unit === 'ratio') body = `${sep(abs, 1, 1)}x`;
  else if (unit === 'seconds') body = formatSeconds(abs);
  else if (unit === 'decimal') body = sep(abs, 1, 1);
  else body = Number.isInteger(abs) ? sep(abs, 0) : sep(abs, 2);
  // The sign follows the printed text: a diff that rounds to zero is "0".
  return signed(diff, body, '+');
}

/**
 * Delta of value vs a previous period.
 * text: relative change "+12.3%" (percentage-point difference "+2.3 pts" for
 *       percent-unit rows, where a relative change would be misleading).
 * abs:  the signed absolute difference in the row's unit ("+$1,234.00").
 * tone: 'good' | 'bad' | 'neutral' honouring dir ('lower' = a decrease is
 *       good; 'none' is always neutral). Neutral with text "—" when either
 *       side is missing, or when prev is 0 and the row is not percent-unit
 *       (a relative change has no base; a point difference does). The sign
 *       and tone follow the *rounded* text, so anything that prints as 0.0
 *       is neutral and "-0.0%" never appears.
 * @param {unknown} value
 * @param {unknown} prev
 * @param {string} unit
 * @param {'higher'|'lower'|'none'} dir
 * @returns {{ text: string, abs: string, pct: number|null, diff: number|null, tone: 'good'|'bad'|'neutral' }}
 */
export function formatDelta(value, prev, unit, dir = 'higher') {
  const v = toNumber(value);
  const p = toNumber(prev);
  if (v == null || p == null) return { text: DASH, abs: DASH, pct: null, diff: null, tone: 'neutral' };
  const diff = v - p;
  const abs = formatSignedValue(diff, unit);
  if (unit !== 'percent' && p === 0) return { text: DASH, abs, pct: null, diff, tone: 'neutral' };
  const pct = p === 0 ? null : (diff / Math.abs(p)) * 100;
  const raw = unit === 'percent' ? diff : pct;
  const mag = Math.round(Math.abs(raw) * 10) / 10; // the magnitude that will be printed
  const zero = mag === 0;
  const sign = zero ? '' : raw > 0 ? '+' : '-';
  const text = `${sign}${sep(mag, 1, 1)}${unit === 'percent' ? ' pts' : '%'}`;
  let tone = 'neutral';
  if (!zero && dir !== 'none') {
    const up = raw > 0;
    tone = (up === (dir !== 'lower')) ? 'good' : 'bad';
  }
  return { text, abs, pct, diff, tone };
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
