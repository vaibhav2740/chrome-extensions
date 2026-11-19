// Synthetic video thumbnails for the Follow tests: boards built from the piece sets in test/fixtures (real pictures
// of boards), with highlights, arrows, a mouse pointer, blur and noise, shrunk the way the page shrinks the video.
// (A helper, not a test: it only defines functions.)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { REGION } from "../video-track.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const truth = JSON.parse(fs.readFileSync(`${SRC}/test/fixtures/truth.json`, "utf8")).boards;

export const expand = (pl) => pl.split("/").flatMap((row) => [...row].flatMap((ch) => (/\d/.test(ch) ? Array(+ch).fill(".") : [ch])));

// A piece set and board colours, cut out of a fixture picture of a known position (White at the bottom).
export function loadSet(file, theme = null) {
  const png = PNG.sync.read(fs.readFileSync(`${SRC}/test/fixtures/${file}`));
  const S = png.width / 8;
  const cells = expand(truth[file].placement);
  const tile = (i) => {
    const r = i >> 3, c = i & 7, out = new Uint8Array(S * S * 3);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const o = ((r * S + y) * png.width + c * S + x) * 4, p = (y * S + x) * 3;
      out[p] = png.data[o]; out[p + 1] = png.data[o + 1]; out[p + 2] = png.data[o + 2];
    }
    return out;
  };
  const light = (i) => ((i >> 3) + (i & 7)) % 2 === 0;
  const emptyL = tile(cells.findIndex((p, i) => p === "." && light(i)));
  const emptyD = tile(cells.findIndex((p, i) => p === "." && !light(i)));
  const sprites = {};
  for (const ch of "KQRBNPkqrbnp") {
    const i = cells.indexOf(ch);
    if (i < 0) continue;
    const t = tile(i), bg = light(i) ? emptyL : emptyD, mask = new Uint8Array(S * S);
    for (let p = 0; p < S * S; p++) mask[p] = Math.abs(t[p * 3] - bg[p * 3]) + Math.abs(t[p * 3 + 1] - bg[p * 3 + 1]) + Math.abs(t[p * 3 + 2] - bg[p * 3 + 2]) > 40 ? 1 : 0;
    sprites[ch] = { t, mask };
  }
  // a different board colour: flat squares in the theme's colours with a little texture
  const flat = (rgb, seed) => {
    const out = new Uint8Array(S * S * 3); let s = seed;
    for (let p = 0; p < S * S; p++) { s = (s * 1103515245 + 12345) & 0x7fffffff; const n = (s % 7) - 3; for (let k = 0; k < 3; k++) out[p * 3 + k] = rgb[k] + n; }
    return out;
  };
  return { S, emptyL: theme ? flat(theme[0], 1) : emptyL, emptyD: theme ? flat(theme[1], 2) : emptyD, sprites, light };
}

export function rand(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

// placement -> RGB thumbnail (REGION x REGION), as the page would send it.
// The board's real place in the thumbnail, and the box a board finder might report: shift [dx, dy] in squares,
// zoom > 1 = a little too big. A real board finder is only right to a few pixels.
export const MARGIN = 0.06;
export const TRUE_BOX = { x: (REGION * MARGIN) / (1 + 2 * MARGIN), y: (REGION * MARGIN) / (1 + 2 * MARGIN), w: REGION / (1 + 2 * MARGIN), h: REGION / (1 + 2 * MARGIN) };
export function guessBox({ shift = [0, 0], zoom = 1 } = {}) {
  const w = TRUE_BOX.w * zoom, cell = TRUE_BOX.w / 8;
  return { x: TRUE_BOX.x + TRUE_BOX.w / 2 - w / 2 + shift[0] * cell, y: TRUE_BOX.y + TRUE_BOX.h / 2 - w / 2 + shift[1] * cell, w, h: w };
}
export function frame(set, placement, { black = false, highlight = [], arrows = [], cursor = null, blur = false, noise = 3, seed = 7, hlAlpha = 0.45 } = {}) {
  const { S } = set, N = S * 8, img = new Float32Array(N * N * 3);
  const cells = expand(placement);
  const names = (sq) => (8 - +sq[1]) * 8 + (sq.charCodeAt(0) - 97); // white-view index
  const hl = new Set(highlight.map(names));
  for (let i = 0; i < 64; i++) {
    const w = black ? 63 - i : i; // drawn square i shows board square w
    const bg = set.light(i) ? set.emptyL : set.emptyD;
    const sp = cells[w] !== "." ? set.sprites[cells[w]] : null;
    const r = i >> 3, c = i & 7;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const p = (y * S + x) * 3, o = ((r * S + y) * N + c * S + x) * 3;
      let px = [bg[p], bg[p + 1], bg[p + 2]];
      if (hl.has(w)) px = [px[0] * (1 - hlAlpha) + 255 * hlAlpha, px[1] * (1 - hlAlpha) + 235 * hlAlpha, px[2] * (1 - hlAlpha) + 60 * hlAlpha];
      if (sp && sp.mask[y * S + x]) px = [sp.t[p], sp.t[p + 1], sp.t[p + 2]];
      img[o] = px[0]; img[o + 1] = px[1]; img[o + 2] = px[2];
    }
  }
  const centre = (sq) => { const w = names(sq), i = black ? 63 - w : w; return [((i & 7) + 0.5) * S, ((i >> 3) + 0.5) * S]; };
  for (const [a, b] of arrows) {
    const [x0, y0] = centre(a), [x1, y1] = centre(b), len = Math.hypot(x1 - x0, y1 - y0), half = S * 0.1;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const t = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / (len * len)));
      if (Math.hypot(x - (x0 + t * (x1 - x0)), y - (y0 + t * (y1 - y0))) < half) {
        const o = (y * N + x) * 3; img[o] = img[o] * 0.2 + 255 * 0.8; img[o + 1] = img[o + 1] * 0.2 + 170 * 0.8; img[o + 2] = img[o + 2] * 0.2;
      }
    }
  }
  if (cursor) { // an arrow-shaped mouse pointer, tip at the given square's middle
    const [cx, cy] = centre(cursor), h = S * 0.45;
    for (let y = 0; y < h; y++) for (let x = 0; x <= y * 0.6; x++) {
      const o = ((Math.round(cy + y)) * N + Math.round(cx + x)) * 3; if (o < 0 || o >= img.length) continue;
      const edge = x > y * 0.6 - 1.5 || y > h - 2; const v = edge ? 255 : 0; img[o] = v; img[o + 1] = v; img[o + 2] = v;
    }
  }
  // the thumbnail the page sends: the board plus a 6% margin of page around it, shrunk with a box filter like the
  // browser's smooth downscale; then video blur and noise
  const T = REGION; let out = new Float32Array(T * T * 3);
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) for (let ch = 0; ch < 3; ch++) {
    let s = 0;
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
      const u = ((x * 4 + dx + 0.5) / (T * 4)) * (1 + 2 * MARGIN) - MARGIN, v = ((y * 4 + dy + 0.5) / (T * 4)) * (1 + 2 * MARGIN) - MARGIN;
      const xx = Math.floor(u * N), yy = Math.floor(v * N);
      s += xx < 0 || yy < 0 || xx >= N || yy >= N ? 28 : img[(yy * N + xx) * 3 + ch]; // around the board: a dark page
    }
    out[(y * T + x) * 3 + ch] = s / 16;
  }
  if (blur) {
    const b = new Float32Array(out.length);
    for (let y = 0; y < REGION; y++) for (let x = 0; x < REGION; x++) for (let ch = 0; ch < 3; ch++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy < 0 || xx < 0 || yy >= REGION || xx >= REGION) continue; s += out[(yy * REGION + xx) * 3 + ch]; n++; }
      b[(y * REGION + x) * 3 + ch] = s / n;
    }
    out = b;
  }
  const rnd = rand(seed), res = new Uint8ClampedArray(out.length);
  for (let i = 0; i < out.length; i++) {
    const g = noise ? Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd()) * noise : 0;
    res[i] = out[i] + g;
  }
  return res;
}

