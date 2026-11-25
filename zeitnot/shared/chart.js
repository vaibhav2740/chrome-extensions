// Geometry for the two small charts in the popup: the eval (win chance) graph and the clocks graph.
// Pure: moves in, SVG path strings and hover points out.

import { winChance } from './odds.js';

const PAD_X = 4;
const PAD_Y = 6;
/** The x axis always covers at least this many plies, so an early-game chart does not stretch to full width. */
export const MIN_SPAN_PLIES = 24;

const f = (n) => Math.round(n * 10) / 10;

function xFor(ply, span, width) {
  return PAD_X + ((ply - 1) / Math.max(1, span - 1)) * (width - 2 * PAD_X);
}

function linePath(points) {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${f(points[0].x)} ${f(points[0].y)}h0.01`;
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${f(p.x)} ${f(p.y)}`).join('');
}

/**
 * @param moves  detail.moves: [{n, b, s, c, e, m}] (move number, black?, SAN, clock s, eval pawns, mate)
 * @param opts   { kind: 'eval' | 'clock', width, height, topIsWhite }
 *   For 'eval' the top of the chart is the better side for the player at the top (`topIsWhite` picks which colour).
 */
export function chartModel(moves, { kind, width = 332, height = 84, topIsWhite = true }) {
  const span = Math.max(moves.length, MIN_SPAN_PLIES);
  const mid = height / 2;
  const hover = moves.map((m, i) => ({ x: xFor(i + 1, span, width), ply: i + 1, move: m }));
  const markers = [];
  if (span >= 80) markers.push({ x: xFor(80, span, width), label: '40' }); // the +30 min arrives after move 40

  if (kind === 'eval') {
    const points = [];
    moves.forEach((m, i) => {
      if (m.e === null || m.e === undefined) return;
      const whiteChance = winChance(m.m !== null && m.m !== undefined ? (m.m > 0 ? 15 : -15) : m.e);
      const v = topIsWhite ? whiteChance : 1 - whiteChance;
      points.push({ x: xFor(i + 1, span, width), y: PAD_Y + (1 - v) * (height - 2 * PAD_Y), ply: i + 1 });
    });
    const line = linePath(points);
    const area = points.length < 2 ? '' : `M${f(points[0].x)} ${f(mid)}${points.map((p) => `L${f(p.x)} ${f(p.y)}`).join('')}L${f(points[points.length - 1].x)} ${f(mid)}Z`;
    return { kind, width, height, mid, hasData: points.length > 0, points, line, area, markers, hover };
  }

  const whitePts = [];
  const blackPts = [];
  const clocks = moves.filter((m) => m.c !== null && m.c !== undefined).map((m) => m.c);
  // The axis is zoomed to the clocks seen (rounded to a tidy step), so an early-game chart still shows who is spending
  // time. `axis` carries the two bounds so the popup can label them.
  let hi = clocks.length ? Math.max(...clocks) : 1;
  let lo = clocks.length ? Math.min(...clocks) : 0;
  const range = hi - lo;
  const step = range > 3600 ? 900 : range > 1200 ? 300 : 60;
  hi = Math.ceil(hi / step) * step;
  lo = Math.max(0, Math.floor((lo - range * 0.1) / step) * step);
  if (hi - lo < step) hi = lo + step;
  moves.forEach((m, i) => {
    if (m.c === null || m.c === undefined) return;
    const p = { x: xFor(i + 1, span, width), y: PAD_Y + (1 - (m.c - lo) / (hi - lo)) * (height - 2 * PAD_Y), ply: i + 1 };
    (m.b ? blackPts : whitePts).push(p);
  });
  return {
    kind, width, height, mid,
    axis: { hi, lo },
    hasData: whitePts.length + blackPts.length > 0,
    white: linePath(whitePts),
    black: linePath(blackPts),
    whitePoints: whitePts,
    blackPoints: blackPts,
    markers,
    hover,
  };
}

/** The hover point whose x is closest to `x` (in chart coordinates), or null if there are no moves. */
export function nearestPly(model, x) {
  let best = null;
  let bestDist = Infinity;
  for (const h of model.hover) {
    const d = Math.abs(h.x - x);
    if (d < bestDist) {
      best = h;
      bestDist = d;
    }
  }
  return best;
}
