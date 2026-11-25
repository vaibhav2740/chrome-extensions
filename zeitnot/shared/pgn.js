// A small, forgiving PGN reader for Lichess broadcast games.
// It scans the movetext once instead of using regexes, so stray comments, nested variations, ";" comments and
// NAGs can never be mistaken for moves. It keeps what Zeitnot needs per move: the clock and the engine eval.

import { tryParseClockSeconds } from './format.js';

const RESULTS = new Set(['1-0', '0-1', '1/2-1/2', '*']);

/** Splits a multi-game PGN download into one string per game. */
export function splitPgnGames(pgnText) {
  if (!pgnText || !pgnText.trim()) return [];
  return pgnText
    .trim()
    .split(/(?=^\[Event\s+")/m)
    .map((c) => c.trim())
    .filter(Boolean);
}

/** Removes (...) variations, which may nest, but keeps everything inside { } comments. */
export function stripPgnVariations(movetext) {
  let out = '';
  let depth = 0;
  let inBrace = false;
  for (let i = 0; i < movetext.length; i++) {
    const ch = movetext[i];
    if (inBrace) {
      if (depth === 0) out += ch;
      if (ch === '}') inBrace = false;
    } else if (ch === '{') {
      inBrace = true;
      if (depth === 0) out += ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      if (depth > 0) depth--;
    } else if (depth === 0) {
      out += ch;
    }
  }
  return out;
}

export function parseHeaders(pgn) {
  const headers = {};
  const re = /^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm;
  let m;
  while ((m = re.exec(pgn)) !== null) headers[m[1]] = m[2].replace(/\\(["\\])/g, '$1');
  return headers;
}

function parseComment(text) {
  const clk = /\[%clk\s+([^\]\s]+)\s*\]/.exec(text);
  const ev = /\[%eval\s+([^\]\s]+)\s*\]/.exec(text);
  let evalPawns = null;
  let mate = null;
  if (ev) {
    const raw = ev[1];
    if (raw.startsWith('#')) {
      const n = parseInt(raw.slice(1), 10);
      // "#0" has no sign to tell who mated, so it carries no usable eval.
      if (!Number.isNaN(n) && n !== 0) {
        mate = n;
        evalPawns = n > 0 ? 12 : -12;
      }
    } else {
      const v = parseFloat(raw);
      if (!Number.isNaN(v)) evalPawns = v;
    }
  }
  return { clk: clk ? tryParseClockSeconds(clk[1]) : null, evalPawns, mate };
}

/** Walks the movetext and returns moves (with clock/eval from the comment that follows each) plus the result token. */
export function parseMovetext(movetext) {
  const moves = [];
  let result = null;
  let moveNumber = 1;
  let blackNext = false;
  let i = 0;
  const n = movetext.length;

  while (i < n) {
    const ch = movetext[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === '{') {
      const end = movetext.indexOf('}', i + 1);
      const body = movetext.slice(i + 1, end === -1 ? n : end);
      const last = moves[moves.length - 1];
      if (last) {
        const c = parseComment(body);
        if (last.clk === null && c.clk !== null) last.clk = c.clk;
        if (last.evalPawns === null && c.evalPawns !== null) {
          last.evalPawns = c.evalPawns;
          last.mate = c.mate;
        }
      }
      i = end === -1 ? n : end + 1;
    } else if (ch === ';') {
      const end = movetext.indexOf('\n', i);
      i = end === -1 ? n : end + 1;
    } else if (ch === '(') {
      let depth = 1;
      i++;
      while (i < n && depth > 0) {
        if (movetext[i] === '{') {
          const end = movetext.indexOf('}', i + 1);
          i = end === -1 ? n : end + 1;
          continue;
        }
        if (movetext[i] === '(') depth++;
        else if (movetext[i] === ')') depth--;
        i++;
      }
    } else if (ch === '$') {
      i++;
      while (i < n && /\d/.test(movetext[i])) i++;
    } else if (ch === '[') {
      const end = movetext.indexOf(']', i + 1);
      i = end === -1 ? n : end + 1;
    } else {
      let j = i;
      while (j < n && !/[\s{(;]/.test(movetext[j])) j++;
      let token = movetext.slice(i, j);
      i = j;

      if (RESULTS.has(token)) {
        result = token;
        continue;
      }
      // "12." / "12..." on its own, or glued to a move: "12.Nf3", "12...Nf6".
      const num = /^(\d+)(\.+)(.*)$/.exec(token);
      if (num) {
        moveNumber = parseInt(num[1], 10);
        blackNext = num[2].length >= 3;
        token = num[3];
        if (!token) continue;
      }
      // Skip "!", "?" annotation glyphs on the end of a move; keep check/mate marks.
      const san = token.replace(/[!?]+$/, '');
      if (!san) continue;
      moves.push({
        ply: moves.length + 1,
        moveNumber,
        isBlack: blackNext,
        san,
        clk: null,
        evalPawns: null,
        mate: null,
      });
      if (blackNext) moveNumber += 1;
      blackNext = !blackNext;
    }
  }
  return { moves, result };
}

/**
 * Parses one broadcast game. Returns the headers Zeitnot uses, every move with its clock and eval, and the
 * "latest" values: each side's last clock, the last eval and which ply it belongs to.
 */
export function parseGame(pgn) {
  const headers = parseHeaders(pgn);
  const lastHeader = [...pgn.matchAll(/^\s*\[\w+\s+"(?:[^"\\]|\\.)*"\]\s*$/gm)].pop();
  const movetext = lastHeader ? pgn.slice(lastHeader.index + lastHeader[0].length) : pgn;
  const { moves, result: tokenResult } = parseMovetext(movetext);

  let whiteClock = null;
  let blackClock = null;
  let lastEval = null;
  for (let k = moves.length - 1; k >= 0; k--) {
    const mv = moves[k];
    if (!mv.isBlack && whiteClock === null && mv.clk !== null) whiteClock = mv.clk;
    if (mv.isBlack && blackClock === null && mv.clk !== null) blackClock = mv.clk;
    if (lastEval === null && mv.evalPawns !== null) {
      lastEval = { pawns: mv.evalPawns, mate: mv.mate, ply: mv.ply };
    }
    if (whiteClock !== null && blackClock !== null && lastEval !== null) break;
  }

  const last = moves[moves.length - 1] || null;
  const headerResult = headers.Result && RESULTS.has(headers.Result) ? headers.Result : null;
  const result = headerResult && headerResult !== '*' ? headerResult : tokenResult || headerResult || '*';
  const openingRaw = headers.Opening && headers.Opening !== '?' ? headers.Opening : '';
  const roundText = headers.Round || '';
  const url = headers.BroadcastURL || '';

  return {
    headers,
    white: headers.White || '',
    black: headers.Black || '',
    whiteElo: parseInt(headers.WhiteElo, 10) || null,
    blackElo: parseInt(headers.BlackElo, 10) || null,
    whiteFideId: parseInt(headers.WhiteFideId, 10) || null,
    blackFideId: parseInt(headers.BlackFideId, 10) || null,
    roundNumber: parseInt(roundText.split('.')[0], 10) || null,
    // The last path segment of the broadcast URL is the Lichess round id, a sturdier key than the Round tag.
    roundId: url ? url.replace(/\/+$/, '').split('/').pop() : null,
    gameUrl: headers.GameURL || url || '',
    result,
    eco: headers.ECO && headers.ECO !== '?' ? headers.ECO : '',
    opening: openingRaw,
    moves,
    plyCount: moves.length,
    completedMoves: last ? last.moveNumber : 0,
    moveNumber: last ? (last.isBlack ? last.moveNumber + 1 : last.moveNumber) : 1,
    isWhiteTurn: last ? last.isBlack : true,
    lastMove: last ? `${last.moveNumber}${last.isBlack ? '...' : '.'} ${last.san}` : null,
    whiteClock,
    blackClock,
    lastEval,
  };
}

/** A short opening name for chips: drops the variation tail ("Ruy Lopez: Berlin Defense, ..." -> "Ruy Lopez: Berlin Defense"). */
export function shortOpening(opening) {
  if (!opening) return '';
  const [family, rest] = opening.split(':').map((s) => s.trim());
  if (!rest) return family;
  const variation = rest.split(',')[0].trim();
  return `${family}: ${variation}`;
}
