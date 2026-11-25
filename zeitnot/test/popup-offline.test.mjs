import test from 'node:test';
import assert from 'node:assert/strict';

import { bootPopup } from './popup-env.mjs';
import { liveRoutes } from './helpers.mjs';

const down = { 'broadcast/qfkdt8mn': { status: 503, body: 'down' } };
const env = await bootPopup({ routes: down });
const { $, click, until, settle } = env;
const text = (id) => $(id).textContent;

test('with no saved data and no connection: an honest empty state and a retry', async () => {
  await until(() => text('emptyTitle') === "Can't reach the broadcast" && text('statusBar') === 'Offline' && text('refreshLabel') === 'Sync');
  assert.equal($('emptyCard').hidden, false);
  assert.equal($('emptyRetry').hidden, false);
  assert.equal(document.querySelector('.board-card').hidden, true);
  assert.equal($('gameCard').hidden, true);
  assert.equal(text('pulseText'), 'OFFLINE');
});

test('when Lichess is back, Try again loads everything', async () => {
  env.routes = liveRoutes();
  await new Promise((r) => setTimeout(r, 10));
  // The worker's cool-down after a failure is a backoff on the schedule, not a block on a manual retry.
  click($('emptyRetry'));
  await until(() => $('emptyCard').hidden === true && text('pulseText') === 'LIVE · G2');
  assert.equal($('emptyCard').hidden, true);
  assert.equal($('gameCard').hidden, false);
  assert.match(text('statusBar'), /^Updated (just now|\d+s ago)$/);
  assert.equal(text('pulseText'), 'LIVE · G2');
});

test('if the connection drops later, the saved data stays on screen and the footer says so', async () => {
  env.routes = down;
  click($('refreshBtn'));
  await until(() => /^Offline · showing data from/.test(text('statusBar')));
  assert.equal($('statusBar').classList.contains('is-error'), true);
  assert.equal(text('nameA'), 'Gukesh');
  assert.equal($('gameCard').hidden, false);
  assert.equal(text('pulseText'), 'LIVE · G2', 'not marked offline until the data is a couple of minutes old');
  env.routes = liveRoutes();
  click($('refreshBtn'));
  await until(() => /^Updated/.test(text('statusBar')));
  assert.equal($('statusBar').classList.contains('is-error'), false);
});
