import test from 'node:test';
import assert from 'node:assert/strict';

import { BADGE_COLORS, computeBadgeSpec } from '../shared/badge.js';
import { DEFAULT_SETTINGS, normalizeSettings } from '../shared/settings.js';
import { liveSnapshot } from './helpers.mjs';

const settings = (patch = {}) => normalizeSettings({ ...DEFAULT_SETTINGS, ...patch });

test('live game, eval from White\'s side by default, with the tooltip carrying clocks and score', async () => {
  const { snapshot, details, now } = await liveSnapshot();
  const d = details[snapshot.liveRoundId]; // Gukesh White, eval +0.11 from cloud
  const spec = computeBadgeSpec(snapshot, d, settings(), now);
  assert.equal(spec.text, '+0.1');
  assert.equal(spec.color, BADGE_COLORS.even, 'a tenth of a pawn is level');
  assert.match(spec.title, /Game 2 live/);
  assert.match(spec.title, /Gukesh \d:\d\d:\d\d – Sindarov \d:\d\d:\d\d/);
  assert.match(spec.title, /Gukesh ½–½ Sindarov/);
});

test('following the player with Black flips the sign and colours good/bad for them', async () => {
  const { snapshot, details, now } = await liveSnapshot();
  const d = structuredClone(details[snapshot.liveRoundId]);
  d.eval = { pawns: 1.4, mate: null, ply: d.plyCount, source: 'cloud' }; // White (Gukesh) is better
  const sindarov = computeBadgeSpec(snapshot, d, settings({ follow: 'sindarov' }), now);
  assert.equal(sindarov.text, '-1.4');
  assert.equal(sindarov.color, BADGE_COLORS.bad);
  const gukesh = computeBadgeSpec(snapshot, d, settings({ follow: 'gukesh' }), now);
  assert.equal(gukesh.text, '+1.4');
  assert.equal(gukesh.color, BADGE_COLORS.good);
  const neutral = computeBadgeSpec(snapshot, d, settings(), now);
  assert.equal(neutral.color, BADGE_COLORS.white);
});

test('mates, big evals and a missing eval', async () => {
  const { snapshot, details, now } = await liveSnapshot();
  const d = structuredClone(details[snapshot.liveRoundId]);
  d.eval = { pawns: -12, mate: -3, ply: d.plyCount };
  assert.equal(computeBadgeSpec(snapshot, d, settings(), now).text, '-#3');
  assert.equal(computeBadgeSpec(snapshot, d, settings({ follow: 'sindarov' }), now).text, '#3');
  d.eval = { pawns: 25, mate: null, ply: d.plyCount };
  assert.equal(computeBadgeSpec(snapshot, d, settings(), now).text, '+9.9');
  d.eval = null;
  const none = computeBadgeSpec(snapshot, d, settings(), now);
  assert.equal(none.text, 'LIVE');
  assert.match(none.title, /no engine eval yet/);
});

test('"odds" shows the followed player\'s title odds, or the favourite\'s when following nobody', async () => {
  const { snapshot, details, now } = await liveSnapshot();
  const d = details[snapshot.liveRoundId];
  const fav = computeBadgeSpec(snapshot, d, settings({ badge: 'odds' }), now);
  assert.match(fav.text, /^\d{1,3}%$/);
  assert.equal(parseInt(fav.text, 10), Math.round(Math.max(snapshot.odds.a, snapshot.odds.b) * 100));
  const g = computeBadgeSpec(snapshot, d, settings({ badge: 'odds', follow: 'gukesh' }), now);
  assert.equal(g.text, `${Math.round(snapshot.odds.a * 100)}%`);
  assert.equal(g.color, snapshot.odds.a >= 0.5 ? BADGE_COLORS.good : BADGE_COLORS.bad);
  assert.equal(computeBadgeSpec(snapshot, d, settings({ badge: 'off' }), now).text, 'LIVE');
});

test('the spoiler shield leaves only LIVE: no eval, no odds, no score', async () => {
  const { snapshot, details, now } = await liveSnapshot();
  const spec = computeBadgeSpec(snapshot, details[snapshot.liveRoundId], settings({ spoilerShield: true, badge: 'odds' }), now);
  assert.equal(spec.text, 'LIVE');
  assert.doesNotMatch(spec.title, /½|odds|eval|\d+%/i);
});

test('between games: a countdown pill in the last hour, then nothing; the tooltip always has the score', async () => {
  const mutate = (tour) => { delete tour.rounds[1].ongoing; };
  const at = async (startsInMs) => {
    const base = await liveSnapshot({ mutate: (t) => { mutate(t); t.rounds[1].startsAt = 1795617000000 + startsInMs; } });
    return computeBadgeSpec(base.snapshot, base.details[base.snapshot.focusRoundId], settings(), base.now);
  };
  const soon = await at(7 * 60000);
  assert.equal(soon.text, '7m');
  assert.equal(soon.color, BADGE_COLORS.soon);
  assert.match(soon.title, /Game 2 starts in 7m 00s/);
  assert.equal((await at(59.5 * 60000)).text, '60m');
  const far = await at(5 * 3600000);
  assert.equal(far.text, '');
  assert.match(far.title, /Game 2 in 5h/);
  assert.equal((await at(-60000)).text, 'NOW');
});

test('a decided match shows the champion; the shield hides it', async () => {
  const { snapshot, details, now } = await liveSnapshot();
  const won = structuredClone(snapshot);
  won.liveRoundId = null;
  won.odds = { ...won.odds, decided: true, winnerKey: 'sindarov', a: 0, b: 1 };
  const spec = computeBadgeSpec(won, details[won.focusRoundId], settings(), now);
  assert.equal(spec.text, 'SIN');
  assert.match(spec.title, /Sindarov, Javokhir wins the match/);
  assert.notEqual(computeBadgeSpec(won, details[won.focusRoundId], settings({ spoilerShield: true }), now).text, 'SIN');
});

test('no snapshot yet', () => {
  assert.deepEqual(computeBadgeSpec(null, null, settings()), { text: '', color: BADGE_COLORS.idle, title: 'Zeitnot' });
});
