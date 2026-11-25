import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  calculateGameProbabilities,
  calculateMatchExpectancy,
} from '../shared/probability_engine.js';
import {
  computeBadgeSpec,
  parseSingleGamePgn,
  resolveAnchoredSnapshot,
  splitPgnGames,
  stripPgnVariations,
  tryParseClockSeconds,
} from '../shared/wcc_data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

test('WDL probabilities normalize to 1 across evals and mates', () => {
  const cases = [
    { evalPawns: -8, plyCount: 40, moveNumber: 21 },
    { evalPawns: -1.5, plyCount: 40, moveNumber: 21 },
    { evalPawns: 0, plyCount: 0, moveNumber: 1 },
    { evalPawns: 0.35, plyCount: 26, moveNumber: 14, opening: 'Berlin Defense' },
    { evalPawns: 2.2, plyCount: 60, moveNumber: 31 },
    { mateIn: 3, plyCount: 50, moveNumber: 26 },
    { mateIn: -2, plyCount: 50, moveNumber: 26 },
  ];

  for (const c of cases) {
    const res = calculateGameProbabilities(c);
    const sum = res.whiteWin + res.draw + res.blackWin;
    assert(Math.abs(sum - 1.0) < 1e-9, `Expected sum 1.0, got ${sum}`);
    assert(res.whiteWin >= 0 && res.draw >= 0 && res.blackWin >= 0);
  }
});

test('WDL probabilities are strictly monotonic in evaluation', () => {
  const low = calculateGameProbabilities({ evalPawns: -0.5, plyCount: 30, moveNumber: 16, whiteTimeSec: 3600, blackTimeSec: 3600 });
  const eq = calculateGameProbabilities({ evalPawns: 0.0, plyCount: 30, moveNumber: 16, whiteTimeSec: 3600, blackTimeSec: 3600 });
  const high = calculateGameProbabilities({ evalPawns: 0.8, plyCount: 30, moveNumber: 16, whiteTimeSec: 3600, blackTimeSec: 3600 });

  assert(high.whiteWin > eq.whiteWin && eq.whiteWin > low.whiteWin);
  assert(low.blackWin > eq.blackWin && eq.blackWin > high.blackWin);
});

test('Phase 1 vs Phase 2 boundary splits cleanly at Move 40 vs Move 41', () => {
  const m40 = calculateGameProbabilities({ evalPawns: 0, plyCount: 79, moveNumber: 40, whiteTimeSec: 600, blackTimeSec: 120 });
  const m41 = calculateGameProbabilities({ evalPawns: 0, plyCount: 81, moveNumber: 41, whiteTimeSec: 2400, blackTimeSec: 1920 });
  assert.equal(m40.clocks.isPhase2, false);
  assert.equal(m40.clocks.mRem, 1);
  assert.equal(m41.clocks.isPhase2, true);
  assert.equal(m41.clocks.mRem, 20);
});

test('Absolute zeitnot increases time hazard and compresses draw stability at identical clock ratio', () => {
  const abundant = calculateGameProbabilities({
    evalPawns: 0,
    plyCount: 68,
    moveNumber: 35,
    whiteTimeSec: 3600, // 60m (5:1 ratio, 600s/mv vs 120s/mv)
    blackTimeSec: 720,  // 12m
  });
  const zeitnot = calculateGameProbabilities({
    evalPawns: 0,
    plyCount: 68,
    moveNumber: 35,
    whiteTimeSec: 900, // 15m (same 5:1 ratio, 150s/mv vs 30s/mv -> acute zeitnot!)
    blackTimeSec: 180, // 3m
  });
  assert(zeitnot.clocks.stressB > abundant.clocks.stressB);
  assert(zeitnot.timeShift > abundant.timeShift);
  assert(zeitnot.draw < abundant.draw);
});

test('DP Match Expectancy respects terminal states, score leads, and remaining games', () => {
  const won = calculateMatchExpectancy({ sindarovScore: 7.5, gukeshScore: 5.5, completedGames: 13 });
  assert.equal(won.sindarov, 1);
  assert.equal(won.gukesh, 0);

  const tied = calculateMatchExpectancy({ sindarovScore: 0.5, gukeshScore: 0.5, completedGames: 1, unplayedRoundNumbers: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] });
  assert(Math.abs(tied.sindarov + tied.gukesh - 1.0) < 1e-9);
  assert.equal(tied.remainingGames, 13);

  const gukeshLead = calculateMatchExpectancy({ sindarovScore: 0.5, gukeshScore: 1.5, completedGames: 2 });
  assert(gukeshLead.gukesh > tied.gukesh);
});

test('PGN parser handles RAV variations, NAGs, mixed tags, promotions, and results', () => {
  const sample = `[Event "FIDE WCC"]
[White "Gukesh D"]
[Black "Sindarov, Javokhir"]
[Round "2.1"]
[Result "*"]
[Opening "Ruy Lopez: Berlin Defense"]

1. e4 $1 { [%eval 0.18] [%clk 1:59:50] } (1. d4 d5 (1... Nf6)) e5 { [%clk 1:59:52] } 9. O-O-O+ { [%eval -0.45] [%clk 1:40:00] } 9... e1=Q+ { [%clk 1:35:00] [%eval #-2] } *`;

  const parsed = parseSingleGamePgn(sample);
  assert.equal(parsed.plyCount, 4);
  assert.equal(parsed.opening, 'Berlin Defense');
  assert.equal(parsed.whiteTimeStr, '1:40:00');
  assert.equal(parsed.blackTimeStr, '1:35:00');
  assert.equal(parsed.mateIn, -2);
  assert.equal(parsed.lastMove, '9... e1=Q+');
  assert.equal(parsed.moveNumber, 10);
  assert.equal(parsed.isWhiteTurn, true);

  assert.equal(stripPgnVariations('1. e4 (1. d4 (1... c5)) e5 { keep (parens) in comment }'), '1. e4  e5 { keep (parens) in comment }');
  assert.equal(splitPgnGames(`${sample}\n\n[Event "Game 3"]\n[Round "3.1"]\n*`).length, 2);
});

test('Clock parser rejects invalid strings cleanly', () => {
  assert.equal(tryParseClockSeconds('1:35:54'), 5754);
  assert.equal(tryParseClockSeconds('06:32'), 392);
  assert.equal(tryParseClockSeconds('abc'), null);
  assert.equal(tryParseClockSeconds('1:75:00'), null);
  assert.equal(tryParseClockSeconds(''), null);
});

test('Live clock anchor preserves calibrated clocks on same ply and resets on new move', () => {
  const makeSnap = (plyCount, wSec, bSec, status = 'LIVE') => ({
    activeRound: {
      id: 'L3j03TZq',
      roundNumber: 2,
      status,
      result: '*',
      opening: 'Berlin Defense',
      moveNumber: Math.floor(plyCount / 2) + 1,
      plyCount,
      isWhiteTurn: plyCount % 2 === 0,
      evalPawns: 0.15,
      mateIn: null,
      white: { name: 'Gukesh', fullName: 'Gukesh D', elo: 2710, timeSec: wSec, timeStr: '1:50:00' },
      black: { name: 'Sindarov', fullName: 'Sindarov, Javokhir', elo: 2782, timeSec: bSec, timeStr: '1:40:00' },
    },
  });

  const calAnchor = {
    roundId: 'L3j03TZq',
    plyCount: 20,
    whiteBaseSec: 5000,
    blackBaseSec: 4000,
    anchoredAt: 100000,
    isUserCalibrated: true,
  };

  // Same ply 15s later: must preserve user calibration - 15s, NOT clobber with 6600
  const same = resolveAnchoredSnapshot(makeSnap(20, 6600, 4000), calAnchor, 115000);
  assert.equal(same.snapshot.activeRound.white.timeSec, 4985);

  // New ply landed (plyCount 21): resets anchor to Lichess authoritative clock
  const next = resolveAnchoredSnapshot(makeSnap(21, 4950, 4000), calAnchor, 120000);
  assert.equal(next.anchor.isUserCalibrated, false);
  assert.equal(next.snapshot.activeRound.white.timeSec, 4950);

  // Finished game clears anchor
  const fin = resolveAnchoredSnapshot(makeSnap(21, 4950, 4000, 'FINISHED'), calAnchor, 125000);
  assert.equal(fin.anchor, null);
});

test('Badge telemetry computes live eval, imminent countdown, and idle states', () => {
  const base = {
    matchScore: { gukesh: 0.5, sindarov: 0.5 },
    isAnyGameLive: false,
    nextRound: { name: 'Game 2', startsAt: 1000000 + 10 * 60 * 1000 },
    activeRound: {
      roundNumber: 2,
      status: 'UPCOMING',
      plyCount: 0,
      evalPawns: 0,
      mateIn: null,
      white: { name: 'Gukesh', timeStr: '2:00:00' },
      black: { name: 'Sindarov', timeStr: '2:00:00' },
    },
  };

  const soon = computeBadgeSpec(base, 1000000);
  assert.equal(soon.text, '10m');

  const live = structuredClone(base);
  live.isAnyGameLive = true;
  live.activeRound.status = 'LIVE';
  live.activeRound.plyCount = 16;
  live.activeRound.evalPawns = -0.65;
  const liveBadge = computeBadgeSpec(live, 1000000);
  assert.equal(liveBadge.text, '-0.7');
  assert.equal(liveBadge.color, '#059669');
});

test('Manifest V3, PNG icon dimensions, CSP, and DOM bindings are valid', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.type, 'module');
  assert(fs.existsSync(path.join(ROOT, manifest.background.service_worker)));
  assert(fs.existsSync(path.join(ROOT, manifest.action.default_popup)));

  // Verify exact PNG pixel dimensions from IHDR header
  for (const [sizeStr, relPath] of Object.entries(manifest.icons)) {
    const buf = fs.readFileSync(path.join(ROOT, relPath));
    assert.equal(buf.toString('ascii', 1, 4), 'PNG');
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    const expected = parseInt(sizeStr, 10);
    assert.equal(w, expected, `${relPath} width`);
    assert.equal(h, expected, `${relPath} height`);
  }

  // CSP: no inline <script> bodies in popup.html and all getElementById IDs exist
  const html = fs.readFileSync(path.join(ROOT, 'popup/popup.html'), 'utf8');
  assert(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'Inline script violates MV3 CSP');
  const js = fs.readFileSync(path.join(ROOT, 'popup/popup.js'), 'utf8');
  for (const m of js.matchAll(/getElementById\('([^']+)'\)/g)) {
    assert(html.includes(`id="${m[1]}"`), `Missing DOM id in popup.html: ${m[1]}`);
  }
});
