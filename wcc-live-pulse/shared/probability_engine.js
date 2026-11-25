// WCC 2026 Multi-Factor Probability & Match Expectancy Engine
// Implements:
//  1. Phase-aware FIDE WCC 2026 clock physics (Move <= 40: 0s inc; Move >= 41: +30m + 30s/move)
//  2. Absolute zeitnot (time scarcity) hazard + log-ratio time differential
//  3. Double-logistic / Gaussian Draw-Adjusted WDL conversion calibrated for 2750+ classical chess
//  4. Exact Backward-Induction DP over remaining unplayed rounds for 14-game Championship Odds

export const PLAYER_PROFILES = {
  sindarov: {
    key: 'sindarov',
    shortName: 'Sindarov',
    elo: 2782,
    formBonus: 25,
    rapidBonus: 35,
  },
  gukesh: {
    key: 'gukesh',
    shortName: 'Gukesh',
    elo: 2710,
    formBonus: -10,
    rapidBonus: 0,
  },
};

export function identifyPlayer(name, fallbackColor) {
  const lower = (name || '').toLowerCase();
  if (lower.includes('sindarov')) return PLAYER_PROFILES.sindarov;
  if (lower.includes('gukesh')) return PLAYER_PROFILES.gukesh;
  return fallbackColor === 'white' ? PLAYER_PROFILES.sindarov : PLAYER_PROFILES.gukesh;
}

function sigmoid(x) {
  return 1.0 / (1.0 + Math.exp(-x));
}

function computeZeitnotStress(totalSec, tauSec, isPhase2) {
  if (isPhase2) {
    // With 30s/move increment, stress rises sharply only under ~2 minutes total
    return 0.35 * sigmoid((120 - totalSec) / 40);
  }
  // Phase 1 (zero increment until move 40 completion): both low per-move budget and low absolute clock matter
  const paceStress = sigmoid((75 - tauSec) / 22);
  const reserveStress = 0.45 * sigmoid((240 - totalSec) / 80);
  return paceStress + reserveStress;
}

export function calculateGameProbabilities({
  evalPawns = 0.0,
  mateIn = null,
  whiteTimeSec = 7200,
  blackTimeSec = 7200,
  moveNumber = 1,
  plyCount = 0,
  whiteElo = 2782,
  blackElo = 2710,
  whiteFormBonus = 25,
  blackFormBonus = -10,
  opening = '',
  result = '*',
}) {
  // FIDE WCC 2026: Move 40 is still Phase 1 (0s increment); Phase 2 begins at Move 41.
  const safeMove = Math.max(1, moveNumber);
  const isPhase2 = safeMove >= 41;
  const mRem = isPhase2 ? 20 : Math.max(1, 41 - safeMove);

  const safeWhiteSec = Math.max(0, whiteTimeSec);
  const safeBlackSec = Math.max(0, blackTimeSec);

  // Effective time per move (Phase 2 adds 30s/move increment horizon)
  const effWhiteSec = isPhase2 ? safeWhiteSec + mRem * 30 : safeWhiteSec;
  const effBlackSec = isPhase2 ? safeBlackSec + mRem * 30 : safeBlackSec;
  const tauW = effWhiteSec / mRem;
  const tauB = effBlackSec / mRem;
  const tauRatio = Math.max(0.15, Math.min(6.5, Math.max(1, tauW) / Math.max(1, tauB)));

  const deltaSec = safeWhiteSec - safeBlackSec;
  const deltaSign = deltaSec >= 0 ? '+' : '-';
  const deltaMin = Math.floor(Math.abs(deltaSec) / 60);
  const deltaRemSec = Math.abs(deltaSec) % 60;
  const deltaClockFormatted = `${deltaSign}${deltaMin}m ${String(deltaRemSec).padStart(2, '0')}s`;

  const stressW = plyCount === 0 ? 0 : computeZeitnotStress(safeWhiteSec, tauW, isPhase2);
  const stressB = plyCount === 0 ? 0 : computeZeitnotStress(safeBlackSec, tauB, isPhase2);
  const maxStress = Math.max(stressW, stressB);

  const clocks = {
    tauWMin: (tauW / 60).toFixed(1),
    tauBMin: (tauB / 60).toFixed(1),
    tauRatio: tauRatio.toFixed(2),
    deltaClockFormatted,
    deltaSec,
    mRem,
    isPhase2,
    stressW: Number(stressW.toFixed(2)),
    stressB: Number(stressB.toFixed(2)),
    whiteTimeSec: safeWhiteSec,
    blackTimeSec: safeBlackSec,
  };

  if (result === '1-0') {
    return { whiteWin: 1, draw: 0, blackWin: 0, effectiveEval: evalPawns, timeShift: 0, formShift: 0, drawBaseline: 0, clocks };
  }
  if (result === '0-1') {
    return { whiteWin: 0, draw: 0, blackWin: 1, effectiveEval: evalPawns, timeShift: 0, formShift: 0, drawBaseline: 0, clocks };
  }
  if (result === '1/2-1/2') {
    return { whiteWin: 0, draw: 1, blackWin: 0, effectiveEval: 0, timeShift: 0, formShift: 0, drawBaseline: 1, clocks };
  }

  // Handle forced mate evaluations smoothly
  const numericEval =
    mateIn !== null && mateIn !== undefined
      ? mateIn > 0
        ? 12
        : -12
      : Number(evalPawns || 0);

  // 1. Time Hazard Shift (log-ratio + asymmetric zeitnot stress)
  const ratioWeight = isPhase2 ? 0.10 : 0.30 * (mRem / 40.0);
  const evalTimeShift =
    plyCount === 0
      ? 0
      : ratioWeight * Math.log(tauRatio) + 0.22 * (stressB - stressW);

  // 2. Rating & Form Prior (+0.15 pawns White first-move edge pre-game)
  const deltaElo = whiteElo + whiteFormBonus - (blackElo + blackFormBonus);
  const whiteInitBias = plyCount === 0 ? 0.15 : 0;
  const eloShift = (deltaElo / 400.0) * 0.60 + whiteInitBias;

  // 3. Combined Effective Evaluation
  const eEff = numericEval + evalTimeShift + eloShift;

  // 4. Context-Aware Draw Baseline
  const lowerOpen = (opening || '').toLowerCase();
  const isSolidOpening =
    lowerOpen.includes('berlin') ||
    lowerOpen.includes('petrov') ||
    lowerOpen.includes('petroff') ||
    lowerOpen.includes('exchange');
  let dMax = plyCount === 0 ? 0.62 : isSolidOpening ? 0.72 : 0.65;

  // Late simplified equal endgames naturally draw more often when not in zeitnot
  if (plyCount >= 60 && Math.abs(numericEval) <= 0.30) {
    dMax += 0.07;
  }
  // Acute zero-increment zeitnot injects blunder variance, compressing draw stability
  if (maxStress > 0.35) {
    dMax -= 0.15 * Math.min(1, maxStress - 0.35);
  }
  dMax = Math.max(0.32, Math.min(0.84, dMax));

  const sigmaD = 0.90;
  const evalForDraw = numericEval + evalTimeShift * 0.75;
  const dFloor = mateIn !== null && mateIn !== undefined ? 0.001 : 0.02;
  const dBase = Math.min(
    0.92,
    Math.max(dFloor, dMax * Math.exp(-(evalForDraw ** 2) / (2 * sigmaD ** 2)))
  );
  const pDecisive = 1.0 - dBase;

  // 5. Logistic Decisive Partitioning
  const k = 3.2;
  const wShare = sigmoid(k * eEff);

  let pWhiteWin = pDecisive * wShare;
  let pBlackWin = pDecisive * (1.0 - wShare);
  let pDraw = dBase;

  const total = pWhiteWin + pDraw + pBlackWin || 1;
  pWhiteWin /= total;
  pBlackWin /= total;
  pDraw /= total;

  return {
    whiteWin: pWhiteWin,
    draw: pDraw,
    blackWin: pBlackWin,
    effectiveEval: eEff,
    timeShift: evalTimeShift,
    formShift: eloShift,
    drawBaseline: dBase,
    clocks,
  };
}

/**
 * Exact Backward-Induction Dynamic Programming for 14-Game Match Championship Odds.
 * First to 7.5 points wins outright; 7.0 - 7.0 goes to Rapid/Blitz Tiebreaks.
 */
export function calculateMatchExpectancy({
  sindarovScore = 0,
  gukeshScore = 0,
  completedGames = 0,
  unplayedRoundNumbers = null,
  liveRoundNumber = null,
  liveGameProbs = null, // { whiteWin, draw, blackWin } for liveRoundNumber
  sindarovWhiteInRound = (roundNum) => roundNum % 2 === 1, // Game 1,3,5... Sindarov White
}) {
  const sHalfInit = Math.round(sindarovScore * 2);
  const gHalfInit = Math.round(gukeshScore * 2);

  if (sHalfInit >= 15) {
    return { sindarov: 1, gukesh: 0, tiebreakRisk: 0, remainingGames: 0 };
  }
  if (gHalfInit >= 15) {
    return { sindarov: 0, gukesh: 1, tiebreakRisk: 0, remainingGames: 0 };
  }

  const remainingList =
    Array.isArray(unplayedRoundNumbers) && unplayedRoundNumbers.length > 0
      ? unplayedRoundNumbers
      : Array.from({ length: Math.max(0, 14 - completedGames) }, (_, i) => completedGames + i + 1);

  // Tiebreak edge based on classical + rapid strength
  const sEffRapid = PLAYER_PROFILES.sindarov.elo + PLAYER_PROFILES.sindarov.rapidBonus;
  const gEffRapid = PLAYER_PROFILES.gukesh.elo + PLAYER_PROFILES.gukesh.rapidBonus;
  const tiebreakSindarovProb = 1.0 / (1.0 + Math.pow(10, -(sEffRapid - gEffRapid) / 400.0));

  const preGameSindarovWhite = calculateGameProbabilities({
    evalPawns: 0,
    plyCount: 0,
    whiteElo: PLAYER_PROFILES.sindarov.elo,
    blackElo: PLAYER_PROFILES.gukesh.elo,
    whiteFormBonus: PLAYER_PROFILES.sindarov.formBonus,
    blackFormBonus: PLAYER_PROFILES.gukesh.formBonus,
  });
  const preGameGukeshWhite = calculateGameProbabilities({
    evalPawns: 0,
    plyCount: 0,
    whiteElo: PLAYER_PROFILES.gukesh.elo,
    blackElo: PLAYER_PROFILES.sindarov.elo,
    whiteFormBonus: PLAYER_PROFILES.gukesh.formBonus,
    blackFormBonus: PLAYER_PROFILES.sindarov.formBonus,
  });

  function gameProbsForRound(r) {
    const sIsWhite = sindarovWhiteInRound(r);
    if (r === liveRoundNumber && liveGameProbs) {
      return sIsWhite
        ? { pS: liveGameProbs.whiteWin, pD: liveGameProbs.draw, pG: liveGameProbs.blackWin }
        : { pS: liveGameProbs.blackWin, pD: liveGameProbs.draw, pG: liveGameProbs.whiteWin };
    }
    return sIsWhite
      ? { pS: preGameSindarovWhite.whiteWin, pD: preGameSindarovWhite.draw, pG: preGameSindarovWhite.blackWin }
      : { pS: preGameGukeshWhite.blackWin, pD: preGameGukeshWhite.draw, pG: preGameGukeshWhite.whiteWin };
  }

  let dist = new Map([[`${sHalfInit},${gHalfInit}`, 1.0]]);
  let pSWinMatch = 0;
  let pGWinMatch = 0;

  for (const r of remainingList) {
    const { pS, pD, pG } = gameProbsForRound(r);
    const nextDist = new Map();

    const addMass = (s, g, prob) => {
      if (prob <= 0) return;
      if (s >= 15) {
        pSWinMatch += prob;
        return;
      }
      if (g >= 15) {
        pGWinMatch += prob;
        return;
      }
      const key = `${s},${g}`;
      nextDist.set(key, (nextDist.get(key) || 0) + prob);
    };

    for (const [key, prob] of dist.entries()) {
      const [s, g] = key.split(',').map(Number);
      addMass(s + 2, g, prob * pS);
      addMass(s + 1, g + 1, prob * pD);
      addMass(s, g + 2, prob * pG);
    }
    dist = nextDist;
  }

  let pTiebreak = 0;
  for (const [key, prob] of dist.entries()) {
    const [s, g] = key.split(',').map(Number);
    if (s > g) pSWinMatch += prob;
    else if (g > s) pGWinMatch += prob;
    else {
      pTiebreak += prob;
      pSWinMatch += prob * tiebreakSindarovProb;
      pGWinMatch += prob * (1 - tiebreakSindarovProb);
    }
  }

  const norm = pSWinMatch + pGWinMatch || 1;
  return {
    sindarov: pSWinMatch / norm,
    gukesh: pGWinMatch / norm,
    tiebreakRisk: pTiebreak,
    remainingGames: remainingList.length,
  };
}
