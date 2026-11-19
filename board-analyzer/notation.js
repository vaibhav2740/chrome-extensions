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
