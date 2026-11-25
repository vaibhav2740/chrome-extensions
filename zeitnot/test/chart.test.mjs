import test from 'node:test';
import assert from 'node:assert/strict';

import { MIN_SPAN_PLIES, chartModel, nearestPly } from '../shared/chart.js';
import { parseGame } from '../shared/pgn.js';
import { fixture } from './helpers.mjs';

const toMoves = (pgn) => parseGame(pgn).moves.map((m) => ({ n: m.moveNumber, b: m.isBlack ? 1 : 0, s: m.san, c: m.clk, e: m.evalPawns, m: m.mate }));
const finished = toMoves(fixture('game1-finished.pgn'));
const live = toMoves(fixture('round-live.pgn'));
const numbers = (d) => (d.match(/-?\d+(\.\d+)?/g) || []).map(Number);

test('eval chart: every number is finite and inside the chart, x only moves right', () => {
  const m = chartModel(finished, { kind: 'eval', width: 332, height: 84 });
  assert.equal(m.hasData, true);
  assert.equal(m.points.length, 76);
  for (const n of numbers(m.line).concat(numbers(m.area))) assert(Number.isFinite(n));
  for (const p of m.points) assert(p.x >= 4 && p.x <= 328 && p.y >= 6 && p.y <= 78);
  for (let i = 1; i < m.points.length; i++) assert(m.points[i].x > m.points[i - 1].x);
  assert(m.line.startsWith('M') && m.area.endsWith('Z'));
  assert(Math.abs(m.points[m.points.length - 1].y - m.mid) < 0.01, 'the game ends level (eval 0.0), on the middle line');
  assert(m.points.every((p) => Math.abs(p.y - m.mid) < 20), 'a drawn game never wanders far from it');
});

test('eval chart: the better side goes up, and flipping the perspective flips it', () => {
  const moves = [{ n: 1, b: 0, s: 'e4', c: 7000, e: 3, m: null }, { n: 1, b: 1, s: 'e5', c: 7000, e: -3, m: null }];
  const white = chartModel(moves, { kind: 'eval', topIsWhite: true });
  assert(white.points[0].y < white.mid && white.points[1].y > white.mid);
  const black = chartModel(moves, { kind: 'eval', topIsWhite: false });
  assert(black.points[0].y > black.mid && black.points[1].y < black.mid);
  const mate = chartModel([{ n: 1, b: 0, s: 'Qh7#', c: 1, e: 12, m: 1 }], { kind: 'eval' });
  assert(mate.points[0].y < 8, 'a forced mate is pinned to the top');
});

test('a live game with no evals has no eval chart, but it does have clocks', () => {
  assert.equal(chartModel(live, { kind: 'eval' }).hasData, false);
  assert.equal(chartModel(live, { kind: 'eval' }).line, '');
  const c = chartModel(live, { kind: 'clock' });
  assert.equal(c.hasData, true);
  assert.equal(c.whitePoints.length, 7);
  assert.equal(c.blackPoints.length, 7);
  assert(c.white.startsWith('M') && c.black.startsWith('M'));
});

test('clock chart: lines fall over the game and stay in bounds', () => {
  const c = chartModel(finished, { kind: 'clock' });
  assert.equal(c.maxSec, Math.max(...finished.map((m) => m.c)));
  for (const p of c.whitePoints.concat(c.blackPoints)) assert(p.y >= 6 && p.y <= 78 && Number.isFinite(p.x));
  const first = c.whitePoints[0];
  const last = c.whitePoints[c.whitePoints.length - 1];
  assert(last.y > first.y, 'less time at the end than at the start');
});

test('an early game uses part of the width; a long one gets the 40-move marker', () => {
  const early = chartModel(live, { kind: 'clock', width: 332 });
  assert(early.hover[early.hover.length - 1].x < 332 * (live.length / MIN_SPAN_PLIES) + 4);
  assert.deepEqual(early.markers, []);
  const long = chartModel(Array.from({ length: 100 }, (_, i) => ({ n: Math.floor(i / 2) + 1, b: i % 2, s: 'x', c: 3000 - i * 10, e: 0, m: null })), { kind: 'clock' });
  assert.equal(long.markers.length, 1);
  assert.equal(long.markers[0].label, '40');
});

test('hovering finds the nearest ply; one point still draws a mark', () => {
  const m = chartModel(finished, { kind: 'eval' });
  const mid = nearestPly(m, m.hover[39].x + 0.2);
  assert.equal(mid.ply, 40);
  assert.equal(nearestPly(chartModel([], { kind: 'clock' }), 10), null);
  const one = chartModel([{ n: 1, b: 0, s: 'e4', c: 7100, e: 0.2, m: null }], { kind: 'eval' });
  assert.match(one.line, /^M[\d.]+ [\d.]+h0\.01$/);
  assert.equal(one.area, '');
});
