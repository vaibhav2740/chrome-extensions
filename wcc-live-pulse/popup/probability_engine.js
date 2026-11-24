// WCC Multi-Factor Probability Engine
// Combines Engine Centipawns, Zero-Increment Clock Decay, and Rating/Form Priors.

export function calculateWccProbabilities({
  evalPawns = 0.25,
  whiteTimeSec = 6883,
  blackTimeSec = 4753,
  moveNumber = 13,
  targetMove = 40,
  whiteElo = 2782,
  blackElo = 2710,
  whiteFormBonus = 25,
  blackFormBonus = -10,
}) {
  const mRem = Math.max(1, targetMove - moveNumber);
  const tauW = whiteTimeSec / mRem; // seconds per move
  const tauB = blackTimeSec / mRem;
  const tauRatio = tauW / Math.max(1, tauB);

  // 1. Baseline Draw Probability in Berlin Defense
  // D_base = D_max * exp(-eval^2 / (2 * sigma_D^2))
  const dMax = 0.76;
  const sigmaD = 0.80;
  const dBase = Math.min(0.92, Math.max(0.15, dMax * Math.exp(-(evalPawns ** 2) / (2 * (sigmaD ** 2)))));
  const pDecisive = 1.0 - dBase;

  // 2. Zero-Increment Clock Hazard Shift
  // Without increment before move 40, the blunder hazard scales with log(tauW/tauB) * (mRem / 40)
  const timeWeight = 0.35 * (mRem / 40.0);
  const evalTimeShift = timeWeight * Math.log(tauRatio);

  // 3. Rating & Form Prior Shift
  const deltaElo = (whiteElo + whiteFormBonus) - (blackElo + blackFormBonus);
  const eloShift = (deltaElo / 400.0) * 0.11;

  // 4. Effective Combined Evaluation (Pawns)
  const eEff = evalPawns + evalTimeShift + eloShift;

  // 5. Decisive Partitioning (Logistic Choice)
  const beta = 1.6;
  const wDecisive = 1.0 / (1.0 + Math.pow(10, -eEff * beta));

  let pWhiteWin = pDecisive * wDecisive;
  let pBlackWin = pDecisive * (1.0 - wDecisive);
  let pDraw = dBase;

  // Normalization
  const total = pWhiteWin + pDraw + pBlackWin;
  pWhiteWin /= total;
  pDraw /= total;
  pBlackWin /= total;

  // 6. Championship Match Win Probability (14 Classical Games Series)
  // Amplified by 14-game series length
  const matchSindarov = 1.0 / (1.0 + Math.pow(10, -deltaElo / 220.0));
  const matchGukesh = 1.0 - matchSindarov;

  // Clocks in minutes
  const deltaSec = whiteTimeSec - blackTimeSec;
  const deltaSign = deltaSec >= 0 ? '+' : '-';
  const deltaMin = Math.floor(Math.abs(deltaSec) / 60);
  const deltaRemainingSec = Math.abs(deltaSec) % 60;
  const deltaClockFormatted = `${deltaSign}${deltaMin}m ${deltaRemainingSec}s`;

  return {
    game1: {
      whiteWin: pWhiteWin,
      draw: pDraw,
      blackWin: pBlackWin,
      effectiveEval: eEff,
      timeShift: evalTimeShift,
      formShift: eloShift,
      drawBaseline: dBase,
    },
    match: {
      sindarov: matchSindarov,
      gukesh: matchGukesh,
    },
    clocks: {
      tauWMin: (tauW / 60).toFixed(1),
      tauBMin: (tauB / 60).toFixed(1),
      tauRatio: tauRatio.toFixed(2),
      deltaClockFormatted,
      mRem,
      whiteTimeSec,
      blackTimeSec,
    }
  };
}
