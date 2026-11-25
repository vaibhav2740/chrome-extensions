import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_BACKOFF_MS, MIN_DELAY_MS, baseDelayMs, nextPollDelayMs } from '../shared/schedule.js';

const MIN = 60000;
const snap = (over = {}, nextStartsIn = null, now = 1e12) => ({
  liveRoundId: null,
  nextRoundId: nextStartsIn === null ? null : 'n',
  rounds: nextStartsIn === null ? [] : [{ id: 'n', startsAt: now + nextStartsIn }],
  odds: { decided: false },
  ...over,
});
const NOW = 1e12;

test('30 s while a game is on, and never faster', () => {
  assert.equal(baseDelayMs(snap({ liveRoundId: 'x' }), NOW), 30000);
  assert.equal(nextPollDelayMs(snap({ liveRoundId: 'x' }), NOW), MIN_DELAY_MS);
});

test('it slows down as the next game gets further away', () => {
  assert.equal(baseDelayMs(null, NOW), MIN);
  assert.equal(baseDelayMs(snap({}, 30 * MIN), NOW), MIN, 'in the last hour: every minute, so the toolbar countdown is right');
  assert.equal(baseDelayMs(snap({}, 3 * 60 * MIN), NOW), 5 * MIN);
  assert.equal(baseDelayMs(snap({}, 20 * 60 * MIN), NOW), 30 * MIN);
  assert.equal(baseDelayMs(snap({}, null), NOW), 30 * MIN, 'no known next round');
});

test('a round that should have started is watched closely for a while, then relaxed', () => {
  assert.equal(baseDelayMs(snap({}, -2 * MIN), NOW), 30000);
  assert.equal(baseDelayMs(snap({}, -3 * 60 * MIN), NOW), 5 * MIN);
});

test('a decided match is barely polled', () => {
  assert.equal(baseDelayMs(snap({ odds: { decided: true } }, 5 * MIN), NOW), 12 * 60 * MIN);
});

test('failures back off exponentially up to ten minutes and a rate limit is honoured', () => {
  const live = snap({ liveRoundId: 'x' });
  assert.equal(nextPollDelayMs(live, NOW, { failures: 1 }), 60000);
  assert.equal(nextPollDelayMs(live, NOW, { failures: 2 }), 120000);
  assert.equal(nextPollDelayMs(live, NOW, { failures: 3 }), 240000);
  assert.equal(nextPollDelayMs(live, NOW, { failures: 30 }), MAX_BACKOFF_MS);
  assert.equal(nextPollDelayMs(live, NOW, { blockedMs: 95000 }), 95000);
  assert.equal(nextPollDelayMs(snap({}, 20 * 60 * MIN), NOW, { failures: 2 }), 30 * MIN, 'backoff never speeds a slow schedule up');
});
