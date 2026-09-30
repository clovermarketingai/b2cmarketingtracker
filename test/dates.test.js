import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localDateOf, addDays, addMonths, monthStart, monthEnd, daysInMonth, daysBetween,
  resolveRange, previousRange, weeksOfMonth, pullWindow, monthElapsedFraction, eachDay,
} from '../lib/dashboard/dates.js';

test('localDateOf converts a UTC instant to the business calendar day', () => {
  // 23:30 in Toronto on Sep 29 is 03:30Z on Sep 30
  assert.equal(localDateOf('2026-09-30T03:30:00.000Z', 'America/Toronto'), '2026-09-29');
  assert.equal(localDateOf('2026-09-30T03:30:00.000Z', 'UTC'), '2026-09-30');
  assert.equal(localDateOf('2026-01-15T05:10:00.000Z', 'America/Toronto'), '2026-01-15');
  assert.equal(localDateOf(null), null);
  assert.equal(localDateOf('garbage'), null);
});

test('day arithmetic ignores DST', () => {
  assert.equal(addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(daysBetween('2026-09-01', '2026-09-30'), 30);
  assert.equal(eachDay('2026-09-29', '2026-10-01').length, 3);
});

test('month helpers', () => {
  assert.equal(monthStart('2026-09-30'), '2026-09-01');
  assert.equal(monthEnd('2026-02-10'), '2026-02-28');
  assert.equal(monthEnd('2024-02-10'), '2024-02-29');
  assert.equal(daysInMonth('2026-09-30'), 30);
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
});

test('standard ranges resolve inclusively against today', () => {
  const t = '2026-09-30';
  assert.deepEqual(resolveRange('today', t), { id: 'today', from: t, to: t });
  assert.deepEqual(resolveRange('yesterday', t), { id: 'yesterday', from: '2026-09-29', to: '2026-09-29' });
  assert.deepEqual(resolveRange('l7d', t), { id: 'l7d', from: '2026-09-24', to: t });
  assert.deepEqual(resolveRange('l30d', t), { id: 'l30d', from: '2026-09-01', to: t });
  assert.deepEqual(resolveRange('mtd', t), { id: 'mtd', from: '2026-09-01', to: t });
  assert.deepEqual(resolveRange('lastMonth', t), { id: 'lastMonth', from: '2026-08-01', to: '2026-08-31' });
  assert.deepEqual(resolveRange('mtd', '2026-01-01'), { id: 'mtd', from: '2026-01-01', to: '2026-01-01' });
  assert.deepEqual(resolveRange('lastMonth', '2026-01-05'), { id: 'lastMonth', from: '2025-12-01', to: '2025-12-31' });
});

test('previous ranges are the same length immediately before', () => {
  assert.deepEqual(previousRange(resolveRange('l7d', '2026-09-30')), { id: 'prev', from: '2026-09-17', to: '2026-09-23' });
  assert.deepEqual(previousRange(resolveRange('today', '2026-09-30')), { id: 'prev', from: '2026-09-29', to: '2026-09-29' });
  // MTD on the 10th compares to the 1st-10th of last month
  assert.deepEqual(previousRange(resolveRange('mtd', '2026-09-10')), { id: 'prevMtd', from: '2026-08-01', to: '2026-08-10' });
  // MTD on Mar 31 compares to Feb 1-28 (capped at month end)
  assert.deepEqual(previousRange(resolveRange('mtd', '2026-03-31')), { id: 'prevMtd', from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(previousRange(resolveRange('lastMonth', '2026-09-30')), { id: 'prevLastMonth', from: '2026-07-01', to: '2026-07-31' });
});

test('weeks of month are 7-day blocks from the 1st', () => {
  const w = weeksOfMonth('2026-09-16');
  assert.equal(w.length, 5);
  assert.deepEqual([w[0].from, w[0].to], ['2026-09-01', '2026-09-07']);
  assert.deepEqual([w[3].from, w[3].to], ['2026-09-22', '2026-09-28']);
  assert.deepEqual([w[4].from, w[4].to], ['2026-09-29', '2026-09-30']);
  assert.equal(w[2].partial, true);
  assert.equal(w[3].future, true);
  assert.equal(w[1].future, false);
  assert.equal(weeksOfMonth('2026-02-01').length, 4);
  assert.equal(weeksOfMonth('2026-02-01')[3].to, '2026-02-28');
});

test('pull window covers the month before last (for the last-month comparison) and the l30d comparison period', () => {
  assert.deepEqual(pullWindow('2026-09-30'), { from: '2026-07-01', to: '2026-09-30' });
  assert.deepEqual(pullWindow('2026-09-02'), { from: '2026-07-01', to: '2026-09-02' });
  assert.deepEqual(pullWindow('2026-03-01'), { from: '2026-01-01', to: '2026-03-01' });
});

test('weeks carry `through`: the last day the column covers', () => {
  const w = weeksOfMonth('2026-09-16');
  assert.equal(w[0].through, '2026-09-07');
  assert.equal(w[2].through, '2026-09-16');
  assert.equal(w[3].through, null);
});

test('month elapsed fraction counts today as a full day', () => {
  assert.equal(monthElapsedFraction('2026-09-30'), 1);
  assert.equal(monthElapsedFraction('2026-09-15'), 0.5);
});
