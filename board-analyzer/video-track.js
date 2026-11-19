// Following a video without running the board reader on every picture.
//
// The page sends a small thumbnail of the board area (REGION px square: the board plus a margin). Comparing it with
// the thumbnail of the last known position says which squares were emptied and which were filled. When exactly one
// legal move (or one move by each side) explains that, it is the move: found in about a millisecond instead of a few
// hundred, with almost no work for the computer. Last-move highlights and the coordinates printed in the corners do
// not matter, because only the inside of each square is looked at and a flat square counts as empty whatever its
// colour.
//
// Anything unclear (an arrow over the board, a promotion, a cut to another position, a cursor on a square) returns
// `unsure` and the caller asks the neural reader instead, so a wrong guess is never forced.

import { nameMoves, walker } from './notation.js';

export const REGION = 160; // thumbnail edge
const K = 10; // looks per square, each way
const INSET = 0.2; // part of each square left out on every side: coordinates, highlight borders, a slightly-off box

function luminance(px, size, channels) {
  const L = new Float32Array(size * size);
  for (let i = 0; i < L.length; i++) L[i] = 0.299 * px[i * channels] + 0.587 * px[i * channels + 1] + 0.114 * px[i * channels + 2];
  return L;
}

// Per square (as drawn: row 0 at the top of the picture), the brightness at K x K points inside it, their average
// and their spread. box: where the board is in the thumbnail, { x, y, w, h } in thumbnail pixels.
export function boardStats(px, size, box, channels = 3) {
  const L = luminance(px, size, channels);
  const cw = box.w / 8, ch = box.h / 8;
  const lum = [], mean = new Float32Array(64), sd = new Float32Array(64);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const v = new Float32Array(K * K);
      let s = 0, k = 0;
      for (let a = 0; a < K; a++) {
        const y = Math.min(size - 1, Math.max(0, Math.round(box.y + (r + INSET + (1 - 2 * INSET) * (a + 0.5) / K) * ch)));
        for (let b = 0; b < K; b++) {
          const x = Math.min(size - 1, Math.max(0, Math.round(box.x + (c + INSET + (1 - 2 * INSET) * (b + 0.5) / K) * cw)));
          const l = L[y * size + x];
          v[k++] = l;
          s += l;
        }
      }
      const m = s / v.length;
      let q = 0;
      for (let i = 0; i < v.length; i++) q += (v[i] - m) * (v[i] - m);
      const i = r * 8 + c;
      lum.push(v);
      mean[i] = m;
      sd[i] = Math.sqrt(q / v.length);
    }
  }
  return { lum, mean, sd };
}

// Where exactly the board is. The board finder's box can be off by a fraction of a square. Knowing which squares are
// empty (the position was just read), the right box is the one where every empty square is one flat colour from edge
// to edge: shifted even a little, each one takes in a strip of its neighbour, which is always the other colour.
// Searches a third of a square each way and 6% in size. -> { x, y, w, h, score }
export function alignBoard(px, size, placement, black, guess, channels = 3) {
  const L = luminance(px, size, channels);
  const W = size + 1;
  const S = new Float64Array(W * W), Q = new Float64Array(W * W);
  for (let y = 0; y < size; y++) {
    let rs = 0, rq = 0;
    for (let x = 0; x < size; x++) {
      const l = L[y * size + x];
      rs += l; rq += l * l;
      S[(y + 1) * W + x + 1] = S[y * W + x + 1] + rs;
      Q[(y + 1) * W + x + 1] = Q[y * W + x + 1] + rq;
    }
  }
  const empty = [];
  drawnBoard(placement, black).forEach((p, i) => { if (p === '.') empty.push(i); });
  if (empty.length < 8) return guess;
  const clampi = (v) => Math.max(0, Math.min(size, Math.round(v)));
  const EDGE = 0.06; // the very edge of a square is blurred into its neighbour by the video in any case
  const score = (bx, by, bw, bh) => {
    let t = 0;
    const cw = bw / 8, chh = bh / 8;
    for (const i of empty) {
      const r = i >> 3, c = i & 7;
      const x0 = clampi(bx + (c + EDGE) * cw), x1 = clampi(bx + (c + 1 - EDGE) * cw);
      const y0 = clampi(by + (r + EDGE) * chh), y1 = clampi(by + (r + 1 - EDGE) * chh);
      const n = (x1 - x0) * (y1 - y0);
      if (n <= 0) return -Infinity;
      const sum = S[y1 * W + x1] - S[y0 * W + x1] - S[y1 * W + x0] + S[y0 * W + x0];
      const sq = Q[y1 * W + x1] - Q[y0 * W + x1] - Q[y1 * W + x0] + Q[y0 * W + x0];
      const m = sum / n;
      t += Math.log1p(Math.sqrt(Math.max(0, sq / n - m * m)));
    }
    return -t / empty.length;
  };
  const aspect = guess.h / guess.w;
  const reach = Math.max(2, Math.round((guess.w / 8) * 0.35));
  const grow = Math.max(2, Math.round(guess.w * 0.06));
  let best = { x: guess.x, y: guess.y, w: guess.w, h: guess.h, score: score(guess.x, guess.y, guess.w, guess.h) };
  for (let dw = -grow; dw <= grow; dw++) {
    const w = guess.w + dw, h = w * aspect;
    // keep the middle where it was while trying sizes
    const cx = guess.x + guess.w / 2 - w / 2, cy = guess.y + guess.h / 2 - h / 2;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const s = score(cx + dx, cy + dy, w, h);
        if (s > best.score) best = { x: cx + dx, y: cy + dy, w, h, score: s };
      }
    }
  }
  return best;
}

// How differently two squares are drawn, ignoring a change of background colour (a highlight coming or going).
function shapeDiff(a, ma, b, mb) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs((a[i] - ma) - (b[i] - mb));
  return s / a.length;
}

const quantile = (arr, q) => {
  const s = [...arr].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))] : 0;
};

// FEN placement -> 64 chars, row 0 = rank 8, '.' = empty
export function expandPlacement(placement) {
  const out = [];
  for (const ch of placement) {
    if (ch === '/') continue;
    if (ch >= '1' && ch <= '8') for (let i = 0; i < +ch; i++) out.push('.');
    else out.push(ch);
  }
  return out;
}

// The 64 squares as drawn (Black at the bottom turns the board around).
const drawnBoard = (placement, black) => {
  const b = expandPlacement(placement);
  return black ? b.reverse() : b;
};

// Drawn square index -> square name.
export function squareOf(i, black) {
  const w = black ? 63 - i : i;
  return 'abcdefgh'[w & 7] + (8 - (w >> 3));
}

// ref, now: thumbnails (REGION x REGION, RGB) of the last known position and of the video now. box: alignBoard's
// result. fen: the position `ref` shows. black: Black is at the bottom of the picture. lastMove: {from, to} of the
// move that led to it (its squares may be highlighted).
// -> { moves: [{san, from, to, fen}] } | { none: true } (nothing moved) | { unsure: reason }
export function fastMove({ ref, now, size = REGION, box, fen, black = false, lastMove = null, channels = 3 }) {
  const A = boardStats(ref, size, box, channels), B = boardStats(now, size, box, channels);
  const before = drawnBoard(fen.split(' ')[0], black);
  const occ0 = before.map((p) => p !== '.');

  // What an empty and an occupied square look like in this video, learnt from the reference picture.
  const empties = [], occs = [];
  for (let i = 0; i < 64; i++) (occ0[i] ? occs : empties).push(A.sd[i]);
  if (empties.length < 8 || occs.length < 2) return { unsure: 'few squares to learn from' };
  const e = quantile(empties, 0.9), o = quantile(occs, 0.1);
  if (o < 2 * e + 6) return { unsure: 'pieces and squares look too alike' };
  const thr = Math.sqrt(Math.max(e, 1) * o);

  // How much the drawing of each square changed. Most occupied squares did not change, so their middle value is the
  // video's own noise.
  const d = new Float32Array(64);
  const occD = [];
  for (let i = 0; i < 64; i++) {
    d[i] = shapeDiff(A.lum[i], A.mean[i], B.lum[i], B.mean[i]);
    if (occ0[i]) occD.push(d[i]);
  }
  const dThr = Math.max(14, quantile(occD, 0.5) * 3 + 6);

  // A square that looks as before keeps what it had; one that changed is empty or occupied by how busy it looks.
  const occ1 = [];
  for (let i = 0; i < 64; i++) {
    const s = B.sd[i];
    const looksSame = d[i] < dThr && Math.abs(s - A.sd[i]) < Math.max(4, 0.3 * Math.min(s, A.sd[i]));
    if (looksSame) { occ1.push(occ0[i]); continue; }
    if (s > thr / 1.5 && s < thr * 1.5) return { unsure: 'a square is half covered' };
    occ1.push(s > thr);
  }

  const hl = new Set(lastMove ? [lastMove.from, lastMove.to] : []);
  if (occ0.every((v, i) => v === occ1[i])) {
    // no square was emptied or filled: no move. A piece changing in place is a cut to another position, or an arrow.
    for (let i = 0; i < 64; i++) {
      if (occ0[i] && d[i] > dThr * 1.5 && !hl.has(squareOf(i, black))) return { unsure: 'pieces changed in place' };
    }
    return { none: true };
  }

  // Legal moves (or one move by each side) whose result has pieces on exactly the squares that now look occupied.
  // (Squares here are numbered as drawn; the walker numbers them from a8, so map through `w64`.)
  const w64 = (i) => (black ? 63 - i : i);
  const parts = fen.split(' ');
  const starts = [fen, [parts[0], parts[1] === 'w' ? 'b' : 'w', parts[2], '-', parts[4], parts[5]].join(' ')];
  const found = []; // { start, plain: [moves], cells: drawn board after }
  const cellsOf = (w) => Array.from({ length: 64 }, (_, i) => w.cell(w64(i)));
  const wrong = (w) => { let n = 0; for (let i = 0; i < 64; i++) if ((w.cell(w64(i)) !== '.') !== occ1[i]) n++; return n; };
  const walkers = [];
  for (const start of starts) {
    try { walkers.push({ start, w: walker(start) }); } catch (err) { /* that side cannot move here */ }
  }
  for (const { start, w } of walkers) {
    for (const m of w.moves()) {
      w.make(m);
      if (wrong(w) === 0) found.push({ start, plain: [w.plain(m)], cells: cellsOf(w) });
      w.undo();
    }
  }
  if (!found.length && walkers.length && walkers[0].start === fen) {
    const { w } = walkers[0];
    for (const m1 of w.moves()) {
      w.make(m1);
      if (wrong(w) <= 4) {
        for (const m2 of w.moves()) {
          w.make(m2);
          if (wrong(w) === 0) found.push({ start: fen, plain: [w.plain(m1), w.plain(m2)], cells: cellsOf(w) });
          w.undo();
        }
      }
      w.undo();
    }
  }
  if (!found.length) return { unsure: 'no legal move fits' };

  // Of those, keep the ones whose captured squares really changed and whose other pieces really did not.
  const fits = found.filter(({ plain, cells }) => {
    for (let i = 0; i < 64; i++) {
      if (!(occ0[i] && occ1[i])) continue;
      const sq = squareOf(i, black);
      if (before[i] !== cells[i]) { if (d[i] < dThr) return false; }
      else if (d[i] > dThr * 1.5 && !hl.has(sq) && !plain.some((m) => m.from === sq || m.to === sq)) return false;
    }
    return true;
  });
  // promotions (four pieces on the same squares) and real look-alikes go to the reader
  if (fits.length !== 1) return { unsure: fits.length ? 'more than one move fits' : 'the pieces do not match' };
  if (fits[0].plain.some((m) => m.promotion)) return { unsure: 'promotion' };
  return { moves: nameMoves(fits[0].start, fits[0].plain) };
}
