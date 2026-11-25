import test from 'node:test';
import assert from 'node:assert/strict';

import { detectEvents } from '../shared/notify.js';
import { DEFAULT_SETTINGS, normalizeSettings } from '../shared/settings.js';
import { liveSnapshot } from './helpers.mjs';

const settings = (notify = {}, extra = {}) => normalizeSettings({ ...DEFAULT_SETTINGS, ...extra, notify: { soon: true, result: true, zeitnot: true, ...notify } });
const finish = (snapshot, roundIndex, result) => {
  const s = structuredClone(snapshot);
  s.rounds[roundIndex].status = 'FINISHED';
  s.rounds[roundIndex].result = result;
  s.liveRoundId = null;
  return s;
};

test('the first run records finished games as seen without announcing them', async () => {
  const { snapshot, now } = await liveSnapshot();
  const out = detectEvents({ prev: null, next: snapshot, detail: null, settings: settings(), notified: [], now });
  assert.deepEqual(out.events, []);
  assert(out.notified.includes(`result:${snapshot.rounds[0].id}`));
});

test('a game that finishes while we watch is announced once, with score and title odds', async () => {
  const { snapshot, now } = await liveSnapshot();
  const next = finish(snapshot, 1, '1-0'); // Game 2: Gukesh has White and wins
  next.score = { ...next.score, a: 1.5, b: 0.5, played: 2 };
  const first = detectEvents({ prev: snapshot, next, detail: null, settings: settings(), notified: [`result:${snapshot.rounds[0].id}`], now });
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0].title, 'Game 2: 1–0');
  assert.match(first.events[0].message, /Gukesh vs Sindarov · Gukesh 1½–½ Sindarov · title odds Gukesh \d+% \/ Sindarov \d+%/);
  assert.equal(first.events[0].url, snapshot.rounds[1].url);
  const again = detectEvents({ prev: snapshot, next, detail: null, settings: settings(), notified: first.notified, now });
  assert.deepEqual(again.events, []);
});

test('with result notifications off the result is still remembered, so enabling later does not replay it', async () => {
  const { snapshot, now } = await liveSnapshot();
  const next = finish(snapshot, 1, '1/2-1/2');
  const off = detectEvents({ prev: snapshot, next, detail: null, settings: settings({ result: false }), notified: [], now });
  assert.deepEqual(off.events, []);
  const on = detectEvents({ prev: snapshot, next, detail: null, settings: settings({ result: true }), notified: off.notified, now });
  assert.deepEqual(on.events, []);
});

test('the spoiler shield keeps the result out of the notification', async () => {
  const { snapshot, now } = await liveSnapshot();
  const next = finish(snapshot, 1, '0-1');
  const out = detectEvents({ prev: snapshot, next, detail: null, settings: settings({}, { spoilerShield: true }), notified: [], now });
  assert.equal(out.events[0].title, 'Game 2 has finished');
  assert.doesNotMatch(JSON.stringify(out.events[0]), /0–1|1–0|½/);
});

test('winning the match gets its own headline', async () => {
  const { snapshot, now } = await liveSnapshot();
  const next = finish(snapshot, 1, '0-1');
  next.odds = { ...next.odds, decided: true, winnerKey: 'sindarov' };
  const out = detectEvents({ prev: snapshot, next, detail: null, settings: settings(), notified: [], now });
  assert.equal(out.events[0].title, 'Sindarov, Javokhir wins the World Championship');
});

test('"starts soon" fires once, ten minutes out, and only while no game is on', async () => {
  const mk = (startsIn) => liveSnapshot({ mutate: (t) => { delete t.rounds[1].ongoing; t.rounds[1].startsAt = 1795617000000 + startsIn; } });
  const near = await mk(9 * 60000);
  const out = detectEvents({ prev: near.snapshot, next: near.snapshot, detail: null, settings: settings(), notified: [], now: near.now });
  assert.equal(out.events.length, 1);
  assert.equal(out.events[0].title, 'Game 2 starts in 9 min');
  assert.equal(out.events[0].message, 'Gukesh (White) vs Sindarov');
  assert.deepEqual(detectEvents({ prev: near.snapshot, next: near.snapshot, detail: null, settings: settings(), notified: out.notified, now: near.now }).events, []);
  const far = await mk(40 * 60000);
  assert.deepEqual(detectEvents({ prev: far.snapshot, next: far.snapshot, detail: null, settings: settings(), notified: [], now: far.now }).events, []);
  assert.deepEqual(detectEvents({ prev: near.snapshot, next: near.snapshot, detail: null, settings: settings({ soon: false }), notified: [], now: near.now }).events, []);
});

test('time trouble before move 40 alerts once per player, from the live clock', async () => {
  const { snapshot, details, now } = await liveSnapshot();
  const d = structuredClone(details[snapshot.liveRoundId]);
  d.clocks.whiteSec = 250; // Gukesh, to move, under five minutes
  d.moveNumber = 33;
  const out = detectEvents({ prev: snapshot, next: snapshot, detail: d, settings: settings(), notified: [], now: d.clocks.asOf });
  assert.equal(out.events.length, 1);
  assert.match(out.events[0].title, /^Time trouble: Gukesh has 4:10 left$/);
  assert.match(out.events[0].message, /8 moves to make before move 40, with no increment/);
  assert.deepEqual(detectEvents({ prev: snapshot, next: snapshot, detail: d, settings: settings(), notified: out.notified, now: d.clocks.asOf }).events, []);
  d.moveNumber = 41; // after move 40 the increment is back
  assert.deepEqual(detectEvents({ prev: snapshot, next: snapshot, detail: d, settings: settings(), notified: [], now: d.clocks.asOf }).events, []);
  d.moveNumber = 33;
  assert.deepEqual(detectEvents({ prev: snapshot, next: snapshot, detail: d, settings: settings({ zeitnot: false }), notified: [], now: d.clocks.asOf }).events, []);
});

test('the remembered list is capped', async () => {
  const { snapshot, now } = await liveSnapshot();
  const many = Array.from({ length: 1000 }, (_, i) => `x:${i}`);
  assert.equal(detectEvents({ prev: null, next: snapshot, detail: null, settings: settings(), notified: many, now }).notified.length, 300);
});
