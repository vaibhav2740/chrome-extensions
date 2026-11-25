import test from 'node:test';
import assert from 'node:assert/strict';

import { makeChrome } from './chrome-mock.mjs';
import { fixtureJson, liveRoutes, makeFetch } from './helpers.mjs';
import { CACHE_KEY, DETAILS_KEY, META_KEY, MSG_ROUND, MSG_SYNC, SNAPSHOT_KEY } from '../shared/keys.js';
import { SETTINGS_KEY } from '../shared/settings.js';

// The service worker reads `chrome` and `fetch` as globals, so set them before importing it. Each test file runs in
// its own process, so this module is only ever loaded once with these mocks.
const mock = makeChrome({ withNotifications: true });
globalThis.chrome = mock.chrome;
let routes = liveRoutes();
const log = [];
globalThis.fetch = (url, opts) => makeFetch(routes, log)(url, opts);
const bg = await import('../background.js');

const reset = () => {
  for (const k of Object.keys(mock.store)) delete mock.store[k];
  mock.alarms.clear();
  mock.created.length = 0;
  log.length = 0;
  routes = liveRoutes();
};

test('install: clears old keys, starts the alarms, syncs, and paints the badge', async () => {
  reset();
  mock.store.wccPulseStateV2 = { old: true };
  await mock.events.installed.fire({ reason: 'install' });
  assert.equal(mock.store.wccPulseStateV2, undefined, 'v1 state is removed');
  assert.equal(mock.store[SNAPSHOT_KEY].v, 3);
  assert(mock.store[DETAILS_KEY][mock.store[SNAPSHOT_KEY].liveRoundId]);
  assert(mock.store[CACHE_KEY].pairings);
  assert.equal(mock.badge.text, '+0.1');
  assert.equal(mock.badge.textColor, '#ffffff');
  assert.match(mock.badge.title, /Game 2 live/);
  const next = mock.alarms.get('zeitnot:sync');
  const delay = next.when - Date.now();
  assert(delay > 25000 && delay <= 31000, `a live game re-arms in ~30 s, not ${delay} ms`);
  assert.equal(mock.alarms.get('zeitnot:watchdog').periodInMinutes, 5);
});

test('a second sync inside 8 s learns nothing new, so it makes no requests', async () => {
  reset();
  await bg.sync({ force: true });
  const calls = log.length;
  await bg.sync(); // the alarm path
  assert.equal(log.length, calls);
  await bg.sync({ force: true });
  assert(log.length > calls, 'force still goes to the network');
});

test('simultaneous requests share one sync', async () => {
  reset();
  await Promise.all([bg.sync({ force: true }), bg.sync({ force: true }), bg.sync({ force: true })]);
  assert.equal(log.filter((u) => u === 'broadcast/qfkdt8mn').length, 1);
});

test('popup messages: sync, and a round that is not the focus', async () => {
  reset();
  const synced = await chrome.runtime.sendMessage({ type: MSG_SYNC, force: true });
  assert.equal(synced.ok, true);
  routes['broadcast/round/xLgOJ6cb.pgn'] = fixtureText('game1-finished.pgn');
  const res = await chrome.runtime.sendMessage({ type: MSG_ROUND, roundId: 'xLgOJ6cb' });
  assert.equal(res.ok, true);
  assert.equal(res.detail.moves.length, 76);
  assert(mock.store[DETAILS_KEY]['xLgOJ6cb'], 'it is kept for next time and for the storage listener');
  const bad = await chrome.runtime.sendMessage({ type: MSG_ROUND, roundId: 'nope' });
  assert.equal(bad.ok, false);
  assert.equal(await chrome.runtime.sendMessage({ type: 'something-else' }), undefined, 'unknown messages are ignored (the 1.x popup still sends some)');
});

function fixtureText(name) {
  return fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}
import fs from 'node:fs';

test('a failed sync keeps the last good snapshot, counts the failure and backs off', async () => {
  reset();
  await bg.sync({ force: true });
  const good = mock.store[SNAPSHOT_KEY];
  routes = { 'broadcast/qfkdt8mn': { status: 503, body: 'down' } };
  const out = await bg.sync({ force: true });
  assert.equal(out.ok, false);
  assert.match(out.error, /HTTP 503/);
  assert.deepEqual(mock.store[SNAPSHOT_KEY], good);
  assert.equal(mock.store[META_KEY].failures, 1);
  assert.match(mock.store[META_KEY].lastError, /503/);
  let delay = mock.alarms.get('zeitnot:sync').when - Date.now();
  assert(delay > 55000 && delay <= 61000, `first backoff is a minute, got ${delay}`);
  await bg.sync({ force: true });
  delay = mock.alarms.get('zeitnot:sync').when - Date.now();
  assert(delay > 115000 && delay <= 121000, 'then two');
  routes = liveRoutes();
  await bg.sync({ force: true });
  assert.equal(mock.store[META_KEY].failures, 0, 'a good sync clears it');
  assert.equal(mock.store[META_KEY].lastError, null);
});

test('changing a setting repaints the badge straight away', async () => {
  reset();
  await bg.sync({ force: true });
  assert.equal(mock.badge.text, '+0.1');
  await chrome.storage.local.set({ [SETTINGS_KEY]: { spoilerShield: true } });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(mock.badge.text, 'LIVE');
  await chrome.storage.local.set({ [SETTINGS_KEY]: { badge: 'odds', follow: 'sindarov' } });
  await new Promise((r) => setTimeout(r, 10));
  assert.match(mock.badge.text, /^\d+%$/);
});

test('notifications are created for a finished game when switched on, and clicking one opens Lichess', async () => {
  reset();
  await chrome.storage.local.set({ [SETTINGS_KEY]: { notify: { result: true } } });
  await bg.sync({ force: true }); // Game 2 is live, Game 1 is old news
  assert.equal(mock.created.length, 0);
  // Game 2 ends
  const tour = fixtureJson('tour.json');
  delete tour.rounds[1].ongoing;
  tour.rounds[1].finished = true;
  tour.rounds[1].finishedAt = Date.now();
  routes = liveRoutes({
    'broadcast/qfkdt8mn': { body: tour },
    'broadcast/round/L3j03TZq.pgn': fixtureText('round-live.pgn').replace('[Result "*"]', '[Result "1/2-1/2"]').replace(/ \*\s*$/, ' 1/2-1/2\n'),
  });
  await bg.sync({ force: true });
  assert.equal(mock.created.length, 1);
  assert.equal(mock.created[0].title, 'Game 2: ½–½');
  assert.match(mock.created[0].id, /^result:L3j03TZq\|https:\/\/lichess\.org\//);
  await mock.events.notificationClicked.fire(mock.created[0].id);
  assert.match(mock.tabs[0].url, /^https:\/\/lichess\.org\/broadcast\//);
  await bg.sync({ force: true });
  assert.equal(mock.created.length, 1, 'never announced twice');
  await mock.events.notificationClicked.fire('x|https://evil.example/');
  assert.equal(mock.tabs.length, 1, 'only lichess.org links are opened');
});

test('the watchdog restarts the chain if the main alarm vanished', async () => {
  reset();
  await bg.sync({ force: true });
  mock.alarms.delete('zeitnot:sync');
  await mock.events.alarm.fire({ name: 'zeitnot:watchdog' });
  assert(mock.alarms.has('zeitnot:sync'));
});

// Last: it leaves the service worker's in-memory rate-limit cool-down switched on.
test('HTTP 429 is respected: no more requests until the cool-down is over', async () => {
  reset();
  routes = { 'broadcast/qfkdt8mn': { status: 429, body: 'slow', headers: { 'retry-after': '120' } } };
  await bg.sync({ force: true });
  const delay = mock.alarms.get('zeitnot:sync').when - Date.now();
  assert(delay >= 119000, `waits out the Retry-After, got ${delay}`);
  assert(mock.store[META_KEY].blockedUntil > Date.now() + 100000);
  const before = log.length;
  const again = await bg.sync({ force: true });
  assert.equal(again.ok, false);
  assert(again.blockedMs > 100000);
  assert.equal(log.length, before, 'a forced sync (the popup\'s Sync button) does not override the cool-down either');
});

