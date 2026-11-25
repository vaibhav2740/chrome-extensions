import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseGame, parseMovetext, shortOpening, splitPgnGames, stripPgnVariations } from '../shared/pgn.js';

const fx = (name) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', name), 'utf8');

test('a finished broadcast game keeps every ply with its clock and eval', () => {
  const g = parseGame(fx('game1-finished.pgn'));
  assert.equal(g.result, '1/2-1/2');
  assert.equal(g.plyCount, 76);
  assert.equal(g.moves.filter((m) => m.evalPawns !== null).length, 76);
  assert.equal(g.moves.filter((m) => m.clk !== null).length, 76);
  assert.deepEqual(g.lastEval, { pawns: 0, mate: null, ply: 76 });
  assert.equal(g.whiteClock, 951); // 0:15:51
  assert.equal(g.blackClock, 392); // 0:06:32
  assert.equal(g.lastMove, '38... Kg8');
  assert.equal(g.moveNumber, 39);
  assert.equal(g.isWhiteTurn, true);
  assert.equal(g.white, 'Sindarov, Javokhir');
  assert.equal(g.whiteFideId, 14205483);
  assert.equal(g.roundNumber, 1);
});

test('a live game with clocks but no evals reports no eval, not a zero eval', () => {
  const g = parseGame(fx('round-live.pgn'));
  assert.equal(g.result, '*');
  assert.equal(g.plyCount, 14);
  assert.equal(g.lastEval, null);
  assert.equal(g.whiteClock, 7091); // 1:58:11
  assert.equal(g.blackClock, 6858); // 1:54:18
  assert.equal(g.moveNumber, 8);
  assert.equal(g.isWhiteTurn, true);
  assert.equal(g.roundId, 'L3j03TZq');
  assert.equal(g.roundNumber, 2);
  assert.equal(g.opening, "Queen's Pawn Game: London System");
  assert.equal(g.eco, 'D02');
});

test('the tournament download splits into one game per round, keyed by Lichess round id', () => {
  const games = splitPgnGames(fx('tour.pgn')).map(parseGame);
  assert.equal(games.length, 14);
  assert.equal(new Set(games.map((g) => g.roundId)).size, 14);
  assert.deepEqual(games.map((g) => g.roundNumber), Array.from({ length: 14 }, (_, i) => i + 1));
  assert.equal(games[0].result, '1/2-1/2');
  assert.equal(games[2].result, '*');
});

test('variations, NAGs, odd tag order, promotions and mates do not confuse the parser', () => {
  const sample = `[Event "FIDE WCC"]
[White "Gukesh D"]
[Black "Sindarov, Javokhir"]
[Round "2.1"]
[Result "*"]
[Opening "Ruy Lopez: Berlin Defense"]

1. e4 $1 { [%eval 0.18] [%clk 1:59:50] } (1. d4 d5 (1... Nf6)) e5 { [%clk 1:59:52] } 9. O-O-O+ { [%eval -0.45] [%clk 1:40:00] } 9... e1=Q+ { [%clk 1:35:00] [%eval #-2] } *`;
  const g = parseGame(sample);
  assert.equal(g.plyCount, 4);
  assert.equal(g.whiteClock, 6000);
  assert.equal(g.blackClock, 5700);
  assert.deepEqual(g.lastEval, { pawns: -12, mate: -2, ply: 4 });
  assert.equal(g.lastMove, '9... e1=Q+');
  assert.equal(g.moveNumber, 10);
  assert.equal(g.isWhiteTurn, true);
});

test('stray comments, ";" comments, glued move numbers, depth suffixes and fractional clocks', () => {
  const { moves, result } = parseMovetext(
    '{ game opening comment } 1.e4 { [%eval 0.3,22] [%clk 1:59:58.5] } ; a line comment with e5 in it\n 1...e5 {note} {[%clk 1:59:50]} 2. Nf3! {[%eval #0] [%clk 0:00:09.9]} 1/2-1/2'
  );
  assert.deepEqual(moves.map((m) => m.san), ['e4', 'e5', 'Nf3']);
  assert.equal(moves[0].evalPawns, 0.3);
  assert.equal(moves[0].clk, 1 * 3600 + 59 * 60 + 58.5);
  assert.equal(moves[1].clk, 7190);
  assert.equal(moves[2].clk, 9.9);
  assert.equal(moves[2].evalPawns, null, '#0 has no side, so no eval');
  assert.equal(result, '1/2-1/2');
  assert.deepEqual(moves.map((m) => [m.moveNumber, m.isBlack]), [[1, false], [1, true], [2, false]]);
});

test('moves with no explicit black number still alternate colours', () => {
  const { moves } = parseMovetext('1. d4 d5 2. c4 e6');
  assert.deepEqual(moves.map((m) => [m.moveNumber, m.isBlack]), [[1, false], [1, true], [2, false], [2, true]]);
});

test('stripPgnVariations drops nested variations but keeps comments intact', () => {
  assert.equal(
    stripPgnVariations('1. e4 (1. d4 (1... c5)) e5 { keep (parens) in comment }'),
    '1. e4  e5 { keep (parens) in comment }'
  );
});

test('shortOpening trims the variation tail', () => {
  assert.equal(shortOpening('Ruy Lopez: Berlin Defense, l\'Hermet Variation, Berlin Wall Defense'), 'Ruy Lopez: Berlin Defense');
  assert.equal(shortOpening("Queen's Pawn Game: London System"), "Queen's Pawn Game: London System");
  assert.equal(shortOpening('Sicilian Defense'), 'Sicilian Defense');
  assert.equal(shortOpening(''), '');
});
