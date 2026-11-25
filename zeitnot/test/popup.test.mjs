import test from 'node:test';
import assert from 'node:assert/strict';

import { bootPopup } from './popup-env.mjs';
import { fixture, liveRoutes } from './helpers.mjs';
import { SETTINGS_KEY } from '../shared/settings.js';
import { formatClockSeconds, tryParseClockSeconds } from '../shared/format.js';

const env = await bootPopup({
  routes: liveRoutes({ 'broadcast/round/xLgOJ6cb.pgn': fixture('game1-finished.pgn') }),
  chromeOptions: { withNotifications: true },
});
const { $, click, key, until, settle, tick, mock } = env;
const text = (id) => $(id).textContent;
const settings = () => mock.store[SETTINGS_KEY] || {};

test('it loads: players, score, 14 games and the live game, from the service worker\'s first sync', async () => {
  await until(() => !$('emptyCard').hidden === false && text('nameA') === 'Gukesh');
  assert.equal(text('nameA'), 'Gukesh');
  assert.equal(text('nameB'), 'Sindarov');
  assert.equal(text('metaA'), '2710');
  assert.equal(text('metaB'), '2782');
  assert.match($('metaA').getAttribute('title'), /Gukesh D · IND · rated 2710/);
  assert.equal(text('scoreA'), '½');
  assert.equal(text('scoreB'), '½');
  assert.equal(text('eventSub'), 'World Championship 2026 · Geneva');
  assert.equal(text('scoreSub'), '13 games left');
  assert.equal($('scoreSub').getAttribute('title'), 'First to 7½ wins the match');
  assert.match(text('oddsNote'), /^first to 7½ · \d+% chance of a 7–7 tiebreak$/);
  assert.equal(text('pulseText'), 'LIVE · G2');
  assert.equal($('statusPill').disabled, false, 'the LIVE pill jumps to the live game');
  const odds = [parseInt(text('oddsA'), 10), parseInt(text('oddsB'), 10)];
  assert.equal(odds[0] + odds[1], 100);
  assert($('photoA').getAttribute('src').startsWith('https://image.lichess.org/'));
});

test('the strip shows every game: result colours, the live one marked, the shown one current', () => {
  const cells = [...$('roundStrip').children];
  assert.equal(cells.length, 14);
  assert(cells[0].classList.contains('is-draw'));
  assert.equal(cells[0].querySelector('small').textContent, '½');
  assert(cells[1].classList.contains('is-live'));
  assert.equal(cells[1].getAttribute('aria-current'), 'true');
  assert(cells[2].classList.contains('is-upcoming'));
  assert.equal(cells[0].getAttribute('aria-label'), 'Game 1, draw');
  assert.equal(cells[1].getAttribute('aria-label'), 'Game 2, live now');
});

test('the live game: clocks tick from the right sample, only the running clock can be edited', () => {
  assert.equal(text('gameName'), 'Game 2');
  assert.match(text('gameState'), /^LIVE · move 8$/);
  const white = tryParseClockSeconds($('clockA').value); // Gukesh has White and is to move
  const black = tryParseClockSeconds($('clockB').value);
  assert.equal(black, 6858, 'Black\'s clock is as of the last move');
  assert(white <= 7091 - 322 && white >= 7091 - 322 - 60, `White's clock ${white} has run down from 6769`);
  assert.equal($('clockA').readOnly, false);
  assert.equal($('clockB').readOnly, true);
  assert(!$('turnA').classList.contains('is-off') && $('turnA').classList.contains('is-on'));
  assert(!$('turnB').classList.contains('is-on'));
  assert(!$('swatchA').classList.contains('is-black'), 'Gukesh has White');
  assert($('swatchB').classList.contains('is-black'));
  assert.equal(text('evalChip'), 'Eval +0.11');
  assert.match(text('tcText'), /^33 moves to move 40 · no increment$/);
});

test('odds by player, three numbers that add up, and the stakes of the game', () => {
  const [a, d, b] = ['pA', 'pD', 'pB'].map((id) => parseInt(text(id), 10));
  assert(Math.abs(a + d + b - 100) <= 1);
  assert(d > a && d > b, 'an even-ish game between GMs is mostly a draw');
  assert.equal(text('lA'), 'Gukesh');
  assert.equal(text('lB'), 'Sindarov');
  assert.equal($('stakes').hidden, false);
  const [sa, sd, sb] = ['stakeA', 'stakeD', 'stakeB'].map((id) => parseInt(text(id), 10));
  assert(sa > sd && sd > sb, 'the more Gukesh wins, the better his title odds');
  assert.equal(text('stakesTitle'), "Gukesh's title odds if…");
});

test('there are no evals in the live PGN, so it opens on the clocks chart and says so', () => {
  assert.equal($('tabClock').getAttribute('aria-selected'), 'true');
  assert.notEqual($('clockLineA').getAttribute('d'), '');
  assert.notEqual($('clockLineB').getAttribute('d'), '');
  // SVG nodes have no `hidden` property in a real browser, so it is the attribute the stylesheet matches.
  assert.equal($('clockLineA').hasAttribute('hidden'), false);
  assert.equal($('chartLine').hasAttribute('hidden'), true);
  assert.match(text('chartCaption'), /^Queen's Pawn Game: London System · last 7\.\.\. Qb6$/);
  // switching to the eval chart explains why it is empty
  click($('tabEval'));
  return env.settle().then(() => {
    assert.equal($('tabEval').getAttribute('aria-selected'), 'true');
    assert.equal($('chartEmpty').hidden, false);
    assert.match(text('chartEmpty'), /No engine evals/);
    click($('tabClock'));
  });
});

test('Game 1 (finished): evals appear, result is shown, clocks are frozen, no stakes', async () => {
  click($('roundStrip').children[0]);
  await until(() => text('gameName') === 'Game 1' && text('gameState').startsWith('FINAL'));
  assert.equal(text('gameState'), 'FINAL ½–½');
  assert.equal($('tabClock').getAttribute('aria-selected'), 'true', 'a tab you chose stays chosen when you change game');
  click($('tabEval'));
  await settle();
  assert.equal($('tabEval').getAttribute('aria-selected'), 'true');
  assert.match($('chartLine').getAttribute('d'), /^M/);
  assert.equal($('chartEmpty').hidden, true);
  assert.equal($('stakes').hidden, true);
  assert.equal($('clockA').readOnly, true);
  assert.equal($('clockA').value, '0:06:32', 'Gukesh had Black in Game 1: 0:06:32 left');
  assert.equal($('clockB').value, '0:15:51');
  assert.equal(text('vsLabel'), 'final');
  assert.equal(text('pD'), '100%');
  assert.match(text('tcText'), /^Finished after 38 moves/);
  assert.equal($('roundStrip').children[0].getAttribute('aria-current'), 'true');
  assert.equal($('roundStrip').children[1].getAttribute('aria-current'), null);
});

test('arrow keys move between games and L jumps back to the live one', async () => {
  key('ArrowRight');
  await until(() => text('gameName') === 'Game 2');
  key('ArrowRight');
  await until(() => text('gameName') === 'Game 3');
  assert.match(text('gameState'), /^(Today|Tomorrow|[A-Z][a-z]{2} \d+,)/, 'an upcoming game shows its start time');
  assert.match(text('tcText'), /^Starts in /);
  assert.equal($('clockA').value, '2:00:00');
  assert.equal($('chartWrap').hidden, true, 'no chart before the first move');
  assert.equal($('stakes').hidden, false);
  key('l');
  await until(() => text('gameName') === 'Game 2');
  click($('roundStrip').children[2]);
  await until(() => text('gameName') === 'Game 3');
  click($('statusPill'));
  await until(() => text('gameName') === 'Game 2');
});

test('following a player re-centres the stakes on them and is saved', async () => {
  click($('followB'));
  await until(() => $('followB').getAttribute('aria-pressed') === 'true');
  assert.equal(settings().follow, 'sindarov');
  assert.equal(text('stakesTitle'), "Sindarov's title odds if…");
  const [sa, sd, sb] = ['stakeA', 'stakeD', 'stakeB'].map((id) => parseInt(text(id), 10));
  assert(sb > sd && sd > sa, 'for Sindarov, his win is the best result');
  assert.equal(mock.badge.title.includes('for Sindarov'), true, 'the badge is now from his side');
  click($('followB'));
  await until(() => $('followB').getAttribute('aria-pressed') === 'false');
  assert.equal(settings().follow, 'none');
});

test('calibrating the running clock sets a stream delay that is saved, shown, and clearable', async () => {
  const running = tryParseClockSeconds($('clockA').value);
  $('clockA').focus();
  $('clockA').value = formatClockSeconds(running + 12);
  $('clockA').blur();
  await until(() => settings().streamDelaySec > 0);
  assert(Math.abs(settings().streamDelaySec - 12) <= 2, `delay ${settings().streamDelaySec}`);
  await until(() => !$('delayChip').hidden);
  assert.match(text('delayChip'), /^Stream \+1[0-4]s ✕$/);
  assert.match(text('statusBar'), /Stream delay set to 1\d s/);
  click($('delayChip'));
  await until(() => settings().streamDelaySec === 0);
  assert.equal($('delayChip').hidden, true);
});

test('a bad clock entry is rejected without touching the delay', async () => {
  const before = settings().streamDelaySec || 0;
  $('clockA').focus();
  $('clockA').value = 'banana';
  $('clockA').blur();
  await until(() => /not a clock time/.test(text('statusBar')));
  assert.equal(settings().streamDelaySec || 0, before);
  $('clockA').focus();
  $('clockA').value = formatClockSeconds(tryParseClockSeconds($('clockA').value) + 900);
  $('clockA').blur();
  await until(() => /more than 5 minutes behind/.test(text('statusBar')));
  assert.equal(settings().streamDelaySec || 0, before);
  await settle();
  assert.match($('clockA').value, /^\d:\d\d:\d\d$/, 'the real clock is back');
});

test('settings: badge mode, delay stepper and notifications (asking Chrome first)', async () => {
  click($('settingsBtn'));
  await settle();
  assert.equal($('settingsPanel').hidden, false);
  assert.equal($('settingsBtn').getAttribute('aria-expanded'), 'true');
  const badgeButtons = [...$('badgeControl').children];
  click(badgeButtons.find((b) => b.dataset.value === 'odds'));
  await until(() => settings().badge === 'odds');
  assert.equal(badgeButtons.find((b) => b.dataset.value === 'odds').getAttribute('aria-checked'), 'true');
  assert.match(mock.badge.text, /^\d+%$/, 'the badge followed the setting at once');

  click($('delayPlus'));
  click($('delayPlus'));
  await until(() => settings().streamDelaySec === 10);
  assert.equal(text('delayValue'), '10 s');
  click($('delayMinus'));
  await until(() => settings().streamDelaySec === 5);

  $('notifySoon').checked = true;
  $('notifySoon').dispatchEvent(new env.window.Event('change', { bubbles: true }));
  await until(() => settings().notify && settings().notify.soon === true);

  mock.chrome.permissions.request = async () => false;
  $('notifyResult').checked = true;
  $('notifyResult').dispatchEvent(new env.window.Event('change', { bubbles: true }));
  await settle();
  assert.equal($('notifyResult').checked, false, 'reverted when Chrome says no');
  assert.equal($('notifyNote').hidden, false);
  assert.notEqual(settings().notify && settings().notify.result, true);

  key('Escape');
  await settle();
  assert.equal($('settingsPanel').hidden, true);
});

test('spoiler shield: no score, odds, result or eval anywhere in the DOM until revealed', async () => {
  click($('settingsBtn'));
  $('shieldSwitch').checked = true;
  $('shieldSwitch').dispatchEvent(new env.window.Event('change', { bubbles: true }));
  await until(() => settings().spoilerShield === true);
  click($('settingsClose'));
  await settle();
  assert(env.document.body.classList.contains('shielded'));
  assert.equal($('shieldBanner').hidden, false);
  for (const id of ['scoreA', 'scoreB', 'oddsA', 'oddsB', 'pA', 'pD', 'pB', 'stakeA', 'stakeD', 'stakeB']) assert.equal(text(id), '·', id);
  assert.equal($('evalChip').hidden, true);
  const cell1 = $('roundStrip').children[0];
  assert(!cell1.classList.contains('is-draw'));
  assert.equal(cell1.querySelector('small').textContent, '');
  assert.equal(cell1.getAttribute('aria-label'), 'Game 1, finished');
  assert.doesNotMatch(text('scoreSub'), /wins the match/);
  assert.equal(mock.badge.text, 'LIVE');

  click($('shieldToggle'));
  await settle();
  assert(!env.document.body.classList.contains('shielded'));
  assert.equal(text('scoreA'), '½');
  assert.match(text('pA'), /^\d+%$/);
  click($('shieldToggle'));
  await settle();
  assert(env.document.body.classList.contains('shielded'), 'and it can be put back up');
  // finished games under the shield do not reveal their result
  click($('roundStrip').children[0]);
  await until(() => text('gameName') === 'Game 1');
  assert.equal(text('gameState'), 'FINISHED');
  click($('settingsBtn'));
  $('shieldSwitch').checked = false;
  $('shieldSwitch').dispatchEvent(new env.window.Event('change', { bubbles: true }));
  await until(() => settings().spoilerShield === false);
  click($('settingsClose'));
  await settle();
  assert.equal(text('gameState'), 'FINAL ½–½');
});

test('the Sync button asks the worker, which refuses to hammer Lichess inside its 8 s window unless forced', async () => {
  const before = env.log.length;
  click($('refreshBtn'));
  await until(() => $('refreshLabel').textContent === 'Sync' && env.log.length > before);
  assert(env.log.some((u) => u === 'broadcast/qfkdt8mn'));
});

test('the copy button puts a plain-text summary on the clipboard, and refuses while spoilers are hidden', async () => {
  click($('roundStrip').children[1]);
  await until(() => text('gameName') === 'Game 2');
  click($('copyBtn'));
  await until(() => env.clipboard.length === 1);
  const lines = env.clipboard[0].split('\n');
  assert.equal(lines[0], 'Zeitnot · FIDE World Chess Championship 2026');
  assert.equal(lines[1], 'Gukesh ½–½ Sindarov (first to 7½)');
  assert.match(lines[2], /^Game 2 live · move 8 · Gukesh \d:\d\d:\d\d · Sindarov 1:54:18 · eval \+0\.11$/);
  assert.match(lines[3], /^Title odds: Gukesh \d+% \/ Sindarov \d+%$/);
  assert.equal(text('statusBar'), 'Summary copied');
});

test('the ticker keeps clocks moving without any network traffic', async () => {
  const before = env.log.length;
  const t0 = tryParseClockSeconds($('clockA').value);
  tick();
  tick();
  assert.equal(env.log.length, before);
  assert(tryParseClockSeconds($('clockA').value) <= t0);
});

