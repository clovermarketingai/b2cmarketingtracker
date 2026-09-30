// Timezone-aware calendar helpers for the Command Center.
//
// Every "today", "month to date" and "last 7 days" on the dashboard is
// resolved in ONE business timezone (DASHBOARD_TZ, default America/Toronto),
// never in the server's UTC clock. Airtable timestamps are instants (UTC) and
// are converted to a local calendar date with localDateOf(); ad platforms
// already report by the ad account's calendar day, which should be set to the
// same zone.
//
// Dates are plain 'YYYY-MM-DD' strings everywhere. Arithmetic is done on
// UTC-midnight Date objects so DST never shifts a day.

export const DEFAULT_TZ = 'America/Toronto';

export function businessTz() {
  const tz = (process.env.DASHBOARD_TZ || '').trim();
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(s) {
  return typeof s === 'string' && ISO_RE.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

const fmtCache = new Map();
function formatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }));
  }
  return fmtCache.get(tz);
}

/** Calendar date ('YYYY-MM-DD') of an instant in the given timezone. */
export function localDateOf(input, tz = businessTz()) {
  if (input == null || input === '') return null;
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  // en-CA renders as YYYY-MM-DD; formatToParts avoids locale surprises.
  const parts = formatter(tz).formatToParts(d);
  const get = (t) => parts.find(p => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Today's calendar date in the business timezone. */
export function todayISO(tz = businessTz(), now = new Date()) {
  return localDateOf(now, tz);
}

/** Hour of day (0-23) right now in the business timezone. */
export function localHour(tz = businessTz(), now = new Date()) {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).formatToParts(now)
    .find(p => p.type === 'hour')?.value;
  return Number(h) % 24;
}

function toUTC(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUTC(d) {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  const d = toUTC(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUTC(d);
}

export function addMonths(iso, n) {
  const d = toUTC(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = daysInMonth(fromUTC(d));
  d.setUTCDate(Math.min(day, last));
  return fromUTC(d);
}

export function monthStart(iso) {
  return iso.slice(0, 7) + '-01';
}

export function daysInMonth(iso) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthEnd(iso) {
  return iso.slice(0, 7) + '-' + String(daysInMonth(iso)).padStart(2, '0');
}

export function monthKey(iso) {
  return iso.slice(0, 7);
}

export function dayOfMonth(iso) {
  return Number(iso.slice(8, 10));
}

/** Inclusive day count between two ISO dates. */
export function daysBetween(from, to) {
  return Math.round((toUTC(to) - toUTC(from)) / 86400000) + 1;
}

/** Every ISO date from `from` to `to` inclusive. */
export function eachDay(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export const RANGE_IDS = ['today', 'yesterday', 'l7d', 'l30d', 'mtd', 'lastMonth'];

export const RANGE_LABEL = {
  today: 'Today',
  yesterday: 'Yesterday',
  l7d: 'Last 7 days',
  l30d: 'Last 30 days',
  mtd: 'Month to date',
  lastMonth: 'Last month',
  custom: 'Custom',
};

/** Resolve a preset to an inclusive { from, to } against a given today. */
export function resolveRange(id, today) {
  switch (id) {
    case 'today':     return { id, from: today, to: today };
    case 'yesterday': return { id, from: addDays(today, -1), to: addDays(today, -1) };
    case 'l7d':       return { id, from: addDays(today, -6), to: today };
    case 'l30d':      return { id, from: addDays(today, -29), to: today };
    case 'mtd':       return { id, from: monthStart(today), to: today };
    case 'lastMonth': {
      const end = addDays(monthStart(today), -1);
      return { id, from: monthStart(end), to: end };
    }
    default: return null;
  }
}

/** All standard ranges keyed by id. */
export function standardRanges(today) {
  const out = {};
  for (const id of RANGE_IDS) out[id] = resolveRange(id, today);
  return out;
}

/** The equal-length period immediately before a range (for deltas). */
export function previousRange(range) {
  const len = daysBetween(range.from, range.to);
  if (range.id === 'mtd') {
    // Compare MTD against the same day count of the previous month.
    const prevStart = monthStart(addDays(range.from, -1));
    const prevEnd = addDays(prevStart, len - 1);
    return { id: 'prevMtd', from: prevStart, to: prevEnd > monthEnd(prevStart) ? monthEnd(prevStart) : prevEnd };
  }
  if (range.id === 'lastMonth') {
    const start = monthStart(addDays(range.from, -1));
    return { id: 'prevLastMonth', from: start, to: monthEnd(start) };
  }
  return { id: 'prev', from: addDays(range.from, -len), to: addDays(range.from, -1) };
}

/**
 * Seven-day blocks of the month containing `today`: W1 = 1st-7th, W2 = 8th-14th,
 * W3 = 15th-21st, W4 = 22nd-28th, W5 = 29th-end. Blocks that start after today
 * are returned with future=true so the UI can render them as empty.
 */
export function weeksOfMonth(today) {
  const start = monthStart(today);
  const end = monthEnd(today);
  const out = [];
  let i = 1;
  for (let from = start; from <= end; from = addDays(from, 7), i++) {
    let to = addDays(from, 6);
    if (to > end) to = end;
    out.push({
      id: `w${i}`,
      label: `Week ${i}`,
      from, to,
      future: from > today,
      partial: from <= today && to > today,
    });
  }
  return out;
}

/**
 * Widest window the dashboard needs to pull from a source, given today:
 * last month start (for last-month comparison) or l30d start, whichever is
 * earlier, through today. Sources should be fetched once for this window and
 * sliced locally.
 */
export function pullWindow(today) {
  const lastMonthStart = monthStart(addDays(monthStart(today), -1));
  const l30 = addDays(today, -29);
  const l60 = addDays(today, -59); // prev period of l30d
  let from = lastMonthStart < l30 ? lastMonthStart : l30;
  if (l60 < from) from = l60;
  return { from, to: today };
}

/** Fraction of the month elapsed through today, today counting as a full day. */
export function monthElapsedFraction(today) {
  return dayOfMonth(today) / daysInMonth(today);
}
