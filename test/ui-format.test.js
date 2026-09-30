import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatValue, formatDelta, formatCurrency, formatSeconds, formatPace, formatDay, formatRange,
  formatSignedValue, formatTimestamp, formatMs, toNumber, DASH,
} from '../lib/dashboard/format.js';

test('formatValue: currency full precision in tables, compact for tiles', () => {
  assert.equal(formatValue(12345.678, 'currency'), '$12,345.68');
  assert.equal(formatValue(0, 'currency'), '$0.00');
  assert.equal(formatValue(999.5, 'currency', { compact: true }), '$999.50');
  assert.equal(formatValue(12400, 'currency', { compact: true }), '$12.4K');
  assert.equal(formatValue(1000, 'currency', { compact: true }), '$1K');
  assert.equal(formatValue(1234567, 'currency', { compact: true }), '$1.2M');
  assert.equal(formatValue(-1234, 'currency'), '-$1,234.00');
  assert.equal(formatValue(-1234, 'currency', { compact: true }), '-$1.2K');
});

test('formatValue: percent, ratio, decimal, number', () => {
  assert.equal(formatValue(88.77452, 'percent'), '88.8%');
  assert.equal(formatValue(0, 'percent'), '0.0%');
  assert.equal(formatValue(3.24, 'ratio'), '3.2x');
  assert.equal(formatValue(1.44, 'decimal'), '1.4');
  assert.equal(formatValue(12345, 'number'), '12,345');
  assert.equal(formatValue(12.5, 'number'), '12.5');
  assert.equal(formatValue(250814, 'number', { compact: true }), '250.8K');
  assert.equal(formatValue('1,234', 'number'), '1,234');
});

test('formatValue: seconds', () => {
  assert.equal(formatValue(45, 'seconds'), '45 sec');
  assert.equal(formatValue(180, 'seconds'), '3 min');
  assert.equal(formatValue(4320, 'seconds'), '1 hr 12 min');
  assert.equal(formatValue(7200, 'seconds'), '2 hr');
  assert.equal(formatSeconds(3599.7), '1 hr');
});

test('formatValue: null, undefined, NaN, garbage -> em dash', () => {
  assert.equal(formatValue(null, 'currency'), DASH);
  assert.equal(formatValue(undefined, 'number'), DASH);
  assert.equal(formatValue(NaN, 'percent'), DASH);
  assert.equal(formatValue('abc', 'ratio'), DASH);
  assert.equal(formatValue({}, 'seconds'), DASH);
  assert.equal(formatCurrency(Infinity), DASH);
});

test('formatDelta: relative change with direction-aware tone', () => {
  const up = formatDelta(112.3, 100, 'currency', 'higher');
  assert.equal(up.text, '+12.3%');
  assert.equal(up.abs, '+$12.30');
  assert.equal(up.tone, 'good');

  const down = formatDelta(80, 100, 'number', 'higher');
  assert.equal(down.text, '-20.0%');
  assert.equal(down.abs, '-20');
  assert.equal(down.tone, 'bad');

  // lower-is-better: a decrease is good, an increase is bad
  assert.equal(formatDelta(80, 100, 'currency', 'lower').tone, 'good');
  assert.equal(formatDelta(120, 100, 'currency', 'lower').tone, 'bad');
  // dir none -> neutral regardless
  assert.equal(formatDelta(120, 100, 'number', 'none').tone, 'neutral');
  // no change -> neutral
  const flat = formatDelta(100, 100, 'number', 'higher');
  assert.equal(flat.tone, 'neutral');
  assert.equal(flat.text, '0.0%');
});

test('formatDelta: percent-unit rows show point difference', () => {
  const d = formatDelta(88.8, 86.5, 'percent', 'higher');
  assert.equal(d.text, '+2.3 pts');
  assert.equal(d.tone, 'good');
  assert.equal(formatDelta(10, 12.5, 'percent', 'lower').text, '-2.5 pts');
});

test('formatDelta: neutral when prev is 0 or null, or value missing', () => {
  for (const prev of [0, null, undefined, NaN, '']) {
    const d = formatDelta(50, prev, 'currency', 'higher');
    assert.equal(d.tone, 'neutral');
    assert.equal(d.text, DASH);
    assert.equal(d.pct, null);
  }
  assert.equal(formatDelta(null, 100, 'currency', 'higher').tone, 'neutral');
  // negative previous still yields a sensible relative change
  assert.equal(formatDelta(-50, -100, 'currency', 'higher').text, '+50.0%');
});

test('formatSignedValue by unit', () => {
  assert.equal(formatSignedValue(1234, 'currency'), '+$1,234.00');
  assert.equal(formatSignedValue(-0.5, 'ratio'), '-0.5x');
  assert.equal(formatSignedValue(90, 'seconds'), '+2 min');
  assert.equal(formatSignedValue(0, 'number'), '0');
  assert.equal(formatSignedValue(null, 'number'), DASH);
});

test('formatPace', () => {
  assert.equal(formatPace(1.3183), '132%');
  assert.equal(formatPace(0.5), '50%');
  assert.equal(formatPace(Infinity), '∞');
  assert.equal(formatPace(null), DASH);
  assert.equal(formatPace(NaN), DASH);
});

test('formatDay / formatRange never shift across time zones', () => {
  assert.equal(formatDay('2026-09-30'), 'Sep 30, 2026');
  assert.equal(formatDay('2026-01-01', { year: false }), 'Jan 1');
  assert.equal(formatDay('2026-09-30', { weekday: true }), 'Wed, Sep 30, 2026');
  assert.equal(formatDay('nonsense'), DASH);
  assert.equal(formatDay('2026-13-01'), DASH);
  assert.equal(formatRange({ from: '2026-09-24', to: '2026-09-30' }), 'Sep 24 – Sep 30');
  assert.equal(formatRange({ from: '2026-09-30', to: '2026-09-30' }), 'Sep 30');
  assert.equal(formatRange(null), DASH);
});

test('formatTimestamp respects the zone and tolerates bad input', () => {
  const s = formatTimestamp('2026-09-30T15:00:00.000Z', 'America/Toronto');
  assert.match(s, /Sep 30/);
  assert.match(s, /11:00/);
  assert.equal(formatTimestamp(null, 'America/Toronto'), DASH);
  assert.equal(formatTimestamp('not a date', 'America/Toronto'), 'not a date');
});

test('formatMs and toNumber', () => {
  assert.equal(formatMs(812), '812 ms');
  assert.equal(formatMs(1440), '1.4s');
  assert.equal(formatMs(null), DASH);
  assert.equal(toNumber('$1,234.50'), 1234.5);
  assert.equal(toNumber('12.5%'), 12.5);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber(Infinity), null);
});
