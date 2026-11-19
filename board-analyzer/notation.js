// Chess text: FEN tidying, engine lines as moves, scores.
import { Chess } from './lib/chess.js';

// Engine line (UCI moves) as numbered SAN, e.g. "1.e4 e5 2.Nf3".
export function pvToSan(fen, pv, max = 7) {
  const g = new Chess(fen);
  const out = [];
  let white = g.turn() === 'w';
  let n = +fen.split(' ')[5] || 1;
  for (const uci of pv.slice(0, max)) {
    let m;
    try { m = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch (e) { break; }
    if (!m) break;
    out.push((white ? `${n}.` : out.length === 0 ? `${n}…` : '') + m.san);
    if (!white) n++;
    white = !white;
  }
  return out.join(' ');
}

// A FEN with any missing trailing fields filled in.
export function normalizeFen(raw) {
  const f = raw.trim().replace(/\s+/g, ' ').split(' ');
  const defaults = ['w', '-', '-', '0', '1'];
  while (f.length < 6) f.push(defaults[f.length - 1]);
  return f.join(' ');
}

export function fmtScore(l) {
  if (!l) return '';
  if (l.mate != null) return (l.mate > 0 ? '+M' : '-M') + Math.abs(l.mate);
  const v = l.cp / 100;
  return (v > 0 ? '+' : '') + v.toFixed(2);
}

export function scoreClass(l) {
  const v = l.mate != null ? l.mate : l.cp;
  return v > 0 ? 'pos' : v < 0 ? 'neg' : '';
}

// The one legal move that turns `fen` into a position with these pieces (FEN placement), by either side, or null.
// Following a video, this tells who moved, so the side to move, castling and en passant stay right move after move.
export function findMove(fen, placement) {
  const parts = fen.split(' ');
  for (const color of [parts[1], parts[1] === 'w' ? 'b' : 'w']) {
    let g;
    try { g = new Chess(color === parts[1] ? fen : [parts[0], color, parts[2], '-', parts[4], parts[5]].join(' ')); } catch (e) { continue; }
    for (const m of g.moves({ verbose: true })) {
      g.move(m);
      if (g.fen().split(' ')[0] === placement) {
        const after = g.fen();
        return { fen: after, san: m.san, from: m.from, to: m.to };
      }
      g.undo();
    }
  }
  return null;
}

// A quick way to walk through legal moves. chess.js's public moves() also writes every move's name (SAN), which
// needs a trial move per move for the check sign; a search through thousands of positions only needs the moves
// themselves, so this uses the generator underneath (lib/chess.js is a pinned copy), with the public API as a
// fallback. Squares are numbered 0..63 from a8 to h1 like a FEN placement; cell(i) is a FEN letter or '.'.
const NAMES = Array.from({ length: 64 }, (_, i) => 'abcdefgh'[i & 7] + (8 - (i >> 3)));
export function walker(fen) {
  const g = new Chess(fen);
  if (typeof g._moves === 'function' && typeof g._makeMove === 'function' && typeof g._undoMove === 'function' && Array.isArray(g._board)) {
    const ox = (i) => (i >> 3) * 16 + (i & 7);
    const name = (sq) => 'abcdefgh'[sq & 15] + (8 - (sq >> 4));
    return {
      moves: (i) => g._moves({ legal: true, square: i == null ? undefined : NAMES[i] }),
      make: (m) => g._makeMove(m),
      undo: () => g._undoMove(),
      cell(i) {
        const p = g._board[ox(i)];
        return p ? (p.color === 'w' ? p.type.toUpperCase() : p.type) : '.';
      },
      plain: (m) => ({ from: name(m.from), to: name(m.to), promotion: m.promotion }),
    };
  }
  let board = null;
  const grid = () => board || (board = expand(g.fen().split(' ')[0]));
  return {
    moves: (i) => g.moves({ verbose: true, square: i == null ? undefined : NAMES[i] }),
    make: (m) => { g.move(m); board = null; },
    undo: () => { g.undo(); board = null; },
    cell: (i) => grid()[i],
    plain: (m) => ({ from: m.from, to: m.to, promotion: m.promotion }),
  };
}

// Replays plain moves ({from, to, promotion}) from `fen` and names them. -> [{ san, from, to, fen }]
export function nameMoves(fen, plain) {
  const g = new Chess(fen);
  return plain.map((p) => {
    const m = g.move({ from: p.from, to: p.to, promotion: p.promotion });
    return { san: m.san, from: m.from, to: m.to, fen: g.fen() };
  });
}

// Up to `maxPly` legal moves in a row that turn `fen` into a position with these pieces (FEN placement), or null.
// When moves come faster than the video can be read, one read can land two or three moves later; this finds the moves
// in between so the move list stays complete. The shortest line wins. A line that only puts a piece back where it just
// came from is not taken: that is someone stepping back through the moves, not a move.
// prior: the moves just before `fen` ({from, to}, oldest first), to spot such steps back.
// -> { fen, moves: [{ san, from, to, fen }] }
export function findLine(fen, placement, { maxPly = 3, prior = [] } = {}) {
  const goal = expand(placement);
  const parts = fen.split(' ');
  const other = [parts[0], parts[1] === 'w' ? 'b' : 'w', parts[2], '-', parts[4], parts[5]].join(' ');
  for (let depth = 1; depth <= maxPly; depth++) {
    // a wrong side to move is only a guess worth fixing for a single move
    for (const start of depth === 1 ? [fen, other] : [fen]) {
      let w;
      try { w = walker(start); } catch (e) { continue; }
      // for the other side, its own previous move is the last one played
      const pri = start === fen ? prior : prior.concat([{ from: '', to: '' }]);
      const budget = { left: 200000 }; // positions looked at, so a slow computer never stalls on a hopeless search
      const hit = search(w, goal, depth, [], pri, budget);
      if (hit) {
        const moves = nameMoves(start, hit);
        return { fen: moves[moves.length - 1].fen, moves };
      }
    }
  }
  return null;
}

function expand(placement) {
  const out = [];
  for (const ch of placement) {
    if (ch === '/') continue;
    if (ch >= '1' && ch <= '8') for (let i = 0; i < +ch; i++) out.push('.');
    else out.push(ch);
  }
  return out;
}

function search(w, goal, left, line, prior, budget) {
  if (--budget.left < 0) return null;
  const diffs = [];
  for (let i = 0; i < 64; i++) if (w.cell(i) !== goal[i]) diffs.push(i);
  if (left === 0) return diffs.length === 0 ? line.slice() : null;
  // one move changes two squares (three for en passant, four for castling)
  if (diffs.length > 2 * left + 2) return null;
  const seq = prior.concat(line);
  const back = seq.length >= 2 ? seq[seq.length - 2] : null; // this side's previous move
  // the last move has to start on one of the squares that are still wrong
  const moves = left === 1 ? diffs.flatMap((i) => w.moves(i)) : w.moves();
  for (const m of moves) {
    const p = w.plain(m);
    if (back && back.from === p.to && back.to === p.from) continue;
    w.make(m);
    line.push(p);
    const hit = search(w, goal, left - 1, line, prior, budget);
    line.pop();
    w.undo();
    if (hit) return hit;
  }
  return null;
}
