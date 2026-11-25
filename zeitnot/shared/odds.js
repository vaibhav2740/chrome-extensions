// Zeitnot's odds model. It is a transparent heuristic, not a betting model:
//  1. Phase-aware FIDE clock physics (moves 1-40: no increment; from move 41: +30 min once, then +30 s per move).
//  2. A time hazard from the clock ratio plus absolute time scarcity ("zeitnot").
//  3. A draw-adjusted win/draw/loss split around the engine eval, with a rating prior that fades as the game
//     gives real information, and that is the *only* thing used when no engine eval is available.
//  4. An exact dynamic programme over the unplayed games for the match (first to 7.5 of 14, 7-7 goes to tiebreaks).

import { EVENT } from './event.js';

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** Lichess' published eval-to-win-chance curve, as White's chance of 0..1. Used to scale charts, not for the odds. */
export function winChance(pawns) {
  return sigmoid(0.368208 * clamp(pawns, -15, 15));
}

function zeitnotStress(totalSec, tauSec, isPhase2) {
  if (isPhase2) {
    // With 30 s per move coming back every move, stress only rises sharply under about two minutes in total.
    return 0.35 * sigmoid((120 - totalSec) / 40);
  }
  // Before move 41 there is no increment: both a low per-move budget and a low absolute clock matter.
  const paceStress = sigmoid((75 - tauSec) / 22);
  const reserveStress = 0.45 * sigmoid((240 - totalSec) / 80);
  return paceStress + reserveStress;
}

function profileOf(p) {
  return { elo: p.elo, form: p.form ?? 0, rapid: p.rapid ?? 0 };
}

export const DEFAULT_PROFILES = EVENT.players.map(profileOf);

/** Win/draw/loss for one game from the viewpoint of White. */
export function calculateGameProbabilities({
  evalPawns = null,
  mateIn = null,
  evalAgePlies = 0,
  whiteTimeSec = 7200,
  blackTimeSec = 7200,
  moveNumber = 1,
  plyCount = 0,
  whiteElo = 2750,
  blackElo = 2750,
  whiteFormBonus = 0,
  blackFormBonus = 0,
  opening = '',
  result = '*',
} = {}) {
  const safeMove = Math.max(1, moveNumber);
  const isPhase2 = safeMove >= 41;
  const mRem = isPhase2 ? 20 : Math.max(1, 41 - safeMove);

  const safeWhiteSec = Math.max(0, whiteTimeSec);
  const safeBlackSec = Math.max(0, blackTimeSec);
  const effWhiteSec = isPhase2 ? safeWhiteSec + mRem * 30 : safeWhiteSec;
  const effBlackSec = isPhase2 ? safeBlackSec + mRem * 30 : safeBlackSec;
  const tauW = effWhiteSec / mRem;
  const tauB = effBlackSec / mRem;
  const tauRatio = clamp(Math.max(1, tauW) / Math.max(1, tauB), 0.15, 6.5);

  const stressW = plyCount === 0 ? 0 : zeitnotStress(safeWhiteSec, tauW, isPhase2);
  const stressB = plyCount === 0 ? 0 : zeitnotStress(safeBlackSec, tauB, isPhase2);
  const maxStress = Math.max(stressW, stressB);

  const deltaSec = safeWhiteSec - safeBlackSec;
  const clocks = {
    tauWSec: tauW,
    tauBSec: tauB,
    tauRatio,
    deltaSec,
    mRem,
    isPhase2,
    stressW: Number(stressW.toFixed(2)),
    stressB: Number(stressB.toFixed(2)),
    whiteTimeSec: safeWhiteSec,
    blackTimeSec: safeBlackSec,
  };

  const done = (whiteWin, draw, blackWin, extra = {}) => ({
    whiteWin, draw, blackWin, effectiveEval: 0, timeShift: 0, formShift: 0, drawBaseline: draw, known: true, clocks, ...extra,
  });
  if (result === '1-0') return done(1, 0, 0);
  if (result === '0-1') return done(0, 0, 1);
  if (result === '1/2-1/2') return done(0, 1, 0);

  const hasMate = mateIn !== null && mateIn !== undefined && mateIn !== 0;
  const hasPawns = evalPawns !== null && evalPawns !== undefined && !Number.isNaN(Number(evalPawns));
  // Without an engine eval (or before move 1) the model only knows the ratings, the colour and the clocks.
  const known = plyCount > 0 && (hasMate || hasPawns);

  let numericEval = 0;
  if (hasMate) numericEval = mateIn > 0 ? 12 : -12;
  else if (known) numericEval = Number(evalPawns) * Math.pow(0.92, Math.max(0, evalAgePlies));

  const ratioWeight = isPhase2 ? 0.1 : 0.3 * (mRem / 40);
  const timeShift = plyCount === 0 ? 0 : ratioWeight * Math.log(tauRatio) + 0.22 * (stressB - stressW);

  // The rating prior fades as the engine eval takes over; with no eval it stays in full, with White's first-move edge.
  const priorWeight = known ? clamp(1 - plyCount / 150, 0.4, 1) : 1;
  const deltaElo = whiteElo + whiteFormBonus - (blackElo + blackFormBonus);
  const whiteEdge = known ? 0 : 0.15;
  const formShift = ((deltaElo / 400) * 0.6 + whiteEdge) * priorWeight;

  const eEff = numericEval + timeShift + formShift;

  const lowerOpening = (opening || '').toLowerCase();
  const solid = ['berlin', 'petrov', 'petroff', 'exchange'].some((s) => lowerOpening.includes(s));
  let dMax = plyCount === 0 ? 0.62 : solid ? 0.72 : 0.65;
  if (plyCount >= 60 && Math.abs(numericEval) <= 0.3) dMax += 0.07;
  if (maxStress > 0.35) dMax -= 0.15 * Math.min(1, maxStress - 0.35);
  dMax = clamp(dMax, 0.32, 0.84);

  const sigmaD = 0.9;
  const evalForDraw = numericEval + timeShift * 0.75;
  const dFloor = hasMate ? 0.001 : 0.02;
  const dBase = Math.min(0.92, Math.max(dFloor, dMax * Math.exp(-(evalForDraw ** 2) / (2 * sigmaD ** 2))));
  const decisive = 1 - dBase;
  const wShare = sigmoid(3.2 * eEff);

  let pWhite = decisive * wShare;
  let pBlack = decisive * (1 - wShare);
  let pDraw = dBase;
  const total = pWhite + pDraw + pBlack || 1;
  pWhite /= total;
  pBlack /= total;
  pDraw /= total;

  return {
    whiteWin: pWhite,
    draw: pDraw,
    blackWin: pBlack,
    effectiveEval: eEff,
    timeShift,
    formShift,
    drawBaseline: dBase,
    known,
    clocks,
  };
}

/** Odds for a game that has not started, from the two players' profiles ({elo, form}). */
export function pregameOdds(white, black) {
  return calculateGameProbabilities({
    plyCount: 0,
    whiteElo: white.elo,
    blackElo: black.elo,
    whiteFormBonus: white.form,
    blackFormBonus: black.form,
  });
}

/**
 * Exact match odds by dynamic programming over half-points. Player A is EVENT.players[0], B is players[1].
 * `unplayed` lists the classical rounds still to play; `liveRound`/`liveProbs` replace the pre-game odds of one of
 * them (liveProbs is White/Draw/Black for that round). 7.0-7.0 after all games goes to a rapid tiebreak.
 */
export function calculateMatchExpectancy({
  scoreA = 0,
  scoreB = 0,
  unplayed = [],
  aWhite = (round) => round % 2 === (EVENT.firstWhiteIndex === 0 ? 1 : 0),
  liveRound = null,
  liveProbs = null,
  profiles = DEFAULT_PROFILES,
  target = EVENT.target,
} = {}) {
  const goal = Math.round(target * 2);
  const a0 = Math.round(scoreA * 2);
  const b0 = Math.round(scoreB * 2);
  if (a0 >= goal) return { a: 1, b: 0, tiebreak: 0, remaining: 0 };
  if (b0 >= goal) return { a: 0, b: 1, tiebreak: 0, remaining: 0 };

  const [pa, pb] = profiles;
  const rapidA = pa.elo + (pa.rapid || 0);
  const rapidB = pb.elo + (pb.rapid || 0);
  const tiebreakA = 1 / (1 + Math.pow(10, -(rapidA - rapidB) / 400));

  const withA = pregameOdds(pa, pb); // A has White
  const withB = pregameOdds(pb, pa); // B has White
  const roundOdds = (round) => {
    const aIsWhite = aWhite(round);
    if (round === liveRound && liveProbs) {
      return aIsWhite
        ? [liveProbs.whiteWin, liveProbs.draw, liveProbs.blackWin]
        : [liveProbs.blackWin, liveProbs.draw, liveProbs.whiteWin];
    }
    return aIsWhite ? [withA.whiteWin, withA.draw, withA.blackWin] : [withB.blackWin, withB.draw, withB.whiteWin];
  };

  // dist[a * stride + b] is the probability of being at (a, b) half-points with the match still undecided.
  const stride = goal;
  let dist = new Float64Array(stride * stride);
  dist[a0 * stride + b0] = 1;
  let winA = 0;
  let winB = 0;

  for (const round of unplayed) {
    const [pAWin, pDraw, pBWin] = roundOdds(round);
    const next = new Float64Array(stride * stride);
    for (let a = 0; a < goal; a++) {
      for (let b = 0; b < goal; b++) {
        const mass = dist[a * stride + b];
        if (mass === 0) continue;
        const toA = mass * pAWin;
        if (a + 2 >= goal) winA += toA;
        else next[(a + 2) * stride + b] += toA;
        const toD = mass * pDraw;
        if (a + 1 >= goal) winA += toD;
        else if (b + 1 >= goal) winB += toD;
        else next[(a + 1) * stride + b + 1] += toD;
        const toB = mass * pBWin;
        if (b + 2 >= goal) winB += toB;
        else next[a * stride + b + 2] += toB;
      }
    }
    dist = next;
  }

  let tiebreak = 0;
  for (let a = 0; a < goal; a++) {
    for (let b = 0; b < goal; b++) {
      const mass = dist[a * stride + b];
      if (mass === 0) continue;
      if (a > b) winA += mass;
      else if (b > a) winB += mass;
      else {
        tiebreak += mass;
        winA += mass * tiebreakA;
        winB += mass * (1 - tiebreakA);
      }
    }
  }

  const norm = winA + winB || 1;
  return { a: winA / norm, b: winB / norm, tiebreak, remaining: unplayed.length };
}
