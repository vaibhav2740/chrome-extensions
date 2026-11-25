// WCC 2026 Lichess Broadcast Client & PGN/JSON Parser
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

export function parseClockSeconds(str) {
  if (!str) return 7200;
  const parts = String(str)
    .trim()
    .split(':')
    .map((p) => parseInt(p, 10));
  if (parts.some(Number.isNaN)) return 7200;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 7200;
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

/**
 * Splits multi-game PGN text into individual game PGN strings.
 */
export function splitPgnGames(pgnText) {
  if (!pgnText || !pgnText.trim()) return [];
  // Split at [Event "..."] boundaries
  const chunks = pgnText.trim().split(/(?=\[Event\s+")/);
  return chunks.map((c) => c.trim()).filter(Boolean);
}

/**
 * Bulletproof single-game PGN parser.
 * Handles comments containing [%eval ...], [%clk ...], both, or neither, in any order.
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

  // Strip only header tag lines at start of lines so [%eval]/[%clk] inside { ... } remain intact
  const moveSection = pgn
    .replace(/^\s*\[[^\n]*\]\s*$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Match move number prefixes, SAN tokens, and optional { ... } comments sequentially
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
        evalPawns = mateIn > 0 ? 15 : -15;
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
 * Fetches complete WCC 2026 championship state from Lichess Broadcast API.
 * Optionally accepts preferredRoundId ('auto' picks ongoing, else last finished / next upcoming).
 */
export async function fetchWccSnapshot(preferredRoundId = null) {
  const [tourRes, pgnRes] = await Promise.all([
    fetch(TOUR_API_URL, { cache: 'no-store' }),
    fetch(TOUR_PGN_URL, { cache: 'no-store' }),
  ]);

  if (!tourRes.ok) throw new Error(`Tour API HTTP ${tourRes.status}`);
  if (!pgnRes.ok) throw new Error(`Tour PGN HTTP ${pgnRes.status}`);

  const tourJson = await tourRes.json();
  const fullPgn = await pgnRes.text();

  const rounds = tourJson.rounds || [];
  const pgnGames = splitPgnGames(fullPgn).map(parseSingleGamePgn);
  const pgnByRoundNum = new Map(pgnGames.map((g) => [g.roundNumber, g]));

  // Compute authoritative match score from all finished games
  let sindarovScore = 0;
  let gukeshScore = 0;
  let completedGames = 0;
  const sindarovWhiteMap = new Map();

  for (let idx = 0; idx < rounds.length; idx++) {
    const rNum = idx + 1;
    const pgnGame = pgnByRoundNum.get(rNum);
    const rMeta = rounds[idx];

    if (pgnGame) {
      const wProfile = identifyPlayer(pgnGame.white, 'white');
      sindarovWhiteMap.set(rNum, wProfile.key === 'sindarov');

      if (pgnGame.result === '1-0' || pgnGame.result === '0-1' || pgnGame.result === '1/2-1/2') {
        completedGames++;
        if (pgnGame.result === '1/2-1/2') {
          sindarovScore += 0.5;
          gukeshScore += 0.5;
        } else if (
          (pgnGame.result === '1-0' && wProfile.key === 'sindarov') ||
          (pgnGame.result === '0-1' && wProfile.key === 'gukesh')
        ) {
          sindarovScore += 1;
        } else {
          gukeshScore += 1;
        }
      }
    } else if (rMeta.finished) {
      completedGames++;
    }
  }

  // Determine live, last finished, and next upcoming rounds
  const liveRoundIdx = rounds.findIndex((r) => r.ongoing);
  let lastFinishedIdx = -1;
  for (let i = rounds.length - 1; i >= 0; i--) {
    const pgnG = pgnByRoundNum.get(i + 1);
    if (rounds[i].finished || (pgnG && pgnG.result !== '*')) {
      lastFinishedIdx = i;
      break;
    }
  }
  const nextUpcomingIdx = rounds.findIndex(
    (r, idx) => !r.ongoing && !r.finished && idx > lastFinishedIdx
  );

  // Pick which round to display in detail
  let selectedIdx = -1;
  if (preferredRoundId) {
    selectedIdx = rounds.findIndex((r) => r.id === preferredRoundId);
  }
  if (selectedIdx === -1) {
    if (liveRoundIdx !== -1) selectedIdx = liveRoundIdx;
    else if (lastFinishedIdx !== -1) selectedIdx = lastFinishedIdx;
    else selectedIdx = 0;
  }

  const selectedRoundMeta = rounds[selectedIdx];
  const selectedRoundNum = selectedIdx + 1;
  const selectedPgn = pgnByRoundNum.get(selectedRoundNum);

  // Fetch authoritative round JSON for exact clocks, fen, thinkTime, status
  let roundJson = null;
  try {
    const rRes = await fetch(ROUND_JSON_URL(selectedRoundMeta.id), { cache: 'no-store' });
    if (rRes.ok) roundJson = await rRes.json();
  } catch (err) {
    console.warn('[WCC] Round JSON fetch failed, falling back to PGN:', err);
  }

  const apiGame = roundJson?.games?.[0] || null;
  const apiWhite = apiGame?.players?.[0];
  const apiBlack = apiGame?.players?.[1];

  const whiteName = apiWhite?.name || selectedPgn?.white || (selectedRoundNum % 2 === 1 ? 'Sindarov, Javokhir' : 'Gukesh D');
  const blackName = apiBlack?.name || selectedPgn?.black || (selectedRoundNum % 2 === 1 ? 'Gukesh D' : 'Sindarov, Javokhir');
  const wProfile = identifyPlayer(whiteName, 'white');
  const bProfile = identifyPlayer(blackName, 'black');
  const whiteElo = apiWhite?.rating || selectedPgn?.whiteElo || wProfile.elo;
  const blackElo = apiBlack?.rating || selectedPgn?.blackElo || bProfile.elo;

  // Determine exact state of selected round
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

  let status = 'UPCOMING';
  if (selectedRoundMeta.ongoing && normalizedResult === '*') {
    status = 'LIVE';
  } else if (selectedRoundMeta.finished || normalizedResult !== '*') {
    status = 'FINISHED';
  }

  // Clocks: Lichess round JSON returns clock in centiseconds!
  let whiteTimeSec =
    typeof apiWhite?.clock === 'number'
      ? Math.round(apiWhite.clock / 100)
      : selectedPgn?.whiteTimeSec ?? 7200;
  let blackTimeSec =
    typeof apiBlack?.clock === 'number'
      ? Math.round(apiBlack.clock / 100)
      : selectedPgn?.blackTimeSec ?? 7200;

  // Determine turn from FEN (most authoritative) or PGN
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

  // If live and Lichess provides thinkTime (in centiseconds), subtract from active player
  if (status === 'LIVE' && typeof apiGame?.thinkTime === 'number' && apiGame.thinkTime > 0) {
    const thinkSec = Math.floor(apiGame.thinkTime / 100);
    if (isWhiteTurn) whiteTimeSec = Math.max(0, whiteTimeSec - thinkSec);
    else blackTimeSec = Math.max(0, blackTimeSec - thinkSec);
  }

  // Evaluation: prefer PGN [%eval], else query Lichess cloud-eval when LIVE or FEN available
  let evalPawns = selectedPgn?.evalPawns ?? null;
  let mateIn = selectedPgn?.mateIn ?? null;

  if (evalPawns === null && apiGame?.fen && (selectedPgn?.plyCount || 0) > 0) {
    try {
      const evalRes = await fetch(CLOUD_EVAL_URL(apiGame.fen), { cache: 'no-store' });
      if (evalRes.ok) {
        const evalData = await evalRes.json();
        const topPv = evalData?.pvs?.[0];
        if (topPv) {
          if (typeof topPv.mate === 'number') {
            mateIn = topPv.mate;
            evalPawns = mateIn > 0 ? 15 : -15;
          } else if (typeof topPv.cp === 'number') {
            evalPawns = topPv.cp / 100.0;
          }
        }
      }
    } catch {
      // Cloud eval optional; fallback below
    }
  }

  if (evalPawns === null) evalPawns = 0.0;

  // Compute selected round probabilities
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

  // Compute Championship Match Expectancy using DP over all 14 games
  const liveRoundNumber = liveRoundIdx !== -1 ? liveRoundIdx + 1 : null;
  const matchExpectancy = calculateMatchExpectancy({
    sindarovScore,
    gukeshScore,
    completedGames,
    liveRoundNumber,
    liveGameProbs: status === 'LIVE' && selectedRoundNum === liveRoundNumber ? gameProbs : null,
    sindarovWhiteInRound: (r) =>
      sindarovWhiteMap.has(r) ? sindarovWhiteMap.get(r) : r % 2 === 1,
  });

  const nextRoundMeta = nextUpcomingIdx !== -1 ? rounds[nextUpcomingIdx] : null;
  const lastFinishedMeta = lastFinishedIdx !== -1 ? rounds[lastFinishedIdx] : null;

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
    nextRound: nextRoundMeta
      ? {
          id: nextRoundMeta.id,
          name: nextRoundMeta.name,
          roundNumber: nextUpcomingIdx + 1,
          startsAt: nextRoundMeta.startsAt,
          url: nextRoundMeta.url,
        }
      : null,
    lastFinishedRound: lastFinishedMeta
      ? {
          id: lastFinishedMeta.id,
          name: lastFinishedMeta.name,
          roundNumber: lastFinishedIdx + 1,
          result: pgnByRoundNum.get(lastFinishedIdx + 1)?.result || '1/2-1/2',
          url: lastFinishedMeta.url,
        }
      : null,
    activeRound: {
      id: selectedRoundMeta.id,
      name: selectedRoundMeta.name,
      roundNumber: selectedRoundNum,
      status, // 'LIVE' | 'FINISHED' | 'UPCOMING'
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
      lastMove: selectedPgn?.lastMove || (status === 'UPCOMING' ? 'Starts soon' : '—'),
      evalPawns,
      mateIn,
      gameProbs,
    },
  };
}
