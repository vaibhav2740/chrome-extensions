// Board reader: image -> chess position. Pure JavaScript (no DOM, no canvas), so it runs the same in a
// worker, on the page and in Node tests.
//
// This is a port of the chessimg2pos v2 pipeline (https://github.com/mdicio/chessimg2pos, MIT):
//   1. locator network finds the board corners (two passes: whole image, then a crop around the first guess)
//   2. the board is cropped (screenshots) or perspective-warped (photos) to 256x256
//   3. the reader network classifies all 64 squares and which side is at the bottom
//   4. a legality step fixes impossible boards without touching confident squares
// Image resizing mirrors Pillow's antialiased bilinear filter, which is what the networks were trained against.
//
// An "image" here is { width, height, data } with data an RGBA byte array (alpha is ignored).

export const BOARD_SIZE = 256;
export const LOC_SIZE = 320;
export const CLASSES = '1KQRBNPkqrbnp'; // class index -> FEN char ('1' = empty)
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

// ---------- resizing (Pillow-compatible bilinear with antialiasing) ----------

function filterCoeffs(inSize, outSize) {
  const scale = inSize / outSize;
  const fscale = Math.max(scale, 1);
  const support = fscale; // bilinear support is 1.0
  const starts = new Int32Array(outSize);
  const weights = new Array(outSize);
  for (let o = 0; o < outSize; o++) {
    const center = (o + 0.5) * scale;
    let min = Math.trunc(center - support + 0.5);
    let max = Math.trunc(center + support + 0.5);
    if (min < 0) min = 0;
    if (max > inSize) max = inSize;
    const n = Math.max(0, max - min);
    const w = new Float64Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const t = Math.abs((i + min - center + 0.5) / fscale);
      const v = t < 1 ? 1 - t : 0;
      w[i] = v;
      sum += v;
    }
    if (sum !== 0) for (let i = 0; i < n; i++) w[i] /= sum;
    starts[o] = min;
    weights[o] = w;
  }
  return { starts, weights };
}

const clamp8 = (v) => (v <= 0 ? 0 : v >= 255 ? 255 : (v + 0.5) | 0);

// Resize a window of `src` into an outW x outH image. The window is placed at the top-left of a virtual
// vw x vh canvas (default: the window's own size); everything of the virtual canvas outside the window,
// or outside `src`, is black. That one primitive covers cropping past the image edge and letterboxing.
export function resizeRegion(src, win, outW, outH, vw, vh) {
  const { x0, y0, w, h } = win;
  vw = vw || w;
  vh = vh || h;
  // visible virtual columns/rows: inside the window and inside the source
  const cmin = Math.max(0, -x0), cmax = Math.min(w, src.width - x0);
  const rmin = Math.max(0, -y0), rmax = Math.min(h, src.height - y0);
  const hc = filterCoeffs(vw, outW);
  const vc = filterCoeffs(vh, outH);
  // only the rows the vertical pass reads need the horizontal pass
  let rowLo = vh, rowHi = 0;
  for (let o = 0; o < outH; o++) {
    rowLo = Math.min(rowLo, vc.starts[o]);
    rowHi = Math.max(rowHi, vc.starts[o] + vc.weights[o].length);
  }
  const rows = rowHi - rowLo;
  const tmp = new Float32Array(rows * outW * 3); // exact horizontal result; rounded once at the end
  const sd = src.data, sw = src.width;
  for (let r = 0; r < rows; r++) {
    const y = rowLo + r;
    if (y < rmin || y >= rmax) continue; // black row
    const rowBase = (y0 + y) * sw;
    for (let o = 0; o < outW; o++) {
      const w8 = hc.weights[o], s0 = hc.starts[o];
      let a = 0, b = 0, c = 0;
      const lo = Math.max(s0, cmin), hi = Math.min(s0 + w8.length, cmax);
      for (let x = lo; x < hi; x++) {
        const k = w8[x - s0];
        const p = 4 * (rowBase + x0 + x);
        a += sd[p] * k; b += sd[p + 1] * k; c += sd[p + 2] * k;
      }
      const t = (r * outW + o) * 3;
      // Pillow rounds to 8 bits between the two passes
      tmp[t] = clamp8(a); tmp[t + 1] = clamp8(b); tmp[t + 2] = clamp8(c);
    }
  }
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let o = 0; o < outH; o++) {
    const w8 = vc.weights[o], s0 = vc.starts[o];
    for (let x = 0; x < outW; x++) {
      let a = 0, b = 0, c = 0;
      for (let i = 0; i < w8.length; i++) {
        const t = ((s0 + i - rowLo) * outW + x) * 3;
        const k = w8[i];
        a += tmp[t] * k; b += tmp[t + 1] * k; c += tmp[t + 2] * k;
      }
      const p = 4 * (o * outW + x);
      out[p] = clamp8(a); out[p + 1] = clamp8(b); out[p + 2] = clamp8(c); out[p + 3] = 255;
    }
  }
  return { width: outW, height: outH, data: out };
}

export const resizeImage = (img, w, h) =>
  resizeRegion(img, { x0: 0, y0: 0, w: img.width, h: img.height }, w, h);

// ImageNet-normalised CHW float tensor data
export function toTensorData(img) {
  const n = img.width * img.height;
  const out = new Float32Array(3 * n);
  const d = img.data;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) out[c * n + i] = (d[4 * i + c] / 255 - MEAN[c]) / STD[c];
  }
  return out;
}

// ---------- geometry ----------

const bbox = (q) => [
  Math.min(...q.map((p) => p[0])), Math.min(...q.map((p) => p[1])),
  Math.max(...q.map((p) => p[0])), Math.max(...q.map((p) => p[1])),
];

export function isAxisAligned(q, tol = 0.006) {
  const [x0, y0, x1, y1] = bbox(q);
  const side = Math.max(x1 - x0, y1 - y0, 1e-6);
  const rect = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  return q.every((p, i) => Math.abs(p[0] - rect[i][0]) / side <= tol && Math.abs(p[1] - rect[i][1]) / side <= tol);
}

function solve(A, b) { // Gaussian elimination with partial pivoting (8x8)
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let m = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r;
    [A[i], A[m]] = [A[m], A[i]];
    [b[i], b[m]] = [b[m], b[i]];
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return x;
}

// Crop the board box (it may extend past the image: black) and resize to size x size.
export function cropBoard(img, box, size = BOARD_SIZE) {
  const x0 = Math.round(box[0]), y0 = Math.round(box[1]);
  const w = Math.max(1, Math.round(box[2]) - x0), h = Math.max(1, Math.round(box[3]) - y0);
  return resizeRegion(img, { x0, y0, w, h }, size, size);
}

// Perspective-correct the board quad (TL, TR, BR, BL) into a size x size square (for photos).
export function warpBoard(img, q, size = BOARD_SIZE) {
  const sides = q.map((p, i) => Math.hypot(p[0] - q[(i + 1) % 4][0], p[1] - q[(i + 1) % 4][1]));
  const f = Math.min(...sides) / (1.5 * size);
  let src = img;
  let qs = q;
  if (f > 1) { // downscale first so the warp does not alias
    src = resizeImage(img, Math.max(1, Math.round(img.width / f)), Math.max(1, Math.round(img.height / f)));
    qs = q.map(([x, y]) => [x / f, y / f]);
  }
  const dst = [[0, 0], [size, 0], [size, size], [0, size]];
  const A = [], b = [];
  dst.forEach(([u, v], i) => {
    const [x, y] = qs[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  });
  const [a0, a1, a2, a3, a4, a5, a6, a7] = solve(A, b);
  const out = new Uint8ClampedArray(size * size * 4);
  const sd = src.data, sw = src.width, sh = src.height;
  for (let v = 0; v < size; v++) {
    for (let u = 0; u < size; u++) {
      const uu = u + 0.5, vv = v + 0.5, den = a6 * uu + a7 * vv + 1;
      const x = (a0 * uu + a1 * vv + a2) / den - 0.5, y = (a3 * uu + a4 * vv + a5) / den - 0.5;
      const o = 4 * (v * size + u);
      out[o + 3] = 255;
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      if (xi < 0 || yi < 0 || xi + 1 >= sw || yi + 1 >= sh) continue;
      for (let c = 0; c < 3; c++) {
        const i00 = 4 * (yi * sw + xi) + c, i10 = i00 + 4, i01 = i00 + 4 * sw, i11 = i01 + 4;
        out[o + c] = (sd[i00] * (1 - fx) + sd[i10] * fx) * (1 - fy) + (sd[i01] * (1 - fx) + sd[i11] * fx) * fy;
      }
    }
  }
  return { width: size, height: size, data: out };
}

export const boardInput = (img, q) => (isAxisAligned(q) ? cropBoard(img, bbox(q)) : warpBoard(img, q));

// ---------- locator ----------

// One locator pass over region [x0,y0,x1,y1] of the image. Returns the board quad in image pixels.
async function locatorPass(img, region, runLocator) {
  const [rx0, ry0, rx1, ry1] = region;
  const w = rx1 - rx0, h = ry1 - ry0, s = Math.max(w, h);
  const input = resizeRegion(img, { x0: rx0, y0: ry0, w, h }, LOC_SIZE, LOC_SIZE, s, s);
  const out = await runLocator(toTensorData(input));
  const v = Array.from(out, (x) => x * s);
  const q = v.length === 4
    ? [[v[0], v[1]], [v[2], v[1]], [v[2], v[3]], [v[0], v[3]]]
    : [[v[0], v[1]], [v[2], v[3]], [v[4], v[5]], [v[6], v[7]]];
  return q.map(([x, y]) => [x + rx0, y + ry0]);
}

export async function locate(img, runLocator, { passes = 2 } = {}) {
  const W = img.width, H = img.height;
  let q = await locatorPass(img, [0, 0, W, H], runLocator);
  for (let i = 1; i < passes; i++) {
    const b = bbox(q);
    const bw = b[2] - b[0], bh = b[3] - b[1];
    let r = [
      Math.max(0, Math.trunc(b[0] - 0.1 * bw)), Math.max(0, Math.trunc(b[1] - 0.1 * bh)),
      Math.min(W, Math.trunc(b[2] + 0.1 * bw)), Math.min(H, Math.trunc(b[3] + 0.1 * bh)),
    ];
    if (r[2] - r[0] < 32 || r[3] - r[1] < 32) r = [0, 0, W, H];
    q = await locatorPass(img, r, runLocator);
  }
  return q;
}

// ---------- decoding the board network's output ----------

function softmax(a, off, n) {
  let m = -Infinity;
  for (let i = 0; i < n; i++) m = Math.max(m, a[off + i]);
  let s = 0;
  const o = new Array(n);
  for (let i = 0; i < n; i++) { o[i] = Math.exp(a[off + i] - m); s += o[i]; }
  return o.map((v) => v / s);
}

// Legality step (mirror of chessimg2pos/v2/legality.py): at most one king per side, no pawns on the back
// ranks, at most 8 pawns and 16 pieces per side. Squares predicted with probability >= `lock` never change.
export function fixLegality(P, lock = 0.97) {
  const idx = P.map((p) => p.indexOf(Math.max(...p)));
  const K = 1, k = 7, PW = 6, PB = 12;
  const demote = (sq, banned) => {
    if (P[sq][idx[sq]] >= lock) return;
    const order = [...P[sq].keys()].sort((a, b) => P[sq][b] - P[sq][a]);
    for (const c of order) if (!banned.includes(c)) { idx[sq] = c; return; }
  };
  for (const sq of [...Array(8).keys(), ...Array.from({ length: 8 }, (_, i) => 56 + i)]) {
    if (idx[sq] === PW || idx[sq] === PB) demote(sq, [PW, PB]);
  }
  for (const king of [K, k]) {
    const sqs = idx.map((c, s) => (c === king ? s : -1)).filter((s) => s >= 0);
    if (sqs.length > 1) {
      sqs.sort((a, b) => P[b][king] - P[a][king]);
      sqs.slice(1).forEach((s) => demote(s, [king]));
    }
    // a missing king is never invented: teaching diagrams often omit kings
  }
  const sides = [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12]];
  sides.forEach((side, i) => {
    const pawn = i ? PB : PW;
    const pawns = idx.map((c, s) => (c === pawn ? s : -1)).filter((s) => s >= 0).sort((a, b) => P[a][pawn] - P[b][pawn]);
    pawns.slice(0, Math.max(0, pawns.length - 8)).forEach((s) => demote(s, [pawn]));
    const pcs = idx.map((c, s) => (side.includes(c) ? s : -1)).filter((s) => s >= 0).sort((a, b) => P[a][idx[a]] - P[b][idx[b]]);
    pcs.slice(0, Math.max(0, pcs.length - 16)).forEach((s) => demote(s, side));
  });
  return idx;
}

// ---------- board <-> FEN helpers ----------
// A "grid" is 8 rows (top of the picture first) of 8 cells, each a FEN letter or null.

export function gridToPlacement(grid) {
  return grid.map((row) => {
    let s = '', empty = 0;
    for (const c of row) {
      if (!c) empty++;
      else { if (empty) { s += empty; empty = 0; } s += c; }
    }
    return s + (empty || '');
  }).join('/');
}

export function placementToGrid(placement) {
  return placement.split('/').map((r) => {
    const row = [];
    for (const ch of r) {
      if (/\d/.test(ch)) for (let i = 0; i < +ch; i++) row.push(null);
      else row.push(ch);
    }
    return row;
  });
}

// Turn the picture upside down: what Black sees from the bottom, White sees from the top.
export const rotateGrid = (grid) => grid.map((r) => [...r].reverse()).reverse();

// ---------- the whole pipeline ----------

// runLocator(Float32Array CHW 1x3x320x320) -> Float32Array(8) box (normalised to the padded square)
// runBoard(Float32Array CHW 1x3x256x256)   -> { squares: Float32Array(64*13), orientation: Float32Array(2) }
export async function readBoard(img, { runLocator, runBoard, box = null, passes = 2 }) {
  const t0 = Date.now();
  const corners = box
    ? [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]]
    : await locate(img, runLocator, { passes });
  const tLoc = Date.now();
  const r = await runBoard(toTensorData(boardInput(img, corners)));
  const P = [];
  for (let i = 0; i < 64; i++) P.push(softmax(r.squares, i * 13, 13));
  const before = P.map((p) => p.indexOf(Math.max(...p)));
  const idx = fixLegality(P);
  const or = softmax(r.orientation, 0, 2);
  const grid = [];
  for (let rr = 0; rr < 8; rr++) {
    const row = [];
    for (let f = 0; f < 8; f++) { const c = CLASSES[idx[rr * 8 + f]]; row.push(c === '1' ? null : c); }
    grid.push(row);
  }
  const conf = idx.map((c, i) => P[i][c]);
  const bottom = or[1] > 0.5 ? 'black' : 'white';
  const whiteGrid = bottom === 'black' ? rotateGrid(grid) : grid;
  return {
    grid, // as drawn in the picture
    bottom, // which side is at the bottom of the picture
    bottomConfidence: Math.max(or[0], or[1]),
    placement: gridToPlacement(whiteGrid), // White's view, FEN piece placement
    confidence: Math.min(...conf), // the least certain square
    squareConfidence: conf, // per square, as drawn, row by row
    legalityChanges: idx.reduce((n, c, i) => n + (c !== before[i] ? 1 : 0), 0),
    pieces: idx.filter((c) => c !== 0).length,
    // With only a few pieces the picture itself does not say which side is at the bottom; ask the person.
    orientationUnsure: Math.max(or[0], or[1]) < 0.9 || idx.filter((c) => c !== 0).length <= 6,
    corners,
    ms: { locate: tLoc - t0, read: Date.now() - tLoc },
  };
}

// readBoard with a second opinion: a weak result (some square under 90% sure) usually means the board was found a
// little off, so look again with a different number of locator passes and keep the most confident reading.
export async function readBoardBest(img, opts) {
  const first = await readBoard(img, { ...opts, passes: opts.passes || 3 });
  if (opts.box || first.confidence >= 0.9) return first;
  let best = first;
  for (const passes of [2, 4]) {
    if (passes === (opts.passes || 3)) continue;
    const r = await readBoard(img, { ...opts, passes });
    if (r.confidence > best.confidence) best = r;
  }
  return best;
}
