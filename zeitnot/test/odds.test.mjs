import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateGameProbabilities, calculateMatchExpectancy, pregameOdds, winChance,
} from '../shared/odds.js';

const sum = (r) => r.whiteWin + r.draw + r.blackWin;

test('win/draw/loss always sum to 1 and are never negative', () => {
  const cases = [
    { evalPawns: -8, plyCount: 40, moveNumber: 21 },
    { evalPawns: -1.5, plyCount: 40, moveNumber: 21 },
    { evalPawns: 0, plyCount: 0, moveNumber: 1 },
    { evalPawns: 0.35, plyCount: 26, moveNumber: 14, opening: 'Berlin Defense' },
    { evalPawns: 2.2, plyCount: 60, moveNumber: 31 },
    { mateIn: 3, plyCount: 50, moveNumber: 26 },
    { mateIn: -2, plyCount: 50, moveNumber: 26 },
    { plyCount: 30, moveNumber: 16 }, // no eval at all
    { evalPawns: 0.5, evalAgePlies: 6, plyCount: 30, moveNumber: 16 },
    { evalPawns: 0, plyCount: 100, moveNumber: 51, whiteTimeSec: 40, blackTimeSec: 25 },
  ];
  for (const c of cases) {
    const r = calculateGameProbabilities(c);
    assert(Math.abs(sum(r) - 1) < 1e-9, `sum was ${sum(r)} for ${JSON.stringify(c)}`);
    assert(r.whiteWin >= 0 && r.draw >= 0 && r.blackWin >= 0);
  }
});

test('finished games are certain', () => {
  assert.equal(calculateGameProbabilities({ result: '1-0' }).whiteWin, 1);
  assert.equal(calculateGameProbabilities({ result: '0-1' }).blackWin, 1);
  assert.equal(calculateGameProbabilities({ result: '1/2-1/2' }).draw, 1);
});

test('White\'s chances rise strictly with the eval', () => {
  const at = (evalPawns) => calculateGameProbabilities({ evalPawns, plyCount: 30, moveNumber: 16, whiteTimeSec: 3600, blackTimeSec: 3600 });
  const [low, eq, high] = [at(-0.5), at(0), at(0.8)];
  assert(high.whiteWin > eq.whiteWin && eq.whiteWin > low.whiteWin);
  assert(low.blackWin > eq.blackWin && eq.blackWin > high.blackWin);
});

test('with no engine eval the model says so and falls back on ratings and colour', () => {
  const none = calculateGameProbabilities({ plyCount: 30, moveNumber: 16, whiteElo: 2782, blackElo: 2710, whiteTimeSec: 3600, blackTimeSec: 3600 });
  assert.equal(none.known, false);
  const zero = calculateGameProbabilities({ evalPawns: 0, plyCount: 30, moveNumber: 16, whiteElo: 2782, blackElo: 2710, whiteTimeSec: 3600, blackTimeSec: 3600 });
  assert.equal(zero.known, true);
  // The prior (+ White's edge) is kept in full when nothing else is known, so it leans further than a known 0.00.
  assert(none.whiteWin > zero.whiteWin);
  assert.equal(calculateGameProbabilities({ plyCount: 0 }).known, false, 'a game that has not started has no eval');
});

test('the rating prior fades as the game goes on, and an old eval is trusted less', () => {
  const base = { evalPawns: 0, moveNumber: 20, whiteElo: 2782, blackElo: 2710, whiteTimeSec: 3600, blackTimeSec: 3600 };
  const early = calculateGameProbabilities({ ...base, plyCount: 10 });
  const late = calculateGameProbabilities({ ...base, plyCount: 110 });
  assert(early.formShift > late.formShift && late.formShift > 0);

  const fresh = calculateGameProbabilities({ ...base, evalPawns: 1.5, plyCount: 40, evalAgePlies: 0 });
  const stale = calculateGameProbabilities({ ...base, evalPawns: 1.5, plyCount: 40, evalAgePlies: 8 });
  assert(fresh.whiteWin > stale.whiteWin);
});

test('phase 1 ends at move 40 and phase 2 starts at move 41', () => {
  const m40 = calculateGameProbabilities({ evalPawns: 0, plyCount: 79, moveNumber: 40, whiteTimeSec: 600, blackTimeSec: 120 });
  const m41 = calculateGameProbabilities({ evalPawns: 0, plyCount: 81, moveNumber: 41, whiteTimeSec: 2400, blackTimeSec: 1920 });
  assert.equal(m40.clocks.isPhase2, false);
  assert.equal(m40.clocks.mRem, 1);
  assert.equal(m41.clocks.isPhase2, true);
  assert.equal(m41.clocks.mRem, 20);
});

test('time trouble hurts the player in it and makes draws less likely, at the same clock ratio', () => {
  const abundant = calculateGameProbabilities({ evalPawns: 0, plyCount: 68, moveNumber: 35, whiteTimeSec: 3600, blackTimeSec: 720 });
  const zeitnot = calculateGameProbabilities({ evalPawns: 0, plyCount: 68, moveNumber: 35, whiteTimeSec: 900, blackTimeSec: 180 });
  assert(zeitnot.clocks.stressB > abundant.clocks.stressB);
  assert(zeitnot.timeShift > abundant.timeShift);
  assert(zeitnot.draw < abundant.draw);
});

test('winChance is Lichess\' curve: 0.5 at equality, symmetric, and bounded', () => {
  assert.equal(winChance(0), 0.5);
  assert(Math.abs(winChance(1) + winChance(-1) - 1) < 1e-12);
  assert(winChance(50) < 1 && winChance(-50) > 0);
  assert(winChance(1) > 0.58 && winChance(1) < 0.6);
});

// ---- match dynamic programme ----

const EQUAL = [{ elo: 2750, form: 0, rapid: 0 }, { elo: 2750, form: 0, rapid: 0 }];

/** Straight recursion over every result, the slow way, to check the DP against. */
function bruteForce({ scoreA, scoreB, unplayed, aWhite, profiles, target = 7.5 }) {
  const [pa, pb] = profiles;
  const withA = pregameOdds(pa, pb);
  const withB = pregameOdds(pb, pa);
  const tbA = 1 / (1 + Math.pow(10, -((pa.elo + pa.rapid) - (pb.elo + pb.rapid)) / 400));
  const go = (a, b, rest) => {
    if (a >= target) return 1;
    if (b >= target) return 0;
    if (rest.length === 0) return a > b ? 1 : b > a ? 0 : tbA;
    const [r, ...tail] = rest;
    const [w, d, l] = aWhite(r) ? [withA.whiteWin, withA.draw, withA.blackWin] : [withB.blackWin, withB.draw, withB.whiteWin];
    return w * go(a + 1, b, tail) + d * go(a + 0.5, b + 0.5, tail) + l * go(a, b + 1, tail);
  };
  return go(scoreA, scoreB, unplayed);
}

test('match odds equal a brute-force enumeration', () => {
  const profiles = [{ elo: 2710, form: -10, rapid: 0 }, { elo: 2782, form: 25, rapid: 35 }];
  for (const [scoreA, scoreB, unplayed] of [
    [0, 0, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
    [6, 5.5, [12, 13, 14]],
    [3.5, 6.5, [9, 10, 11, 12, 13, 14]],
    [7, 7, []],
  ]) {
    const aWhite = (n) => n % 2 === 0;
    const dp = calculateMatchExpectancy({ scoreA, scoreB, unplayed, aWhite, profiles });
    const want = bruteForce({ scoreA, scoreB, unplayed, aWhite, profiles });
    assert(Math.abs(dp.a - want) < 1e-9, `${scoreA}-${scoreB} ${unplayed.length} left: dp ${dp.a} vs ${want}`);
    assert(Math.abs(dp.a + dp.b - 1) < 1e-9);
  }
});

test('match odds: terminal scores, symmetry, tiebreak and the value of a lead', () => {
  const won = calculateMatchExpectancy({ scoreA: 7.5, scoreB: 5.5, unplayed: [14] });
  assert.deepEqual([won.a, won.b, won.remaining], [1, 0, 0]);
  const lost = calculateMatchExpectancy({ scoreA: 4, scoreB: 7.5, unplayed: [] });
  assert.deepEqual([lost.a, lost.b], [0, 1]);

  const rounds = Array.from({ length: 14 }, (_, i) => i + 1);
  const even = calculateMatchExpectancy({ unplayed: rounds, aWhite: (n) => n % 2 === 1, profiles: EQUAL });
  assert(Math.abs(even.a - 0.5) < 1e-9, 'identical players are a coin flip');
  assert(even.tiebreak > 0.1 && even.tiebreak < 0.3);

  const tied = calculateMatchExpectancy({ scoreA: 7, scoreB: 7, unplayed: [], profiles: [{ elo: 2800, form: 0, rapid: 0 }, EQUAL[0]] });
  assert.equal(tied.tiebreak, 1);
  assert(tied.a > 0.5, 'a better rapid player is favoured in the tiebreak');

  const behind = calculateMatchExpectancy({ scoreA: 0.5, scoreB: 1.5, unplayed: rounds.slice(2), aWhite: (n) => n % 2 === 1, profiles: EQUAL });
  assert(behind.a < 0.5 && behind.b > 0.5);
});

test('forcing the live game\'s result orders the stakes: win > draw > loss', () => {
  const profiles = EQUAL;
  const base = { scoreA: 2, scoreB: 2, unplayed: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14], aWhite: (n) => n % 2 === 1, profiles, liveRound: 5 };
  const win = calculateMatchExpectancy({ ...base, liveProbs: { whiteWin: 1, draw: 0, blackWin: 0 } });
  const draw = calculateMatchExpectancy({ ...base, liveProbs: { whiteWin: 0, draw: 1, blackWin: 0 } });
  const loss = calculateMatchExpectancy({ ...base, liveProbs: { whiteWin: 0, draw: 0, blackWin: 1 } });
  assert(win.a > draw.a && draw.a > loss.a);
});
