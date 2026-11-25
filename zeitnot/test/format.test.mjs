import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatAgo, formatClockSeconds, formatCountdown, formatCountdownShort, formatEval, formatPoints, formatResult,
  formatStartTime, tryParseClockSeconds,
} from '../shared/format.js';

test('clock parsing accepts H:MM:SS, M:SS and fractions and rejects everything else', () => {
  assert.equal(tryParseClockSeconds('1:35:54'), 5754);
  assert.equal(tryParseClockSeconds('06:32'), 392);
  assert.equal(tryParseClockSeconds('95:00'), 5700);
  assert.equal(tryParseClockSeconds('0:00:09.5'), 9.5);
  assert.equal(tryParseClockSeconds(' 1:00:00 '), 3600);
  for (const bad of ['abc', '', '1:75:00', '1:00:75', '12', '1:2:3:4', '-1:00', null, undefined, {}]) {
    assert.equal(tryParseClockSeconds(bad), null, `${JSON.stringify(bad)} should not parse`);
  }
});

test('clock formatting floors and never goes negative', () => {
  assert.equal(formatClockSeconds(5754.9), '1:35:54');
  assert.equal(formatClockSeconds(-3), '0:00:00');
  assert.equal(formatClockSeconds(7200), '2:00:00');
  assert.equal(formatClockSeconds(NaN), '0:00:00');
});

test('countdowns', () => {
  assert.equal(formatCountdown(0), 'Starting now');
  assert.equal(formatCountdown(-5), 'Starting now');
  assert.equal(formatCountdown(7 * 60000 + 5000), '7m 05s');
  assert.equal(formatCountdown(3 * 3600000 + 12 * 60000 + 8000), '3h 12m 08s');
  assert.equal(formatCountdown(2 * 86400000 + 4 * 3600000 + 5 * 60000), '2d 4h 05m');
  assert.equal(formatCountdownShort(7 * 60000 + 1), '8m');
  assert.equal(formatCountdownShort(3 * 3600000 + 12 * 60000), '3h 12m');
  assert.equal(formatCountdownShort(50 * 3600000), '2d 2h');
  assert.equal(formatCountdownShort(0), 'now');
});

test('eval formatting distinguishes "no eval" from 0.00', () => {
  assert.equal(formatEval(null), '—');
  assert.equal(formatEval(undefined), '—');
  assert.equal(formatEval(0), '0.00');
  assert.equal(formatEval(0.004), '0.00');
  assert.equal(formatEval(0.4), '+0.40');
  assert.equal(formatEval(-1.1), '-1.10');
  assert.equal(formatEval(12, 3), '#3');
  assert.equal(formatEval(-12, -2), '-#2');
});

test('results and points', () => {
  assert.equal(formatResult('1/2-1/2'), '½–½');
  assert.equal(formatResult('1-0'), '1–0');
  assert.equal(formatResult('*'), '*');
  assert.equal(formatPoints(0), '0');
  assert.equal(formatPoints(0.5), '½');
  assert.equal(formatPoints(3.5), '3½');
  assert.equal(formatPoints(7), '7');
});

test('start time reads Today / Tomorrow / a date, and has a fallback', () => {
  const now = new Date(2026, 10, 25, 12, 0, 0).getTime();
  assert.match(formatStartTime(new Date(2026, 10, 25, 16, 30).getTime(), now, 'en-US'), /^Today /);
  assert.match(formatStartTime(new Date(2026, 10, 26, 16, 30).getTime(), now, 'en-US'), /^Tomorrow /);
  assert.match(formatStartTime(new Date(2026, 10, 29, 16, 30).getTime(), now, 'en-US'), /^Nov 29, /);
  assert.equal(formatStartTime(null), 'Time to be announced');
});

test('relative age', () => {
  assert.equal(formatAgo(1000), 'just now');
  assert.equal(formatAgo(12000), '12s ago');
  assert.equal(formatAgo(4 * 60000), '4m ago');
  assert.equal(formatAgo(2 * 3600000), '2h ago');
});
