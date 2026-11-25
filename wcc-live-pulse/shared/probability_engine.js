// WCC 2026 Multi-Factor Probability & Match Expectancy Engine
// Supports dynamic White/Black player assignment, phase-aware time controls (0s inc <=40, +30s >40),
// real engine evaluations, and exact Backward-Induction DP for 14-game championship title odds.

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
  const isPhase2 = moveNumber >= 40;
  const mRem = isPhase2 ? 20 : Math.max(1, 40 - moveNumber);

  // Effective time per move (Phase 2 adds 30s/move increment buffer)
  const effWhiteSec = isPhase2 ? whiteTimeSec + mRem * 30 : whiteTimeSec;
  const effBlackSec = isPhase2 ? blackTimeSec + mRem * 30 : blackTimeSec;
  const tauW = effWhiteSec / mRem;
  const tauB = effBlackSec / mRem;
  const tauRatio = Math.max(0.2, Math.min(5.0, tauW / Math.max(1, tauB)));

  // Clock delta formatted
  const deltaSec = whiteTimeSec - blackTimeSec;
  const deltaSign = deltaSec >= 0 ? '+' : '-';
  const deltaMin = Math.floor(Math.abs(deltaSec) / 60);
  const deltaRemSec = Math.abs(deltaSec) % 60;
  const deltaClockFormatted = `${deltaSign}${deltaMin}m ${String(deltaRemSec).padStart(2, '0')}s`;

  const clocks = {
    tauWMin: (tauW / 60).toFixed(1),
    tauBMin: (tauB / 60).toFixed(1),
    tauRatio: tauRatio.toFixed(2),
    deltaClockFormatted,
    deltaSec,
    mRem,
    isPhase2,
    whiteTimeSec,
    blackTimeSec,
  };

  // Exact terminal outcome when game is already finished
  if (result === '1-0') {
    return {
      whiteWin: 1,
      draw: 0,
      blackWin: 0,
      effectiveEval: evalPawns,
      timeShift: 0,
      formShift: 0,
      drawBaseline: 0,
      clocks,
    };
  }
  if (result === '0-1') {
    return {
      whiteWin: 0,
      draw: 0,
      blackWin: 1,
      effectiveEval: evalPawns,
      timeShift: 0,
      formShift: 0,
      drawBaseline: 0,
      clocks,
    };
  }
  if (result === '1/2-1/2') {
    return {
      whiteWin: 0,
      draw: 1,
      blackWin: 0,
      effectiveEval: 0,
      timeShift: 0,
      formShift: 0,
      drawBaseline: 1,
      clocks,
    };
  }

  // Handle forced mate evaluations
  const numericEval =
    mateIn !== null && mateIn !== undefined
      ? mateIn > 0
        ? 15
        : -15
      : evalPawns;

  // Baseline draw expectation (Berlin Defense has higher draw rate; pre-game ~63%)
  const isBerlin = (opening || '').toLowerCase().includes('berlin');
  const dMax = plyCount === 0 ? 0.63 : isBerlin ? 0.74 : 0.66;
  const sigmaD = 0.85;
  const dBase = Math.min(
    0.94,
    Math.max(0.04, dMax * Math.exp(-(numericEval ** 2) / (2 * sigmaD ** 2)))
  );
  const pDecisive = 1.0 - dBase;

  // Zero-increment clock hazard shift (only strong in Phase 1 before move 40)
  const timeWeight = isPhase2 ? 0.12 : 0.35 * (mRem / 40.0);
  const evalTimeShift = plyCount === 0 ? 0 : timeWeight * Math.log(tauRatio);

  // Rating & form prior (+0.12 pawns White first-move advantage if pre-game ply 0)
  const deltaElo = whiteElo + whiteFormBonus - (blackElo + blackFormBonus);
  const whiteInitBias = plyCount === 0 ? 0.12 : 0;
  const eloShift = (deltaElo / 400.0) * 0.65 + whiteInitBias;

  const eEff = numericEval + evalTimeShift + eloShift;

  // Logistic decisive partitioning
  const beta = 1.6;
  const wDecisive = 1.0 / (1.0 + Math.pow(10, -eEff * beta));

  let pWhiteWin = pDecisive * wDecisive;
  let pBlackWin = pDecisive * (1.0 - wDecisive);
  let pDraw = dBase;

  const total = pWhiteWin + pDraw + pBlackWin;
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

  // Tiebreak edge based on classical+rapid rating & form
  const sEffRapid = PLAYER_PROFILES.sindarov.elo + PLAYER_PROFILES.sindarov.rapidBonus;
  const gEffRapid = PLAYER_PROFILES.gukesh.elo + PLAYER_PROFILES.gukesh.rapidBonus;
  const tiebreakSindarovProb = 1.0 / (1.0 + Math.pow(10, -(sEffRapid - gEffRapid) / 400.0));

  // Build per-game outcome probabilities { pSWin, pDraw, pGWin } for remaining rounds
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

  // DP state distribution from current score forward through game 14
  // key = `${sHalf},${gHalf}` -> probability mass
  let dist = new Map([[`${sHalfInit},${gHalfInit}`, 1.0]]);
  let pSWinMatch = 0;
  let pGWinMatch = 0;

  for (let r = completedGames + 1; r <= 14; r++) {
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

  // Any remaining mass after game 14 is 7.0 - 7.0 (14,14) -> Tiebreaks
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
    remainingGames: Math.max(0, 14 - completedGames),
  };
}
