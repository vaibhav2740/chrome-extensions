// Turns the Lichess broadcast into Zeitnot's snapshot.
//
// What is fetched, and when (Lichess' CDN caches every one of these for 10 s, so polling faster is pointless):
//   tour JSON        every sync (4 KB): the round list and which round is on.
//   tour PGN         once, then only when a game finishes: pairings (who has White) and results. Cached for good.
//   live round JSON  only while a game is on: both clocks (centiseconds), the FEN and `thinkTime` (SECONDS).
//   live round PGN   only while a game is on: every move with its clock and, if present, eval.
//   cloud eval       at most once per position, only while a game is on and its PGN has no eval for it.
//   finished round   its PGN, on demand, then cached.

import {
  EVENT, FALLBACK_TOUR_PAGE, TOUR_PGN_URL, TOUR_URL, cloudEvalUrl, playerIndex, roundJsonUrl, roundPgnUrl,
} from './event.js';
import { parseGame, splitPgnGames } from './pgn.js';
import { deriveGame, matchOdds } from './live.js';

export const SNAPSHOT_VERSION = 3;
const HOUR = 3600 * 1000;

export const emptyCache = () => ({ pairings: {}, results: {}, checked: {}, cloud: null, pgnAt: 0, roundCount: 0 });

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

function normalizeResult(pgnResult, apiStatus) {
  if (pgnResult && pgnResult !== '*') return pgnResult;
  if (apiStatus === '½-½' || apiStatus === '1/2-1/2') return '1/2-1/2';
  if (apiStatus === '1-0' || apiStatus === '0-1') return apiStatus;
  return '*';
}

/** Round list from the tour JSON. `ongoing` / `finished` are Lichess' own flags. */
export function buildRoundMeta(tourJson) {
  return (tourJson.rounds || []).map((r, i) => ({
    id: r.id,
    n: i + 1,
    name: r.name || `Game ${i + 1}`,
    kind: i < EVENT.games ? 'classical' : 'tiebreak',
    startsAt: r.startsAt || null,
    finishedAt: r.finishedAt || null,
    url: r.url || FALLBACK_TOUR_PAGE,
    ongoing: Boolean(r.ongoing) && !r.finished,
    finished: Boolean(r.finished),
  }));
}

export function statusOf(meta, results) {
  const res = results[meta.id];
  if (res && res !== '*') return 'FINISHED';
  if (meta.ongoing) return 'LIVE';
  return meta.finished ? 'FINISHED' : 'UPCOMING';
}

/** Reads a whole-tournament PGN into { pairings, results } keyed by Lichess round id. */
export function readTournamentPgn(pgnText, meta) {
  const pairings = {};
  const results = {};
  for (const chunk of splitPgnGames(pgnText)) {
    const game = parseGame(chunk);
    const id = (game.roundId && meta.find((m) => m.id === game.roundId)?.id) || meta[(game.roundNumber || 0) - 1]?.id;
    if (!id) continue;
    const w = playerIndex(game.white, game.whiteFideId);
    const b = playerIndex(game.black, game.blackFideId);
    const elo = {};
    if (w !== -1 && game.whiteElo) elo[w] = game.whiteElo;
    if (b !== -1 && game.blackElo) elo[b] = game.blackElo;
    pairings[id] = { whiteIdx: w !== -1 ? w : b !== -1 ? 1 - b : null, elo, opening: game.opening };
    if (game.result !== '*') results[id] = game.result;
  }
  return { pairings, results };
}

function whiteIndexFor(meta, pairing) {
  if (pairing && (pairing.whiteIdx === 0 || pairing.whiteIdx === 1)) return pairing.whiteIdx;
  const first = EVENT.firstWhiteIndex;
  return meta.n % 2 === 1 ? first : 1 - first;
}

function slug(name) {
  return String(name || 'player').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'player';
}

function playerInfo({ idx, name, fideId, rating, title, fed }) {
  const configured = idx !== -1 ? EVENT.players[idx] : null;
  const fullName = name || configured?.fullName || 'Player';
  return {
    key: configured ? configured.key : slug(fullName),
    name: configured ? configured.name : fullName.split(/[ ,]+/)[0],
    fullName,
    elo: rating || configured?.elo || 2700,
    title: title || configured?.title || '',
    fed: fed || configured?.fed || '',
    fideId: fideId || configured?.fideId || null,
  };
}

/**
 * Everything the popup needs to draw one game. `game` is the round JSON's game (live only), `pgn` the parsed PGN,
 * `cloud` a cloud eval ({pawns, mate} or null). `ageMs` is how stale the CDN copy of the live JSON was.
 */
export function buildRoundDetail({ meta, status, pairing, game = null, pgn = null, cloud = null, fetchedAt, ageMs = 0 }) {
  const whiteIdx = whiteIndexFor(meta, pairing);
  const apiW = game?.players?.[0];
  const apiB = game?.players?.[1];

  const wIdx = apiW ? playerIndex(apiW.name, apiW.fideId) : pgn ? playerIndex(pgn.white, pgn.whiteFideId) : whiteIdx;
  const bIdx = apiB ? playerIndex(apiB.name, apiB.fideId) : pgn ? playerIndex(pgn.black, pgn.blackFideId) : 1 - whiteIdx;
  const white = playerInfo({
    idx: wIdx,
    name: apiW?.name || pgn?.white,
    fideId: apiW?.fideId || pgn?.whiteFideId,
    rating: apiW?.rating || pgn?.whiteElo || pairing?.elo?.[wIdx],
    title: apiW?.title,
    fed: apiW?.fed,
  });
  const black = playerInfo({
    idx: bIdx,
    name: apiB?.name || pgn?.black,
    fideId: apiB?.fideId || pgn?.blackFideId,
    rating: apiB?.rating || pgn?.blackElo || pairing?.elo?.[bIdx],
    title: apiB?.title,
    fed: apiB?.fed,
  });

  const result = normalizeResult(pgn?.result, game?.status);
  const finalStatus = result !== '*' ? 'FINISHED' : status;
  const live = finalStatus === 'LIVE';

  // Turn and move number: the FEN is authoritative while live, the PGN otherwise.
  let isWhiteTurn = pgn ? pgn.isWhiteTurn : true;
  let moveNumber = pgn ? pgn.moveNumber : 1;
  if (game?.fen) {
    const parts = game.fen.split(' ');
    if (parts[1] === 'w' || parts[1] === 'b') isWhiteTurn = parts[1] === 'w';
    const full = parseInt(parts[5], 10);
    if (Number.isFinite(full)) moveNumber = full;
  }
  const plyCount = pgn ? pgn.plyCount : game?.fen ? (moveNumber - 1) * 2 + (isWhiteTurn ? 0 : 1) : 0;

  // Clocks. The round JSON gives centiseconds as of the last move; `thinkTime` is the SECONDS the side to move has
  // spent since. (An earlier version divided it by 100 and showed the running clock minutes too high.)
  let whiteSec = isNum(apiW?.clock) ? apiW.clock / 100 : pgn?.whiteClock ?? 7200;
  let blackSec = isNum(apiB?.clock) ? apiB.clock / 100 : pgn?.blackClock ?? 7200;
  if (live && isNum(game?.thinkTime) && game.thinkTime > 0) {
    if (isWhiteTurn) whiteSec -= game.thinkTime;
    else blackSec -= game.thinkTime;
  }
  whiteSec = Math.max(0, whiteSec);
  blackSec = Math.max(0, blackSec);

  let ev = pgn?.lastEval ? { pawns: pgn.lastEval.pawns, mate: pgn.lastEval.mate, ply: pgn.lastEval.ply, source: 'pgn' } : null;
  if (live && cloud && (!ev || ev.ply < plyCount)) {
    ev = { pawns: cloud.pawns, mate: cloud.mate, ply: plyCount, source: 'cloud' };
  }

  return {
    id: meta.id,
    n: meta.n,
    name: meta.name,
    kind: meta.kind,
    status: finalStatus,
    result,
    startsAt: meta.startsAt,
    finishedAt: meta.finishedAt,
    url: meta.url,
    gameUrl: pgn?.gameUrl || meta.url,
    opening: pgn?.opening || pairing?.opening || '',
    eco: pgn?.eco || '',
    white,
    black,
    plyCount,
    completedMoves: pgn ? pgn.completedMoves : Math.floor(plyCount / 2),
    moveNumber,
    isWhiteTurn,
    lastMove: pgn?.lastMove || null,
    clocks: {
      whiteSec,
      blackSec,
      asOf: fetchedAt - ageMs,
      ticking: live ? (isWhiteTurn ? 'w' : 'b') : null,
      // True when only the PGN was available, so the running clock is as of the last move, not as of now.
      approx: live && !game,
    },
    eval: ev,
    // Compact per-ply series for the charts: move number, black?, SAN, clock (s), eval (pawns), mate.
    moves: pgn ? pgn.moves.map((m) => ({ n: m.moveNumber, b: m.isBlack ? 1 : 0, s: m.san, c: m.clk, e: m.evalPawns, m: m.mate })) : [],
    fetchedAt,
  };
}

function scoreFromResults(meta, pairings, results) {
  const points = [0, 0];
  let played = 0;
  for (const m of meta) {
    if (m.kind !== 'classical') continue;
    const res = results[m.id];
    if (!res || res === '*') continue;
    played++;
    const whiteIdx = whiteIndexFor(m, pairings[m.id]);
    if (res === '1/2-1/2') {
      points[0] += 0.5;
      points[1] += 0.5;
    } else if (res === '1-0') points[whiteIdx] += 1;
    else if (res === '0-1') points[1 - whiteIdx] += 1;
  }
  return { points, played };
}

function pickFocus(meta, statuses, defaultRoundId, now) {
  const live = meta.findIndex((_, i) => statuses[i] === 'LIVE');
  if (live !== -1) return live;
  let lastFinished = -1;
  for (let i = meta.length - 1; i >= 0; i--) {
    if (statuses[i] === 'FINISHED') {
      lastFinished = i;
      break;
    }
  }
  const next = meta.findIndex((_, i) => statuses[i] === 'UPCOMING' && i > lastFinished);
  if (next !== -1) {
    const soon = (meta[next].startsAt || Infinity) - now <= 3 * HOUR;
    if (lastFinished === -1 || soon || meta[next].id === defaultRoundId) return next;
  }
  if (lastFinished !== -1) return lastFinished;
  return next !== -1 ? next : 0;
}

function latestRatings(meta, pairings) {
  const ratings = [null, null];
  for (const m of meta) {
    const elo = pairings[m.id]?.elo;
    if (!elo) continue;
    for (const idx of [0, 1]) if (isNum(elo[idx])) ratings[idx] = elo[idx];
  }
  return ratings;
}

function buildPlayers(tourJson, meta, pairings, liveDetail) {
  const ratings = latestRatings(meta, pairings);
  return EVENT.players.map((p, idx) => {
    let elo = ratings[idx] || p.elo;
    if (liveDetail) {
      for (const side of [liveDetail.white, liveDetail.black]) if (side.key === p.key && side.elo) elo = side.elo;
    }
    const photo = tourJson.photos?.[p.fideId]?.small || null;
    return { key: p.key, name: p.name, fullName: p.fullName, fed: p.fed, title: p.title, fideId: p.fideId, elo, form: p.form, rapid: p.rapid, photo };
  });
}

async function fetchCloudEval(client, fen, cache, now) {
  const hit = cache.cloud;
  if (hit && hit.fen === fen && (!hit.miss || now - hit.at < 60 * 1000)) return hit.miss ? null : hit;
  try {
    const { body } = await client.json(cloudEvalUrl(fen), 4000);
    const pv = body?.pvs?.[0];
    if (pv && (isNum(pv.mate) || isNum(pv.cp))) {
      // Lichess reports these from White's point of view.
      cache.cloud = isNum(pv.mate)
        ? { fen, mate: pv.mate, pawns: pv.mate > 0 ? 12 : -12, miss: false, at: now }
        : { fen, mate: null, pawns: pv.cp / 100, miss: false, at: now };
      return cache.cloud;
    }
  } catch (err) {
    if (err && err.status === 429) throw err;
  }
  cache.cloud = { fen, miss: true, at: now };
  return null;
}

function prune(details, keepIds) {
  const ids = Object.keys(details);
  if (ids.length <= 20) return details;
  const next = {};
  for (const id of ids.filter((i) => keepIds.has(i)).concat(ids.filter((i) => !keepIds.has(i)).slice(-6))) next[id] = details[id];
  return next;
}

/** A finished game's cached detail is kept, but re-read for a day or so: Lichess adds engine evals after the game. */
function detailIsFinal(detail, now) {
  if (!detail || detail.status !== 'FINISHED' || detail.result === '*') return false;
  const age = now - (detail.fetchedAt || 0);
  const sinceEnd = now - (detail.finishedAt || detail.startsAt || 0);
  return age < 30 * 60 * 1000 || sinceEnd > 36 * HOUR;
}

async function readFinishedDetail({ client, meta, pairing, now, pgn: already = null }) {
  const pgn = already || parseGame((await client.text(roundPgnUrl(meta.id))).body);
  return buildRoundDetail({ meta, status: 'FINISHED', pairing, pgn, fetchedAt: now });
}

/**
 * One full sync. Pass the previous `cache` and `details` (from storage); get back the new snapshot plus both.
 * Throws a LichessError when the tour list itself cannot be read, so the caller can back off.
 */
export async function syncTournament({ client, cache: prevCache = emptyCache(), details: prevDetails = {}, now = Date.now() }) {
  const cache = { ...emptyCache(), ...prevCache, pairings: { ...prevCache.pairings }, results: { ...prevCache.results }, checked: { ...prevCache.checked } };
  // First run: ask for the tour PGN at the same time as the tour JSON instead of one after the other.
  const early = cache.pgnAt ? null : client.text(TOUR_PGN_URL).catch((err) => err);
  const { body: tourJson } = await client.json(TOUR_URL);
  const meta = buildRoundMeta(tourJson);
  if (meta.length === 0) throw new Error('The broadcast has no rounds yet');

  // The whole-tournament PGN (13 KB) holds every pairing and the finished results, which never change again, so it
  // is read once and then only when a round has finished without a cached result (at most every two minutes).
  const missingResult = meta.some((m) => m.finished && !cache.results[m.id]);
  const needTourPgn =
    !cache.pgnAt ||
    cache.roundCount !== meta.length ||
    now - cache.pgnAt > 12 * HOUR ||
    (missingResult && now - cache.pgnAt > 2 * 60 * 1000);
  if (needTourPgn) {
    const res = await (early || client.text(TOUR_PGN_URL).catch((err) => err));
    if (res instanceof Error) {
      // Not fatal: colours fall back to alternating and the score to what is cached. Only a 429 should stop the sync.
      if (res.status === 429) throw res;
    } else {
      const read = readTournamentPgn(res.body, meta);
      Object.assign(cache.pairings, read.pairings);
      Object.assign(cache.results, read.results);
      cache.pgnAt = now;
      cache.roundCount = meta.length;
    }
  }

  // A game can end, and Lichess flip its round to "finished", between two polls. Its own PGN (1 KB) has the result
  // right away; waiting for the tour PGN refresh would leave the score and any notification a couple of minutes behind.
  // A finished round that never gets a result (abandoned, say) is only re-checked every five minutes.
  const justRead = new Map(); // round id -> parsed PGN, so a round read here is not downloaded again below
  const unresolved = meta
    .filter((m) => m.finished && !cache.results[m.id] && !(cache.checked[m.id] && now - cache.checked[m.id] < 5 * 60 * 1000))
    .slice(-3);
  await Promise.all(
    unresolved.map(async (m) => {
      cache.checked[m.id] = now;
      try {
        const { body } = await client.text(roundPgnUrl(m.id));
        const pgn = parseGame(body);
        justRead.set(m.id, pgn);
        if (pgn.result !== '*') cache.results[m.id] = pgn.result;
      } catch {
        // The next sync tries again.
      }
    })
  );

  const details = { ...prevDetails };
  let liveMeta = meta.find((m) => statusOf(m, cache.results) === 'LIVE') || null;
  let liveDetail = null;
  if (liveMeta) {
    const [jsonRes, pgnRes] = await Promise.all([
      client.json(roundJsonUrl(liveMeta.id)).catch((err) => err),
      client.text(roundPgnUrl(liveMeta.id)).catch((err) => err),
    ]);
    const jsonOk = !(jsonRes instanceof Error);
    const pgnOk = !(pgnRes instanceof Error);
    if (!jsonOk && !pgnOk) throw jsonRes;
    const game = jsonOk ? jsonRes.body?.games?.[0] || null : null;
    const pgn = pgnOk ? parseGame(pgnRes.body) : null;
    const fetchedAt = now;
    let cloud = null;
    const pgnHasCurrentEval = pgn?.lastEval && pgn.lastEval.ply >= pgn.plyCount;
    if (game?.fen && !pgnHasCurrentEval && pgn && pgn.plyCount > 0) cloud = await fetchCloudEval(client, game.fen, cache, now).catch(() => null);
    liveDetail = buildRoundDetail({
      meta: liveMeta,
      status: 'LIVE',
      pairing: cache.pairings[liveMeta.id],
      game,
      pgn,
      cloud,
      fetchedAt,
      ageMs: jsonOk ? jsonRes.ageMs : pgnRes.ageMs,
    });
    details[liveMeta.id] = liveDetail;
    if (liveDetail.result !== '*') {
      cache.results[liveMeta.id] = liveDetail.result;
      liveMeta = null;
    }
  }

  const statuses = meta.map((m) => statusOf(m, cache.results));
  const focusIdx = pickFocus(meta, statuses, tourJson.defaultRoundId, now);
  const focusMeta = meta[focusIdx];
  const focusStatus = statuses[focusIdx];
  if (focusStatus !== 'LIVE' || !details[focusMeta.id]) {
    const pairing = cache.pairings[focusMeta.id];
    if (focusStatus === 'FINISHED' && !detailIsFinal(details[focusMeta.id], now)) {
      try {
        details[focusMeta.id] = await readFinishedDetail({ client, meta: focusMeta, pairing, now, pgn: justRead.get(focusMeta.id) });
      } catch (err) {
        if (!details[focusMeta.id]) details[focusMeta.id] = buildRoundDetail({ meta: focusMeta, status: 'FINISHED', pairing, fetchedAt: now });
      }
    } else if (focusStatus === 'UPCOMING') {
      details[focusMeta.id] = buildRoundDetail({ meta: focusMeta, status: 'UPCOMING', pairing, fetchedAt: now });
    }
  }

  const { points, played } = scoreFromResults(meta, cache.pairings, cache.results);
  const players = buildPlayers(tourJson, meta, cache.pairings, liveDetail);
  const rounds = meta.map((m, i) => {
    const pairing = cache.pairings[m.id];
    return {
      id: m.id,
      n: m.n,
      name: m.name,
      kind: m.kind,
      status: statuses[i],
      result: cache.results[m.id] || '*',
      startsAt: m.startsAt,
      finishedAt: m.finishedAt,
      url: m.url,
      whiteKey: players[whiteIndexFor(m, pairing)].key,
    };
  });

  const liveRound = rounds.find((r) => r.status === 'LIVE') || null;
  let lastFinished = null;
  for (let i = rounds.length - 1; i >= 0; i--) {
    if (rounds[i].status === 'FINISHED') {
      lastFinished = rounds[i];
      break;
    }
  }
  const nextRound = rounds.find((r) => r.status === 'UPCOMING' && (!lastFinished || r.n > lastFinished.n)) || null;

  const info = tourJson.tour?.info || {};
  const snapshot = {
    v: SNAPSHOT_VERSION,
    fetchedAt: now,
    event: {
      name: tourJson.tour?.name || EVENT.fallbackName,
      location: info.location || EVENT.fallbackLocation,
      timeControl: info.tc || '',
      timeZone: info.timeZone || '',
      url: tourJson.tour?.url || FALLBACK_TOUR_PAGE,
      website: info.website || '',
    },
    players,
    score: { a: points[0], b: points[1], played, target: EVENT.target, games: EVENT.games },
    odds: null,
    rounds,
    liveRoundId: liveRound ? liveRound.id : null,
    nextRoundId: nextRound ? nextRound.id : null,
    lastFinishedRoundId: lastFinished ? lastFinished.id : null,
    focusRoundId: focusMeta.id,
    dp: {
      unplayed: rounds.filter((r) => r.kind === 'classical' && r.status !== 'FINISHED').map((r) => r.n),
      whiteKeys: Object.fromEntries(rounds.map((r) => [r.n, r.whiteKey])),
    },
  };

  const liveNow = liveDetail && liveDetail.status === 'LIVE' ? liveDetail : null;
  snapshot.odds = withDecision(snapshot, matchOdds(snapshot, liveNow ? liveNow.n : null, liveNow ? deriveGame(snapshot, liveNow, now).probs : null));

  return { snapshot, details: prune(details, new Set([focusMeta.id, liveDetail ? liveDetail.id : null])), cache };
}

/** Adds whether the match is already decided (someone has 7.5) and who won. */
export function withDecision(snapshot, odds) {
  const { a, b, target } = snapshot.score;
  const decided = a >= target || b >= target;
  return { ...odds, decided, winnerKey: !decided ? null : a >= target ? snapshot.players[0].key : snapshot.players[1].key };
}

/**
 * Detail for a round the popup asked for that is not the focus round. Finished rounds come from the cache or one
 * PGN download; upcoming rounds need no network at all.
 */
export async function fetchRoundDetail({ client, roundId, snapshot, cache, details = {}, now = Date.now() }) {
  const round = snapshot.rounds.find((r) => r.id === roundId);
  if (!round) throw new Error(`Unknown round ${roundId}`);
  const meta = { id: round.id, n: round.n, name: round.name, kind: round.kind, startsAt: round.startsAt, finishedAt: round.finishedAt, url: round.url };
  const pairing = cache.pairings[round.id];
  const next = { ...details };
  if (round.status === 'FINISHED') {
    if (!detailIsFinal(next[round.id], now)) {
      next[round.id] = await readFinishedDetail({ client, meta, pairing, now });
    }
  } else if (round.status === 'UPCOMING') {
    next[round.id] = buildRoundDetail({ meta, status: 'UPCOMING', pairing, fetchedAt: now });
  }
  return { detail: next[round.id], details: next };
}
