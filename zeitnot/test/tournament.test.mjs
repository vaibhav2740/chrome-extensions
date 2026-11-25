import test from 'node:test';
import assert from 'node:assert/strict';

import { createLichessClient, LichessError } from '../shared/lichess.js';
import { buildRoundDetail, emptyCache, fetchRoundDetail, readTournamentPgn, syncTournament } from '../shared/tournament.js';
import { buildRoundMeta } from '../shared/tournament.js';
import { clocksNow, deriveGame, matchOdds, stakesFor } from '../shared/live.js';
import { fixture, fixtureJson, liveRoutes, makeFetch, response } from './helpers.mjs';

const NOW = 1795617000000; // a moment during Game 2 in the fixtures
const clientFor = (routes, extra = {}) => {
  const log = [];
  return { client: createLichessClient({ fetchFn: makeFetch(routes, log), now: () => NOW, ...extra }), log };
};

test('thinkTime is SECONDS: the running clock is the JSON clock minus thinkTime, not minus thinkTime/100', async () => {
  const { client } = clientFor(liveRoutes());
  const { snapshot, details } = await syncTournament({ client, now: NOW });
  const d = details[snapshot.liveRoundId];
  // The fixture: White (to move) has clock 709100 cs = 7091 s and thinkTime 322 s; Black has 685800 cs = 6858 s.
  assert.equal(d.clocks.ticking, 'w');
  assert.equal(d.clocks.whiteSec, 7091 - 322);
  assert.equal(d.clocks.blackSec, 6858);
  assert.equal(d.clocks.asOf, NOW - 3000, 'the CDN copy was 3 s old (Age header), so the sample is as of then');
  assert.equal(d.clocks.approx, false);
  // …and from there it ticks down in real time (10 s later is 13 s after the sample).
  assert.equal(clocksNow(d, NOW + 10000).whiteSec, 7091 - 322 - 13);
  assert.equal(clocksNow(d, NOW + 10000).blackSec, 6858);
});

test('a stream delay shows the clock as that stream would, and never negative', async () => {
  const { client } = clientFor(liveRoutes());
  const { snapshot, details } = await syncTournament({ client, now: NOW });
  const d = details[snapshot.liveRoundId];
  // 13 s after the sample, shown as a stream 12 s behind: only 1 s has run on that stream.
  assert.equal(clocksNow(d, NOW + 10000, 12).whiteSec, 7091 - 322 - 1);
  d.clocks.whiteSec = 3;
  assert.equal(clocksNow(d, NOW + 60000).whiteSec, 0);
});

test('first sync: tour, tour PGN, live round JSON + PGN and one cloud eval; the warm sync is three small requests', async () => {
  const { client, log } = clientFor(liveRoutes());
  const first = await syncTournament({ client, now: NOW });
  assert.deepEqual(log.slice().sort(), [
    'broadcast/-/-/L3j03TZq',
    'broadcast/qfkdt8mn',
    'broadcast/qfkdt8mn.pgn',
    'broadcast/round/L3j03TZq.pgn',
    `cloud-eval?fen=${encodeURIComponent(fixtureJson('round-live.json').games[0].fen)}`,
  ].sort());

  log.length = 0;
  await syncTournament({ client, cache: first.cache, details: first.details, now: NOW + 30000 });
  assert.deepEqual(log.slice().sort(), ['broadcast/-/-/L3j03TZq', 'broadcast/qfkdt8mn', 'broadcast/round/L3j03TZq.pgn'].sort(),
    'no tour PGN (cached) and no cloud eval (same position)');
});

test('the snapshot: score, colours per round, live round, photos, odds', async () => {
  const { client } = clientFor(liveRoutes());
  const { snapshot, details } = await syncTournament({ client, now: NOW });
  assert.equal(snapshot.v, 3);
  assert.deepEqual([snapshot.score.a, snapshot.score.b, snapshot.score.played], [0.5, 0.5, 1]);
  assert.equal(snapshot.rounds.length, 14);
  assert.deepEqual(snapshot.rounds.map((r) => r.status).slice(0, 3), ['FINISHED', 'LIVE', 'UPCOMING']);
  assert.equal(snapshot.rounds[0].result, '1/2-1/2');
  // Game 1: Sindarov has White; Game 2: Gukesh. They alternate.
  assert.deepEqual(snapshot.rounds.slice(0, 4).map((r) => r.whiteKey), ['sindarov', 'gukesh', 'sindarov', 'gukesh']);
  assert.equal(snapshot.liveRoundId, 'L3j03TZq');
  assert.equal(snapshot.focusRoundId, 'L3j03TZq');
  assert.equal(snapshot.nextRoundId, 'fnmEB1kH');
  assert.equal(snapshot.lastFinishedRoundId, 'xLgOJ6cb');
  assert.deepEqual(snapshot.dp.unplayed, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.equal(snapshot.event.location, 'Geneva, Switzerland');
  assert.match(snapshot.players[0].photo, /^https:\/\/image\.lichess\.org\//);
  assert.equal(snapshot.players[1].elo, 2782);
  assert(Math.abs(snapshot.odds.a + snapshot.odds.b - 1) < 1e-9);
  assert.equal(snapshot.odds.decided, false);

  const d = details[snapshot.focusRoundId];
  assert.equal(d.status, 'LIVE');
  assert.equal(d.white.key, 'gukesh');
  assert.equal(d.black.key, 'sindarov');
  assert.equal(d.plyCount, 14);
  assert.equal(d.moveNumber, 8);
  assert.equal(d.moves.length, 14);
  assert.equal(d.moves[13].s, 'Qb6');
  assert.equal(d.moves[13].c, 6858);
});

test('the live PGN has no eval, so the position is evaluated once by cloud eval and then reused', async () => {
  const { client, log } = clientFor(liveRoutes());
  const { snapshot, details } = await syncTournament({ client, now: NOW });
  const ev = details[snapshot.liveRoundId].eval;
  assert.deepEqual([ev.source, ev.pawns, ev.mate, ev.ply], ['cloud', 0.11, null, 14]);
  assert(log.some((u) => u.startsWith('cloud-eval')));
});

test('with no eval from anywhere the game is shown without one instead of as 0.00', async () => {
  const { client } = clientFor(liveRoutes({ 'cloud-eval': { status: 404, body: { error: 'No cloud evaluation available for that position' } } }));
  const { snapshot, details, cache } = await syncTournament({ client, now: NOW });
  const d = details[snapshot.liveRoundId];
  assert.equal(d.eval, null);
  assert.equal(cache.cloud.miss, true);
  assert.equal(deriveGame(snapshot, d, NOW).probs.known, false);
});

test('a position that cloud eval missed is retried after a minute, not on every sync', async () => {
  const { client, log } = clientFor(liveRoutes({ 'cloud-eval': { status: 404, body: {} } }));
  const first = await syncTournament({ client, now: NOW });
  log.length = 0;
  await syncTournament({ client, cache: first.cache, details: first.details, now: NOW + 20000 });
  assert(!log.some((u) => u.startsWith('cloud-eval')));
  log.length = 0;
  await syncTournament({ client, cache: first.cache, details: first.details, now: NOW + 70000 });
  assert(log.some((u) => u.startsWith('cloud-eval')));
});

test('if the round JSON fails but the PGN is fine, the clocks are marked approximate', async () => {
  const { client } = clientFor(liveRoutes({ 'broadcast/-/-/L3j03TZq': { status: 502, body: 'bad gateway' } }));
  const { snapshot, details } = await syncTournament({ client, now: NOW });
  const d = details[snapshot.liveRoundId];
  assert.equal(d.clocks.approx, true);
  assert.equal(d.plyCount, 14);
  assert.equal(d.clocks.whiteSec, 7091);
});

test('if the tour list itself cannot be read the sync fails, so the caller backs off', async () => {
  const { client } = clientFor({ 'broadcast/qfkdt8mn': { status: 503, body: 'down' } });
  await assert.rejects(() => syncTournament({ client, now: NOW }), (err) => err instanceof LichessError && err.status === 503);
});

test('HTTP 429 puts the client in a cool-down and later calls fail without touching the network', async () => {
  let t = NOW;
  const log = [];
  const fetchFn = makeFetch({ qfkdt8mn: { status: 429, body: 'slow down', headers: { 'retry-after': '90' } } }, log);
  const client = createLichessClient({ fetchFn, now: () => t });
  await assert.rejects(() => client.json('https://lichess.org/api/broadcast/qfkdt8mn'), (e) => e.status === 429 && e.retryAfterMs === 90000);
  assert.equal(log.length, 1);
  await assert.rejects(() => client.json('https://lichess.org/api/broadcast/qfkdt8mn'), (e) => e.status === 429);
  assert.equal(log.length, 1, 'no second request during the cool-down');
  t += 91000;
  await assert.rejects(() => client.json('https://lichess.org/api/broadcast/qfkdt8mn'), (e) => e.status === 429);
  assert.equal(log.length, 2, 'asks again once the cool-down is over');
});

test('a request that hangs is aborted at the timeout', async () => {
  const fetchFn = (_url, { signal }) =>
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const client = createLichessClient({ fetchFn, timeoutMs: 20 });
  await assert.rejects(() => client.json('https://lichess.org/x'), /timed out/i);
});

test('with no game on, the focus is the last finished game and its PGN (with evals) is read once, then cached', async () => {
  const tour = fixtureJson('tour.json');
  for (const r of tour.rounds) delete r.ongoing; // Game 2 is not on
  tour.rounds[1].startsAt = NOW + 20 * 3600 * 1000;
  tour.defaultRoundId = 'xLgOJ6cb';
  const routes = {
    'broadcast/qfkdt8mn.pgn': fixture('tour.pgn'),
    'broadcast/qfkdt8mn': { body: tour },
    'broadcast/round/xLgOJ6cb.pgn': fixture('game1-finished.pgn'),
  };
  const { client, log } = clientFor(routes);
  const first = await syncTournament({ client, now: NOW });
  const s = first.snapshot;
  assert.equal(s.liveRoundId, null);
  assert.equal(s.focusRoundId, 'xLgOJ6cb');
  assert.equal(s.nextRoundId, 'L3j03TZq');
  const d = first.details['xLgOJ6cb'];
  assert.equal(d.status, 'FINISHED');
  assert.equal(d.result, '1/2-1/2');
  assert.equal(d.moves.length, 76);
  assert.deepEqual([d.eval.ply, d.eval.pawns], [76, 0]);
  assert.equal(d.clocks.ticking, null);

  log.length = 0;
  await syncTournament({ client, cache: first.cache, details: first.details, now: NOW + 60000 });
  assert.deepEqual(log, ['broadcast/qfkdt8mn'], 'a quiet day costs one 4 KB request');
});

test('results and colours score the match: a White win goes to whoever had White', () => {
  const meta = buildRoundMeta(fixtureJson('tour.json'));
  const pgn = fixture('tour.pgn')
    .replace(/(\[Round "2\.1"\][\s\S]*?\[Result )"\*"/, '$1"1-0"') // Game 2: Gukesh (White) wins
    .replace(/(\[Round "3\.1"\][\s\S]*?\[Result )"\*"/, '$1"0-1"'); // Game 3: Gukesh (Black) wins
  const { results, pairings } = readTournamentPgn(pgn, meta);
  assert.equal(results[meta[1].id], '1-0');
  assert.equal(results[meta[2].id], '0-1');
  assert.equal(pairings[meta[0].id].whiteIdx, 1);
  assert.equal(pairings[meta[1].id].whiteIdx, 0);
});

test('rounds beyond the 14 classical games (tiebreaks) never touch the classical score or odds', async () => {
  const tour = fixtureJson('tour.json');
  tour.rounds.push({ id: 'TB1TB1TB', name: 'Rapid Tiebreak 1', startsAt: NOW + 9e8 }, { id: 'TB2TB2TB', name: 'Rapid Tiebreak 2', startsAt: NOW + 9.1e8 });
  const { client } = clientFor(liveRoutes({ 'broadcast/qfkdt8mn': { body: tour } }));
  const { snapshot } = await syncTournament({ client, now: NOW });
  assert.equal(snapshot.rounds.length, 16);
  assert.deepEqual(snapshot.rounds.slice(14).map((r) => r.kind), ['tiebreak', 'tiebreak']);
  assert.equal(snapshot.dp.unplayed.length, 13);
  assert(!snapshot.dp.unplayed.includes(15));
  assert.equal(snapshot.score.played, 1);
});

test('stakes: what each result of the live game does to the title odds', async () => {
  const { client } = clientFor(liveRoutes());
  const { snapshot, details } = await syncTournament({ client, now: NOW });
  const d = details[snapshot.liveRoundId]; // Gukesh (a) has White
  const st = stakesFor(snapshot, d);
  assert(st.whiteWin.a > st.draw.a && st.draw.a > st.blackWin.a, 'a win for Gukesh is best for Gukesh');
  assert.equal(stakesFor(snapshot, { ...d, status: 'FINISHED' }), null);
  assert.equal(stakesFor(snapshot, { ...d, kind: 'tiebreak' }), null);
  // The live odds sit between the extremes.
  const live = matchOdds(snapshot, d.n, deriveGame(snapshot, d, NOW).probs);
  assert(live.a < st.whiteWin.a && live.a > st.blackWin.a);
});

test('a decided match reports its winner', async () => {
  const tour = fixtureJson('tour.json');
  const meta = buildRoundMeta(tour);
  // Sindarov wins every game: 8 wins reach 7.5.
  let pgn = fixture('tour.pgn');
  meta.slice(0, 8).forEach((m, i) => {
    const sindarovWhite = (i + 1) % 2 === 1;
    pgn = pgn.replace(new RegExp(`(\\[Round "${i + 1}\\.1"\\][\\s\\S]*?\\[Result )"[^"]*"`), `$1"${sindarovWhite ? '1-0' : '0-1'}"`);
  });
  for (const r of tour.rounds.slice(0, 8)) {
    r.finished = true;
    delete r.ongoing;
  }
  for (const r of tour.rounds.slice(8)) delete r.ongoing;
  const { client } = clientFor({
    'broadcast/qfkdt8mn.pgn': pgn,
    'broadcast/qfkdt8mn': { body: tour },
    'broadcast/round/': fixture('game1-finished.pgn'),
  });
  const { snapshot } = await syncTournament({ client, now: NOW });
  assert.equal(snapshot.score.b, 8);
  assert.equal(snapshot.odds.decided, true);
  assert.equal(snapshot.odds.winnerKey, 'sindarov');
  assert.deepEqual([snapshot.odds.a, snapshot.odds.b], [0, 1]);
});

test('fetchRoundDetail: a finished round is one PGN download then cached; an upcoming round needs no network', async () => {
  const { client, log } = clientFor(liveRoutes({ 'broadcast/round/xLgOJ6cb.pgn': fixture('game1-finished.pgn') }));
  const synced = await syncTournament({ client, now: NOW });
  log.length = 0;
  const a = await fetchRoundDetail({ client, roundId: 'xLgOJ6cb', snapshot: synced.snapshot, cache: synced.cache, details: synced.details, now: NOW });
  assert.deepEqual(log, ['broadcast/round/xLgOJ6cb.pgn']);
  assert.equal(a.detail.moves.length, 76);
  log.length = 0;
  const b = await fetchRoundDetail({ client, roundId: 'xLgOJ6cb', snapshot: synced.snapshot, cache: synced.cache, details: a.details, now: NOW + 60000 });
  assert.deepEqual(log, [], 'cached');
  assert.equal(b.detail.moves.length, 76);
  const up = await fetchRoundDetail({ client, roundId: 'fnmEB1kH', snapshot: synced.snapshot, cache: synced.cache, details: b.details, now: NOW });
  assert.deepEqual(log, []);
  assert.equal(up.detail.status, 'UPCOMING');
  assert.equal(up.detail.white.key, 'sindarov');
  await assert.rejects(() => fetchRoundDetail({ client, roundId: 'nope', snapshot: synced.snapshot, cache: synced.cache, now: NOW }), /Unknown round/);
});

test('buildRoundDetail copes with unknown players and missing data', () => {
  const meta = { id: 'abc', n: 3, name: 'Game 3', kind: 'classical', startsAt: 1, url: 'u' };
  const d = buildRoundDetail({ meta, status: 'UPCOMING', pairing: null, fetchedAt: NOW });
  assert.equal(d.white.key, 'sindarov', 'game 3 falls back to the alternating colours');
  assert.equal(d.moves.length, 0);
  assert.equal(d.clocks.whiteSec, 7200);
  const odd = buildRoundDetail({
    meta, status: 'LIVE', fetchedAt: NOW,
    game: { fen: '8/8/8/8/8/8/8/8 b - - 0 30', players: [{ name: 'Someone Else', rating: 2600, clock: 100000 }, { name: 'Another, Player', rating: 2500, clock: 90000 }], thinkTime: 10 },
  });
  assert.equal(odd.white.name, 'Someone');
  assert.equal(odd.white.key, 'someone-else');
  assert.equal(odd.isWhiteTurn, false);
  assert.equal(odd.clocks.blackSec, 900 - 10);
  assert.equal(odd.plyCount, 59);
});

test('a round that finished between two polls gets its result from its own PGN at once, not minutes later', async () => {
  const live = clientFor(liveRoutes());
  const synced = await syncTournament({ client: live.client, now: NOW });
  assert.equal(synced.snapshot.rounds[1].status, 'LIVE');

  const tour = fixtureJson('tour.json');
  delete tour.rounds[1].ongoing;
  tour.rounds[1].finished = true;
  const ended = fixture('round-live.pgn').replace('[Result "*"]', '[Result "0-1"]').replace(/ \*\s*$/, ' 0-1\n');
  const { client, log } = clientFor(liveRoutes({ 'broadcast/qfkdt8mn': { body: tour }, 'broadcast/round/L3j03TZq.pgn': ended }));
  const after = await syncTournament({ client, cache: synced.cache, details: synced.details, now: NOW + 40000 });
  assert.equal(after.snapshot.rounds[1].status, 'FINISHED');
  assert.equal(after.snapshot.rounds[1].result, '0-1');
  assert.deepEqual([after.snapshot.score.a, after.snapshot.score.b], [0.5, 1.5], 'Gukesh had White and lost');
  assert.equal(after.details['L3j03TZq'].result, '0-1');
  assert.deepEqual(log, ['broadcast/qfkdt8mn', 'broadcast/round/L3j03TZq.pgn'], 'the tour list and that one small PGN: no tour PGN, no second download');
});

test('a finished round that never gets a result is re-checked at most every five minutes', async () => {
  const tour = fixtureJson('tour.json');
  delete tour.rounds[1].ongoing;
  tour.rounds[1].finished = true;
  const { client, log } = clientFor(liveRoutes({ 'broadcast/qfkdt8mn': { body: tour } })); // its PGN still says "*"
  const roundPgnCalls = () => log.filter((u) => u === 'broadcast/round/L3j03TZq.pgn').length;

  const first = await syncTournament({ client, now: NOW });
  assert(roundPgnCalls() >= 1);
  assert.equal(first.cache.checked['L3j03TZq'], NOW);

  log.length = 0;
  const soon = await syncTournament({ client, cache: first.cache, details: first.details, now: NOW + 30000 });
  assert.equal(soon.cache.checked['L3j03TZq'], NOW, 'not asked again after 30 s');
  assert(!log.includes('broadcast/qfkdt8mn.pgn'));

  const later = await syncTournament({ client, cache: soon.cache, details: soon.details, now: NOW + 6 * 60000 });
  assert.equal(later.cache.checked['L3j03TZq'], NOW + 6 * 60000, 'asked again after five minutes');
});

test('if a finished game\'s own PGN cannot be read, its detail still carries the result the snapshot knows', async () => {
  const tour = fixtureJson('tour.json');
  delete tour.rounds[1].ongoing;
  tour.rounds[1].finished = true;
  const pgn = fixture('tour.pgn').replace(/(\[Round "2\.1"\][\s\S]*?\[Result )"\*"/, '$1"1-0"');
  const { client } = clientFor({ 'broadcast/qfkdt8mn.pgn': pgn, 'broadcast/qfkdt8mn': { body: tour } }); // round PGN: 404
  const { snapshot, details } = await syncTournament({ client, now: NOW });
  assert.equal(snapshot.rounds[1].result, '1-0');
  const d = details[snapshot.focusRoundId];
  assert.equal(d.status, 'FINISHED');
  assert.equal(d.result, '1-0', 'not "*"');
  assert.equal(deriveGame(snapshot, d, NOW).probs.whiteWin, 1);
  const other = await fetchRoundDetail({ client, roundId: snapshot.rounds[0].id, snapshot, cache: { pairings: {}, results: {} }, details: {}, now: NOW }).catch((e) => e);
  assert(other instanceof Error, 'a round that cannot be read is an error for the caller, not a made-up detail');
});
