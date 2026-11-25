// Pure helpers that turn a stored snapshot into what is on screen *right now*.
// Nothing here mutates stored data: a clock is "the sample we fetched, minus the time that has passed since".

import { EVENT } from './event.js';
import { calculateGameProbabilities, calculateMatchExpectancy, pregameOdds } from './odds.js';

/** Remaining time on both clocks at `now`. `delaySec` shows what a stream running that far behind would show. */
export function clocksNow(detail, now = Date.now(), delaySec = 0) {
  const c = detail.clocks;
  let whiteSec = c.whiteSec;
  let blackSec = c.blackSec;
  if (detail.status === 'LIVE' && c.ticking) {
    const run = Math.max(0, (now - c.asOf) / 1000 - Math.max(0, delaySec));
    if (c.ticking === 'w') whiteSec = Math.max(0, whiteSec - run);
    else blackSec = Math.max(0, blackSec - run);
  }
  return { whiteSec, blackSec };
}

function formOf(snapshot, key) {
  const p = snapshot.players.find((x) => x.key === key);
  return p ? p.form || 0 : 0;
}

/** White/draw/loss for a round at `now`, with the live clocks and whatever eval is known. */
export function deriveGame(snapshot, detail, now = Date.now(), delaySec = 0) {
  const { whiteSec, blackSec } = clocksNow(detail, now, delaySec);
  const ev = detail.eval;
  const probs = calculateGameProbabilities({
    evalPawns: ev ? ev.pawns : null,
    mateIn: ev ? ev.mate : null,
    evalAgePlies: ev ? Math.max(0, detail.plyCount - ev.ply) : 0,
    whiteTimeSec: whiteSec,
    blackTimeSec: blackSec,
    moveNumber: detail.moveNumber,
    plyCount: detail.plyCount,
    whiteElo: detail.white.elo,
    blackElo: detail.black.elo,
    whiteFormBonus: formOf(snapshot, detail.white.key),
    blackFormBonus: formOf(snapshot, detail.black.key),
    opening: detail.opening,
    result: detail.result,
  });
  return { whiteSec, blackSec, probs };
}

function aWhiteFn(snapshot) {
  const [a] = snapshot.players;
  return (round) => {
    const key = snapshot.dp.whiteKeys[round];
    if (key) return key === a.key;
    return round % 2 === (EVENT.firstWhiteIndex === 0 ? 1 : 0);
  };
}

function profilesOf(snapshot) {
  return snapshot.players.map((p) => ({ elo: p.elo, form: p.form || 0, rapid: p.rapid || 0 }));
}

/** Title odds for the match. `liveRound`/`liveProbs` let one open game use its live odds (or a forced result). */
export function matchOdds(snapshot, liveRound = null, liveProbs = null) {
  return calculateMatchExpectancy({
    scoreA: snapshot.score.a,
    scoreB: snapshot.score.b,
    unplayed: snapshot.dp.unplayed,
    aWhite: aWhiteFn(snapshot),
    liveRound,
    liveProbs,
    profiles: profilesOf(snapshot),
    target: snapshot.score.target,
  });
}

/** What each result of an unfinished classical game would do to the title odds: { whiteWin, draw, blackWin }. */
export function stakesFor(snapshot, detail) {
  if (detail.status === 'FINISHED' || detail.kind !== 'classical') return null;
  const force = (whiteWin, draw, blackWin) => matchOdds(snapshot, detail.n, { whiteWin, draw, blackWin });
  return { whiteWin: force(1, 0, 0), draw: force(0, 1, 0), blackWin: force(0, 0, 1) };
}

/** Pre-game odds for a round that has not started, by the colours the pairing says. */
export function pregameFor(snapshot, detail) {
  const profile = (key) => snapshot.players.find((p) => p.key === key) || { elo: 2750, form: 0 };
  const w = profile(detail.white.key);
  const b = profile(detail.black.key);
  return pregameOdds({ elo: detail.white.elo || w.elo, form: w.form || 0 }, { elo: detail.black.elo || b.elo, form: b.form || 0 });
}

/** Points of the player with `key` and of the other, from a snapshot: { mine, theirs }. */
export function scoreFor(snapshot, key) {
  const [a, b] = snapshot.players;
  return key === a.key ? { mine: snapshot.score.a, theirs: snapshot.score.b } : { mine: snapshot.score.b, theirs: snapshot.score.a };
}

/** A player's title odds from a snapshot's odds object. */
export function titleOddsFor(snapshot, odds, key) {
  return key === snapshot.players[0].key ? odds.a : odds.b;
}
