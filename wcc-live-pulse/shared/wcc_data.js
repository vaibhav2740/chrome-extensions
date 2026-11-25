// WCC 2026 Lichess Broadcast Client, Hardened PGN/JSON Parser & Clock Anchor
import {
  calculateGameProbabilities,
  calculateMatchExpectancy,
  identifyPlayer,
} from './probability_engine.js';

export const TOUR_ID = 'qfkdt8mn';
export const TOUR_API_URL = `https://lichess.org/api/broadcast/${TOUR_ID}`;
export const TOUR_PGN_URL = `https://lichess.org/api/broadcast/${TOUR_ID}.pgn`;
export const ROUND_JSON_URL = (roundId) => `https://lichess.org/api/broadcast/-/-/${roundId}`;
export const CLOUD_EVAL_URL = (fen) =>
  `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}`;

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Parses H:MM:SS or M:SS into seconds, returning null on invalid formats.
 */
export function tryParseClockSeconds(str) {
  if (typeof str !== 'string' && typeof str !== 'number') return null;
  const trimmed = String(str).trim();
  if (!/^\d{1,2}(:\d{1,2}){1,2}$/.test(trimmed)) return null;
  const parts = trimmed.split(':').map((p) => parseInt(p, 10));
  if (parts.some((p) => Number.isNaN(p) || p < 0)) return null;
  if (parts.length === 3) {
    if (parts[1] >= 60 || parts[2] >= 60) return null;
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    if (parts[1] >= 60) return null;
    return parts[0] * 60 + parts[1];
  }
  return null;
}

export function parseClockSeconds(str) {
  const parsed = tryParseClockSeconds(str);
  return parsed !== null ? parsed : 7200;
}

export function formatClockSeconds(totalSec) {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatCountdown(msRemaining) {
  if (msRemaining <= 0) return 'Starting soon';
  const totalSec = Math.floor(msRemaining / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  if (days > 0) return `${days}d ${hours}h ${String(mins).padStart(2, '0')}m`;
  if (hours > 0) return `${hours}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Strips nested parenthetical RAV variations (...) outside { ... } comments in O(n).
 */
export function stripPgnVariations(movetext) {
  let out = '';
  let parenDepth = 0;
  let inBrace = false;

  for (let i = 0; i < movetext.length; i++) {
    const ch = movetext[i];
    if (ch === '{' && parenDepth === 0) {
      inBrace = true;
      out += ch;
    } else if (ch === '}' && parenDepth === 0) {
      inBrace = false;
      out += ch;
    } else if (!inBrace && ch === '(') {
      parenDepth++;
    } else if (!inBrace && ch === ')') {
      if (parenDepth > 0) parenDepth--;
    } else if (parenDepth === 0) {
      out += ch;
    }
  }
  return out;
}

/**
 * Splits multi-game PGN text into individual game PGN strings.
 */
export function splitPgnGames(pgnText) {
  if (!pgnText || !pgnText.trim()) return [];
  const chunks = pgnText.trim().split(/(?=\[Event\s+")/);
  return chunks.map((c) => c.trim()).filter(Boolean);
}

/**
 * Hardened single-game PGN parser.
 * Strips headers, variations (...), line comments (;...), and NAGs ($1),
 * while preserving [%eval ...] and [%clk ...] inside { ... } in any order.
 */
export function parseSingleGamePgn(pgn) {
  const getHeader = (name) => {
    const m = pgn.match(new RegExp(`\\[${name}\\s+"([^"]*)"\\]`));
    return m ? m[1] : '';
  };

  const white = getHeader('White') || 'White';
  const black = getHeader('Black') || 'Black';
  const whiteElo = parseInt(getHeader('WhiteElo') || '2750', 10);
  const blackElo = parseInt(getHeader('BlackElo') || '2750', 10);
  const roundHeader = getHeader('Round') || '1.1';
  const roundNumber = parseInt(roundHeader.split('.')[0], 10) || 1;
  const result = getHeader('Result') || '*';
  const openingRaw = getHeader('Opening') || '';
  const opening =
    openingRaw && openingRaw !== '?'
      ? openingRaw.includes('Berlin')
        ? 'Berlin Defense'
        : openingRaw.split(':')[0].trim()
      : 'Classical';
  const gameUrl = getHeader('GameURL') || getHeader('BroadcastURL') || '';

  // Strip only header tag lines, end-of-line ; comments, RAV variations, and $NAGs
  const rawMoves = pgn
    .replace(/^\s*\[[^\n]*\]\s*$/gm, ' ')
    .replace(/;[^\n]*/g, ' ');
  const moveSection = stripPgnVariations(rawMoves)
    .replace(/\$\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const moveRegex = /(?:(\d+\.{1,3})\s*)?([^\s{}]+)\s*(?:\{([^}]*)\})?/g;
  const moves = [];
  let currentMoveNum = 1;
  let nextIsBlack = false;
  let match;

  while ((match = moveRegex.exec(moveSection)) !== null) {
    const numDots = match[1] || '';
    const san = match[2];
    if (san === '1/2-1/2' || san === '1-0' || san === '0-1' || san === '*') continue;
    if (/^\d+\.{1,3}$/.test(san)) continue;

    if (numDots) {
      currentMoveNum = parseInt(numDots, 10);
      nextIsBlack = numDots.includes('...');
    }
    const isBlack = nextIsBlack;
    const prefix = `${currentMoveNum}${isBlack ? '... ' : '. '}`;
    const comment = match[3] || '';

    const clkMatch = comment.match(/\[%clk\s+([^\]]+)\]/);
    const evalMatch = comment.match(/\[%eval\s+([^\]]+)\]/);

    let evalPawns = null;
    let mateIn = null;
    if (evalMatch) {
      const rawEval = evalMatch[1].trim();
      if (rawEval.startsWith('#')) {
        mateIn = parseInt(rawEval.slice(1), 10);
        evalPawns = mateIn > 0 ? 12 : -12;
      } else {
        const parsed = parseFloat(rawEval);
        if (!Number.isNaN(parsed)) evalPawns = parsed;
      }
    }

    moves.push({
      moveNumber: currentMoveNum,
      isBlack,
      notation: `${prefix}${san}`,
      san,
      clk: clkMatch ? clkMatch[1].trim() : null,
      evalPawns,
      mateIn,
    });

    if (isBlack) {
      currentMoveNum += 1;
      nextIsBlack = false;
    } else {
      nextIsBlack = true;
    }
  }

  let latestWhiteClk = null;
  let latestBlackClk = null;
  let latestEval = null;
  let latestMate = null;

  for (let i = moves.length - 1; i >= 0; i--) {
    const mv = moves[i];
    if (!mv.isBlack && !latestWhiteClk && mv.clk) latestWhiteClk = mv.clk;
    if (mv.isBlack && !latestBlackClk && mv.clk) latestBlackClk = mv.clk;
    if (latestEval === null && mv.evalPawns !== null) {
      latestEval = mv.evalPawns;
      latestMate = mv.mateIn;
    }
    if (latestWhiteClk && latestBlackClk && latestEval !== null) break;
  }

  const lastMv = moves.length > 0 ? moves[moves.length - 1] : null;
  const isWhiteTurn = lastMv ? lastMv.isBlack : true;
  const completedMoves = lastMv ? lastMv.moveNumber : 0;
  const moveNumber = lastMv ? (lastMv.isBlack ? lastMv.moveNumber + 1 : lastMv.moveNumber) : 1;

  const whiteTimeStr = latestWhiteClk || '2:00:00';
  const blackTimeStr = latestBlackClk || '2:00:00';

  return {
    roundNumber,
    white,
    black,
    whiteElo,
    blackElo,
    result,
    opening,
    gameUrl,
    plyCount: moves.length,
    completedMoves,
    moveNumber,
    isWhiteTurn,
    lastMove: lastMv ? lastMv.notation : 'Not started',
    whiteTimeStr,
    blackTimeStr,
    whiteTimeSec: parseClockSeconds(whiteTimeStr),
    blackTimeSec: parseClockSeconds(blackTimeStr),
    evalPawns: latestEval,
    mateIn: latestMate,
  };
}

/**
 * Reconciles fresh Lichess snapshot against an existing live clock anchor
 * so 15s background polling does not clobber local second-by-second countdowns
 * or explicit user stream calibrations on the same ply.
 */
export function resolveAnchoredSnapshot(freshSnapshot, prevAnchor, now = Date.now()) {
  const ar = freshSnapshot.activeRound;
  if (ar.status !== 'LIVE') {
    return { snapshot: freshSnapshot, anchor: null };
  }

  const samePly =
    prevAnchor &&
    prevAnchor.roundId === ar.id &&
    prevAnchor.plyCount === ar.plyCount;

  if (!samePly) {
    const anchor = {
      roundId: ar.id,
      plyCount: ar.plyCount,
      whiteBaseSec: ar.white.timeSec,
      blackBaseSec: ar.black.timeSec,
      anchoredAt: now,
      isUserCalibrated: false,
    };
    return { snapshot: freshSnapshot, anchor };
  }

  // Same ply while live: compute elapsed time from previous anchor
  const elapsedSec = Math.max(0, Math.floor((now - prevAnchor.anchoredAt) / 1000));
  const anchoredWhiteSec = ar.isWhiteTurn
    ? Math.max(0, prevAnchor.whiteBaseSec - elapsedSec)
    : prevAnchor.whiteBaseSec;
  const anchoredBlackSec = !ar.isWhiteTurn
    ? Math.max(0, prevAnchor.blackBaseSec - elapsedSec)
    : prevAnchor.blackBaseSec;

  // Prefer explicit user stream calibration, or whichever live clock is more up to date
  const finalWhiteSec = prevAnchor.isUserCalibrated
    ? anchoredWhiteSec
    : Math.min(ar.white.timeSec, anchoredWhiteSec);
  const finalBlackSec = prevAnchor.isUserCalibrated
    ? anchoredBlackSec
    : Math.min(ar.black.timeSec, anchoredBlackSec);

  ar.white.timeSec = finalWhiteSec;
  ar.white.timeStr = formatClockSeconds(finalWhiteSec);
  ar.black.timeSec = finalBlackSec;
  ar.black.timeStr = formatClockSeconds(finalBlackSec);

  // Recompute probabilities cleanly with anchored clocks
  const wProfile = identifyPlayer(ar.white.fullName, 'white');
  const bProfile = identifyPlayer(ar.black.fullName, 'black');
  ar.gameProbs = calculateGameProbabilities({
    evalPawns: ar.evalPawns,
    mateIn: ar.mateIn,
    whiteTimeSec: finalWhiteSec,
    blackTimeSec: finalBlackSec,
    moveNumber: ar.moveNumber,
    plyCount: ar.plyCount,
    whiteElo: ar.white.elo,
    blackElo: ar.black.elo,
    whiteFormBonus: wProfile.formBonus,
    blackFormBonus: bProfile.formBonus,
    opening: ar.opening,
    result: ar.result,
  });

  return { snapshot: freshSnapshot, anchor: prevAnchor };
}

/**
 * Fetches complete WCC 2026 championship state from Lichess Broadcast API.
 * Auto-selects: live round -> imminent/default upcoming round -> last finished round.
 */
export async function fetchWccSnapshot(preferredRoundId = null) {
  const [tourRes, pgnRes] = await Promise.all([
    fetchWithTimeout(TOUR_API_URL, { cache: 'no-store' }),
    fetchWithTimeout(TOUR_PGN_URL, { cache: 'no-store' }),
  ]);

  if (!tourRes.ok) throw new Error(`Tour API HTTP ${tourRes.status}`);
  if (!pgnRes.ok) throw new Error(`Tour PGN HTTP ${pgnRes.status}`);

  const tourJson = await tourRes.json();
  const fullPgn = await pgnRes.text();

  const rounds = tourJson.rounds || [];
  if (rounds.length === 0) {
    throw new Error('No broadcast rounds found');
  }

  const pgnGames = splitPgnGames(fullPgn).map(parseSingleGamePgn);
  const pgnByRoundNum = new Map(pgnGames.map((g) => [g.roundNumber, g]));

  let sindarovScore = 0;
  let gukeshScore = 0;
  let completedGames = 0;
  const sindarovWhiteMap = new Map();
  const unplayedRoundNumbers = [];
  const roundsSummary = [];

  for (let idx = 0; idx < rounds.length; idx++) {
    const rNum = idx + 1;
    const rMeta = rounds[idx];
    const pgnGame = pgnByRoundNum.get(rNum);

    if (pgnGame) {
      const wProfile = identifyPlayer(pgnGame.white, 'white');
      sindarovWhiteMap.set(rNum, wProfile.key === 'sindarov');
    } else {
      sindarovWhiteMap.set(rNum, rNum % 2 === 1);
    }

    const result = pgnGame?.result || '*';
    const isFinished = Boolean(rMeta.finished) || result !== '*';
    const isLive = Boolean(rMeta.ongoing) && !isFinished;

    if (isFinished) {
      completedGames++;
      if (result === '1/2-1/2') {
        sindarovScore += 0.5;
        gukeshScore += 0.5;
      } else if (result === '1-0' || result === '0-1') {
        const sIsWhite = sindarovWhiteMap.get(rNum);
        if ((result === '1-0' && sIsWhite) || (result === '0-1' && !sIsWhite)) {
          sindarovScore += 1;
        } else {
          gukeshScore += 1;
        }
      }
    } else {
      unplayedRoundNumbers.push(rNum);
    }

    roundsSummary.push({
      id: rMeta.id,
      name: rMeta.name || `Game ${rNum}`,
      roundNumber: rNum,
      status: isLive ? 'LIVE' : isFinished ? 'FINISHED' : 'UPCOMING',
      result,
      startsAt: rMeta.startsAt || null,
      url: rMeta.url,
    });
  }

  const liveRoundIdx = roundsSummary.findIndex((r) => r.status === 'LIVE');
  let lastFinishedIdx = -1;
  for (let i = roundsSummary.length - 1; i >= 0; i--) {
    if (roundsSummary[i].status === 'FINISHED') {
      lastFinishedIdx = i;
      break;
    }
  }
  const nextUpcomingIdx = roundsSummary.findIndex(
    (r, idx) => r.status === 'UPCOMING' && idx > lastFinishedIdx
  );

  let selectedIdx = -1;
  if (preferredRoundId) {
    selectedIdx = rounds.findIndex((r) => r.id === preferredRoundId);
  }
  if (selectedIdx === -1) {
    if (liveRoundIdx !== -1) {
      selectedIdx = liveRoundIdx;
    } else if (nextUpcomingIdx !== -1) {
      const nextR = roundsSummary[nextUpcomingIdx];
      const msUntilNext = (nextR.startsAt || Infinity) - Date.now();
      const isDefaultOrImminent =
        tourJson.defaultRoundId === nextR.id || msUntilNext <= 3 * 3600 * 1000;
      selectedIdx = isDefaultOrImminent || lastFinishedIdx === -1 ? nextUpcomingIdx : lastFinishedIdx;
    } else if (lastFinishedIdx !== -1) {
      selectedIdx = lastFinishedIdx;
    } else {
      selectedIdx = 0;
    }
  }

  const selectedRoundMeta = rounds[selectedIdx];
  const selectedSummary = roundsSummary[selectedIdx];
  const selectedRoundNum = selectedIdx + 1;
  const selectedPgn = pgnByRoundNum.get(selectedRoundNum);

  let roundJson = null;
  try {
    const rRes = await fetchWithTimeout(ROUND_JSON_URL(selectedRoundMeta.id), { cache: 'no-store' });
    if (rRes.ok) roundJson = await rRes.json();
  } catch (err) {
    console.warn('[WCC] Round JSON fetch failed, falling back to PGN:', err);
  }

  const apiGame = roundJson?.games?.[0] || null;
  const apiWhite = apiGame?.players?.[0];
  const apiBlack = apiGame?.players?.[1];

  const whiteName =
    apiWhite?.name ||
    selectedPgn?.white ||
    (sindarovWhiteMap.get(selectedRoundNum) ? 'Sindarov, Javokhir' : 'Gukesh D');
  const blackName =
    apiBlack?.name ||
    selectedPgn?.black ||
    (sindarovWhiteMap.get(selectedRoundNum) ? 'Gukesh D' : 'Sindarov, Javokhir');
  const wProfile = identifyPlayer(whiteName, 'white');
  const bProfile = identifyPlayer(blackName, 'black');
  const whiteElo = apiWhite?.rating || selectedPgn?.whiteElo || wProfile.elo;
  const blackElo = apiBlack?.rating || selectedPgn?.blackElo || bProfile.elo;

  const pgnResult = selectedPgn?.result || '*';
  const apiStatus = apiGame?.status || '*';
  const normalizedResult =
    pgnResult !== '*'
      ? pgnResult
      : apiStatus === '½-½'
        ? '1/2-1/2'
        : apiStatus === '1-0' || apiStatus === '0-1'
          ? apiStatus
          : '*';

  let status = selectedSummary.status;
  if (normalizedResult !== '*') status = 'FINISHED';

  let whiteTimeSec =
    typeof apiWhite?.clock === 'number'
      ? Math.round(apiWhite.clock / 100)
      : selectedPgn?.whiteTimeSec ?? 7200;
  let blackTimeSec =
    typeof apiBlack?.clock === 'number'
      ? Math.round(apiBlack.clock / 100)
      : selectedPgn?.blackTimeSec ?? 7200;

  let isWhiteTurn = selectedPgn?.isWhiteTurn ?? true;
  let moveNumber = selectedPgn?.moveNumber ?? 1;
  if (apiGame?.fen) {
    const fenParts = apiGame.fen.split(' ');
    if (fenParts[1] === 'w' || fenParts[1] === 'b') {
      isWhiteTurn = fenParts[1] === 'w';
    }
    const fenMoveNum = parseInt(fenParts[5], 10);
    if (!Number.isNaN(fenMoveNum)) {
      moveNumber = fenMoveNum;
    }
  }

  if (status === 'LIVE' && typeof apiGame?.thinkTime === 'number' && apiGame.thinkTime > 0) {
    const thinkSec = Math.floor(apiGame.thinkTime / 100);
    if (isWhiteTurn) whiteTimeSec = Math.max(0, whiteTimeSec - thinkSec);
    else blackTimeSec = Math.max(0, blackTimeSec - thinkSec);
  }

  let evalPawns = selectedPgn?.evalPawns ?? null;
  let mateIn = selectedPgn?.mateIn ?? null;

  if (evalPawns === null && apiGame?.fen && (selectedPgn?.plyCount || 0) > 0) {
    try {
      const evalRes = await fetchWithTimeout(CLOUD_EVAL_URL(apiGame.fen), { cache: 'no-store' }, 4000);
      if (evalRes.ok) {
        const evalData = await evalRes.json();
        const topPv = evalData?.pvs?.[0];
        if (topPv) {
          if (typeof topPv.mate === 'number') {
            mateIn = topPv.mate;
            evalPawns = mateIn > 0 ? 12 : -12;
          } else if (typeof topPv.cp === 'number') {
            evalPawns = topPv.cp / 100.0;
          }
        }
      }
    } catch {
      // Cloud eval optional
    }
  }

  if (evalPawns === null) evalPawns = 0.0;

  const gameProbs = calculateGameProbabilities({
    evalPawns,
    mateIn,
    whiteTimeSec,
    blackTimeSec,
    moveNumber,
    plyCount: selectedPgn?.plyCount || 0,
    whiteElo,
    blackElo,
    whiteFormBonus: wProfile.formBonus,
    blackFormBonus: bProfile.formBonus,
    opening: selectedPgn?.opening || '',
    result: normalizedResult,
  });

  const liveRoundNumber = liveRoundIdx !== -1 ? liveRoundIdx + 1 : null;
  const matchExpectancy = calculateMatchExpectancy({
    sindarovScore,
    gukeshScore,
    completedGames,
    unplayedRoundNumbers,
    liveRoundNumber,
    liveGameProbs: status === 'LIVE' && selectedRoundNum === liveRoundNumber ? gameProbs : null,
    sindarovWhiteInRound: (r) =>
      sindarovWhiteMap.has(r) ? sindarovWhiteMap.get(r) : r % 2 === 1,
  });

  const nextRoundMeta = nextUpcomingIdx !== -1 ? roundsSummary[nextUpcomingIdx] : null;
  const lastFinishedMeta = lastFinishedIdx !== -1 ? roundsSummary[lastFinishedIdx] : null;

  return {
    fetchedAt: Date.now(),
    tourName: tourJson.tour?.name || 'FIDE World Chess Championship 2026',
    tourUrl: tourJson.tour?.url || `https://lichess.org/broadcast/fide-world-chess-championship-2026/${TOUR_ID}`,
    matchScore: {
      sindarov: sindarovScore,
      gukesh: gukeshScore,
      completedGames,
    },
    matchExpectancy,
    isAnyGameLive: liveRoundIdx !== -1,
    rounds: roundsSummary,
    nextRound: nextRoundMeta,
    lastFinishedRound: lastFinishedMeta,
    activeRound: {
      id: selectedRoundMeta.id,
      name: selectedRoundMeta.name || `Game ${selectedRoundNum}`,
      roundNumber: selectedRoundNum,
      status,
      result: normalizedResult,
      startsAt: selectedRoundMeta.startsAt,
      finishedAt: selectedRoundMeta.finishedAt || null,
      url: selectedPgn?.gameUrl || selectedRoundMeta.url,
      opening: selectedPgn?.opening || (status === 'UPCOMING' ? 'Pre-Game' : 'Classical'),
      white: {
        name: wProfile.shortName,
        fullName: whiteName,
        elo: whiteElo,
        key: wProfile.key,
        timeSec: whiteTimeSec,
        timeStr: formatClockSeconds(whiteTimeSec),
      },
      black: {
        name: bProfile.shortName,
        fullName: blackName,
        elo: blackElo,
        key: bProfile.key,
        timeSec: blackTimeSec,
        timeStr: formatClockSeconds(blackTimeSec),
      },
      moveNumber,
      completedMoves: selectedPgn?.completedMoves || 0,
      plyCount: selectedPgn?.plyCount || 0,
      isWhiteTurn,
      lastMove: selectedPgn?.lastMove || (status === 'UPCOMING' ? 'Not started' : '—'),
      evalPawns,
      mateIn,
      gameProbs,
    },
  };
}
