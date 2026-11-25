// Zeitnot popup. It never talks to Lichess: it reads what the service worker saved, asks it to sync, and redraws.
// A clock on screen is "the stored sample minus the time since", so nothing here has to be kept in step with anything.

import {
  DEFAULT_META, DETAILS_KEY, META_KEY, MSG_ROUND, MSG_SYNC, SNAPSHOT_KEY, SNAPSHOT_VERSION,
} from '../shared/keys.js';
import {
  DEFAULT_SETTINGS, MAX_STREAM_DELAY_SEC, SETTINGS_KEY, normalizeSettings, saveSettings,
} from '../shared/settings.js';
import { EVENT } from '../shared/event.js';
import { clocksNow, deriveGame, matchOdds, pregameFor, stakesFor, titleOddsFor } from '../shared/live.js';
import { chartModel, nearestPly } from '../shared/chart.js';
import {
  formatAgo, formatClockSeconds, formatCountdown, formatCountdownShort, formatEval, formatPoints, formatResult,
  formatStartTime, tryParseClockSeconds,
} from '../shared/format.js';
import { shortOpening } from '../shared/pgn.js';
import { summaryText } from '../shared/summary.js';

const $ = (id) => document.getElementById(id);
const IDS = [
  'announcer', 'eventSub', 'statusPill', 'pulseText', 'settingsBtn', 'shieldBanner', 'shieldText', 'shieldToggle',
  'followA', 'followB', 'photoA', 'photoB', 'initialsA', 'initialsB', 'nameA', 'nameB', 'metaA', 'metaB',
  'scoreNums', 'scoreA', 'scoreB', 'scoreSub', 'race', 'raceA', 'raceB', 'odds', 'oddsA', 'oddsB', 'oddsTitle', 'oddsBar',
  'oddsSegA', 'oddsSegB', 'oddsNote', 'roundStrip', 'gameCard', 'gameName', 'gameState', 'evalChip', 'wdl',
  'wdlBar', 'segA', 'segD', 'segB', 'pA', 'pD', 'pB', 'lA', 'lB', 'evalNote', 'sideA', 'sideB', 'swatchA', 'swatchB',
  'csNameA', 'csNameB', 'turnA', 'turnB', 'clockA', 'clockB', 'vsLabel', 'deltaChip', 'tcStrip', 'tcText',
  'delayChip', 'chartWrap', 'tabEval', 'tabClock', 'chartLegend', 'chartBox', 'chart', 'chartMid', 'chartMarker', 'chartArea',
  'chartLine', 'clockLineA', 'clockLineB', 'axisTop', 'axisBottom', 'chartCursor', 'chartDot', 'chartEmpty', 'chartCaption', 'stakes', 'stakesTitle',
  'stakeLblA', 'stakeA', 'stakeD', 'stakeLblB', 'stakeB', 'emptyCard', 'emptyTitle', 'emptyText', 'emptyRetry', 'refreshBtn',
  'refreshLabel', 'statusBar', 'copyBtn', 'lichessLink', 'settingsPanel', 'settingsClose', 'followControl', 'badgeControl',
  'shieldSwitch', 'delayMinus', 'delayPlus', 'delayValue', 'notifySoon', 'notifyResult', 'notifyZeitnot', 'notifyNote',
  'aboutText',
];
const el = Object.fromEntries(IDS.map((id) => [id, $(id)]));

const CHART_W = 332;
const CHART_H = 60;
const state = {
  snapshot: null,
  details: {},
  meta: { ...DEFAULT_META },
  settings: { ...DEFAULT_SETTINGS },
  selectedId: null,
  picked: false, // the user chose a game; otherwise we follow the live/focus game
  chartMode: null, // 'eval' | 'clock' | null = whichever has data
  revealed: false, // spoiler shield lifted for this popup session
  syncing: false,
  syncError: null,
  lastRequestAt: 0,
  hoverPly: null,
  editing: null, // 'a' | 'b' while a clock is being calibrated
  flash: null, // transient status-bar message { text, until }
};
const last = { announce: null, chartKey: '', stripKey: '' };
const cache = new Map(); // element -> last value written, so unchanged text costs nothing

function setText(node, text) {
  const v = String(text);
  if (cache.get(node) === v) return;
  cache.set(node, v);
  node.textContent = v;
}
function setAttr(node, name, value) {
  const key = `${name}`;
  const map = setAttr.map || (setAttr.map = new WeakMap());
  const seen = map.get(node) || {};
  if (seen[key] === value) return;
  seen[key] = value;
  map.set(node, seen);
  if (value === null || value === false) node.removeAttribute(name);
  else node.setAttribute(name, value === true ? '' : value);
}
function setClass(node, name, on) {
  node.classList.toggle(name, Boolean(on));
}
/** `hidden` is an HTML-only property: on SVG elements the attribute (which the stylesheet matches) has to be set. */
function setHidden(node, on) {
  if (on) node.setAttribute('hidden', '');
  else node.removeAttribute('hidden');
}

// ---------- storage ----------

function applyStored(got) {
  const snap = got[SNAPSHOT_KEY];
  state.snapshot = snap && snap.v === SNAPSHOT_VERSION ? snap : null;
  state.details = got[DETAILS_KEY] || {};
  state.meta = { ...DEFAULT_META, ...(got[META_KEY] || {}) };
  state.settings = normalizeSettings(got[SETTINGS_KEY]);
}

async function loadState() {
  applyStored(await chrome.storage.local.get([SNAPSHOT_KEY, DETAILS_KEY, META_KEY, SETTINGS_KEY]));
}

let paintQueued = false;
function schedulePaint() {
  if (paintQueued) return;
  paintQueued = true;
  queueMicrotask(() => {
    paintQueued = false;
    paint();
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  let touched = false;
  if (changes[SNAPSHOT_KEY]) {
    const snap = changes[SNAPSHOT_KEY].newValue;
    state.snapshot = snap && snap.v === SNAPSHOT_VERSION ? snap : null;
    touched = true;
  }
  if (changes[DETAILS_KEY]) {
    state.details = changes[DETAILS_KEY].newValue || {};
    touched = true;
  }
  if (changes[META_KEY]) {
    state.meta = { ...DEFAULT_META, ...(changes[META_KEY].newValue || {}) };
    touched = true;
  }
  if (changes[SETTINGS_KEY]) {
    state.settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
    touched = true;
  }
  if (touched) schedulePaint();
});

// ---------- sync ----------

async function requestSync(force) {
  if (state.syncing) return;
  state.syncing = true;
  state.lastRequestAt = Date.now();
  paintFooter();
  try {
    const res = await chrome.runtime.sendMessage({ type: MSG_SYNC, force });
    state.syncError = res && res.ok === false ? res.error || 'Could not reach Lichess' : null;
  } catch (err) {
    state.syncError = String((err && err.message) || err);
  } finally {
    state.syncing = false;
    await loadState();
    paint();
  }
}

async function requestRound(roundId) {
  try {
    const res = await chrome.runtime.sendMessage({ type: MSG_ROUND, roundId });
    if (res && res.ok && res.detail) state.details = { ...state.details, [roundId]: res.detail };
  } catch {
    // The saved copy, if any, stays on screen.
  }
  schedulePaint();
}

/** While the popup is open: every 15 s during a game, every minute in the hour before one. The worker coalesces. */
function wantedRefreshMs() {
  const s = state.snapshot;
  if (!s) return 5000;
  if (s.liveRoundId) return 15000;
  const next = s.rounds.find((r) => r.id === s.nextRoundId);
  if (next && next.startsAt && next.startsAt - Date.now() < 70 * 60 * 1000) return 60000;
  return Infinity;
}

// ---------- selection ----------

function selectedId() {
  const s = state.snapshot;
  if (!s) return null;
  if (state.picked && s.rounds.some((r) => r.id === state.selectedId)) return state.selectedId;
  return s.focusRoundId;
}

function pickRound(id) {
  const s = state.snapshot;
  if (!s || !s.rounds.some((r) => r.id === id)) return;
  state.picked = true;
  state.selectedId = id;
  state.hoverPly = null;
  const round = s.rounds.find((r) => r.id === id);
  if (round.status !== 'LIVE' && id !== s.focusRoundId) requestRound(id);
  schedulePaint();
}

function stepRound(delta) {
  const s = state.snapshot;
  if (!s) return;
  const idx = s.rounds.findIndex((r) => r.id === selectedId());
  const next = s.rounds[Math.max(0, Math.min(s.rounds.length - 1, idx + delta))];
  if (next) pickRound(next.id);
}

// ---------- view helpers ----------

const spoilNow = () => state.settings.spoilerShield && !state.revealed;
const playerOf = (key) => state.snapshot.players.find((p) => p.key === key);
const colorVar = (key) => (key === state.snapshot.players[0].key ? 'var(--pa)' : 'var(--pb)');

function winnerKeyOf(round) {
  if (round.result === '1-0') return round.whiteKey;
  if (round.result === '0-1') return state.snapshot.players.find((p) => p.key !== round.whiteKey)?.key || null;
  return null;
}

function liveDetail() {
  const s = state.snapshot;
  const d = s && s.liveRoundId ? state.details[s.liveRoundId] : null;
  return d && d.status === 'LIVE' ? d : null;
}

/** Title odds right now: the live game's odds move every second with its clocks. */
function currentOdds() {
  const s = state.snapshot;
  const live = liveDetail();
  const odds = live ? matchOdds(s, live.n, deriveGame(s, live, Date.now()).probs) : matchOdds(s);
  const decided = s.score.a >= s.score.target || s.score.b >= s.score.target;
  return { ...odds, decided, winnerKey: !decided ? null : s.score.a >= s.score.target ? s.players[0].key : s.players[1].key };
}

function flashStatus(text, ms = 2500) {
  state.flash = { text, until: Date.now() + ms };
  paintFooter();
  setTimeout(() => { if (state.flash && state.flash.until <= Date.now()) paintFooter(); }, ms + 50);
}

// ---------- paint ----------

function paint() {
  const s = state.snapshot;
  const spoil = spoilNow();
  document.body.classList.toggle('shielded', spoil);
  setClass(el.settingsPanel, 'is-open', state.settingsOpen);
  el.settingsPanel.hidden = !state.settingsOpen;
  el.settingsBtn.setAttribute('aria-expanded', String(state.settingsOpen));

  const empty = !s;
  el.emptyCard.hidden = !empty;
  for (const node of [el.gameCard, el.roundStrip, document.querySelector('.board-card')]) node.hidden = empty;
  if (empty) {
    paintEmpty();
    paintHeader();
    paintFooter();
    paintSettings();
    return;
  }
  paintHeader();
  paintShield();
  paintScoreboard(spoil);
  paintStrip(spoil);
  paintGame(spoil);
  paintFooter();
  if (state.settingsOpen) paintSettings();
  announceChanges(spoil);
}

function paintEmpty() {
  const failed = state.syncError || state.meta.lastError;
  setText(el.emptyTitle, failed ? "Can't reach the broadcast" : 'Loading the match…');
  setText(el.emptyText, failed ? 'Zeitnot reads the Lichess broadcast. Check your connection, then try again.' : 'Getting the latest from the Lichess broadcast.');
  el.emptyRetry.hidden = !failed;
}

function paintHeader() {
  const s = state.snapshot;
  const now = Date.now();
  if (!s) {
    setText(el.eventSub, 'World Championship');
    setText(el.pulseText, state.syncError || state.meta.lastError ? 'OFFLINE' : 'SYNCING');
    el.statusPill.className = `status-pill ${state.syncError || state.meta.lastError ? 'is-offline' : 'is-idle'}`;
    el.statusPill.disabled = true;
    return;
  }
  const city = (s.event.location || '').split(',')[0].trim();
  const title = (s.event.name || '').replace(/^FIDE\s+/i, '').replace(/\bChess\s+/i, '');
  setText(el.eventSub, city ? `${title} · ${city}` : title);

  const stale = state.meta.lastError && now - s.fetchedAt > 120000;
  let cls = 'is-idle';
  let text;
  const live = s.liveRoundId ? s.rounds.find((r) => r.id === s.liveRoundId) : null;
  const next = s.rounds.find((r) => r.id === s.nextRoundId);
  if (stale) {
    cls = 'is-offline';
    text = 'OFFLINE';
  } else if (live) {
    cls = 'is-live';
    text = `LIVE · G${live.n}`;
  } else if (s.odds && s.odds.decided && !spoilNow()) {
    cls = 'is-final';
    text = 'FINAL';
  } else if (next && next.startsAt) {
    const ms = next.startsAt - now;
    cls = ms <= 3 * 3600 * 1000 ? 'is-soon' : 'is-idle';
    text = ms > 0 ? `NEXT · ${ms < 3600000 ? formatCountdown(ms).replace(/^(\d+m) 0?(\d+s)$/, '$1 $2') : formatCountdownShort(ms)}` : 'STARTING';
  } else {
    text = 'BREAK';
  }
  el.statusPill.className = `status-pill ${cls}`;
  setText(el.pulseText, text);
  el.statusPill.disabled = cls !== 'is-live';
  setAttr(el.statusPill, 'title', cls === 'is-live' ? 'Jump to the live game' : null);
  el.lichessLink.href = (state.details[selectedId()] && state.details[selectedId()].url) || s.event.url;
}

function paintShield() {
  const on = state.settings.spoilerShield;
  el.shieldBanner.hidden = !on;
  if (!on) return;
  setText(el.shieldText, state.revealed ? 'Spoilers are showing' : 'Spoiler shield is on');
  setText(el.shieldToggle, state.revealed ? 'Hide' : 'Reveal');
}

function initialsOf(p) {
  return p.name.slice(0, 1).toUpperCase();
}

function paintScoreboard(spoil) {
  const s = state.snapshot;
  const [a, b] = s.players;
  for (const [side, p] of [['A', a], ['B', b]]) {
    setText(el[`name${side}`], p.name);
    setText(el[`meta${side}`], p.elo);
    setAttr(el[`meta${side}`], 'title', [p.title, p.fullName, p.fed, p.elo ? `rated ${p.elo}` : ''].filter(Boolean).join(' · '));
    setText(el[`initials${side}`], initialsOf(p));
    const img = el[`photo${side}`];
    if (p.photo) {
      if (img.getAttribute('src') !== p.photo) img.setAttribute('src', p.photo);
    } else {
      img.hidden = true;
    }
    const following = state.settings.follow === p.key;
    setAttr(el[`follow${side}`], 'aria-pressed', String(following));
    setAttr(el[`follow${side}`], 'aria-label', `${following ? 'Stop following' : 'Follow'} ${p.name}`);
    setAttr(el[`follow${side}`], 'title', following ? `Following ${p.name}` : `Follow ${p.name}: the badge and alerts are about them`);
  }

  const decided = s.score.a >= s.score.target || s.score.b >= s.score.target;
  setText(el.scoreA, spoil ? '·' : formatPoints(s.score.a));
  setText(el.scoreB, spoil ? '·' : formatPoints(s.score.b));
  setAttr(el.scoreNums, 'aria-label', spoil ? 'Score hidden' : `${a.name} ${formatPoints(s.score.a)}, ${b.name} ${formatPoints(s.score.b)}`);
  const left = s.dp.unplayed.length;
  setText(el.scoreSub, decided && !spoil
    ? `${(s.score.a >= s.score.target ? a : b).name} wins`
    : `${left} game${left === 1 ? '' : 's'} left`);
  setAttr(el.scoreSub, 'title', `First to ${formatPoints(s.score.target)} wins the match`);

  const half = (pts) => `${Math.min(100, (pts / s.score.target) * 100)}%`;
  el.raceA.style.width = spoil ? '0%' : half(s.score.a);
  el.raceB.style.width = spoil ? '0%' : half(s.score.b);

  const odds = currentOdds();
  const pa = Math.round(odds.a * 100);
  const pb = 100 - pa;
  setText(el.oddsA, spoil ? '·' : `${pa}%`);
  setText(el.oddsB, spoil ? '·' : `${pb}%`);
  el.oddsSegA.style.width = spoil ? '50%' : `${odds.a * 100}%`;
  el.oddsSegB.style.width = spoil ? '50%' : `${odds.b * 100}%`;
  setText(el.oddsTitle, decided ? 'Match decided' : 'Title odds');
  setText(el.oddsNote, decided ? '' : `first to ${formatPoints(s.score.target)} · ${odds.tiebreak > 0.005 ? `${Math.round(odds.tiebreak * 100)}% chance of a 7–7 tiebreak` : '7–7 goes to a tiebreak'}`);
  setAttr(el.oddsBar, 'aria-label', spoil ? 'Title odds hidden' : `Title odds: ${a.name} ${pa}%, ${b.name} ${pb}%`);
}

function paintStrip(spoil) {
  const s = state.snapshot;
  const key = s.rounds.map((r) => r.id).join();
  if (key !== last.stripKey) {
    last.stripKey = key;
    el.roundStrip.replaceChildren(
      ...s.rounds.map((r) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cell';
        btn.dataset.id = r.id;
        btn.innerHTML = '<span></span><small></small>';
        return btn;
      })
    );
  }
  const cur = selectedId();
  let tb = 0;
  s.rounds.forEach((r, i) => {
    const btn = el.roundStrip.children[i];
    const win = winnerKeyOf(r);
    const shown = r.status === 'FINISHED' && r.result !== '*' && !spoil;
    let cls = 'cell';
    if (r.status === 'LIVE') cls += ' is-live';
    else if (r.status === 'UPCOMING') cls += ' is-upcoming';
    else if (shown && r.result === '1/2-1/2') cls += ' is-draw';
    else if (shown && win) cls += win === s.players[0].key ? ' win-a' : ' win-b';
    if (r.kind === 'tiebreak') tb += 1;
    btn.className = cls;
    setText(btn.firstChild, r.kind === 'tiebreak' ? `T${tb}` : r.n);
    setText(btn.lastChild, shown ? (r.result === '1/2-1/2' ? '½' : initialsOf(playerOf(win))) : '');
    setAttr(btn, 'aria-current', r.id === cur ? 'true' : null);
    const outcome = r.status === 'LIVE' ? 'live now' : r.status === 'UPCOMING' ? formatStartTime(r.startsAt) : spoil ? 'finished' : r.result === '1/2-1/2' ? 'draw' : win ? `${playerOf(win).name} won` : 'finished';
    setAttr(btn, 'aria-label', `${r.name}, ${outcome}`);
    setAttr(btn, 'title', `${r.name} · ${outcome}`);
  });
}

function sidesOf(detail) {
  const s = state.snapshot;
  const aIsWhite = detail.white.key !== s.players[1].key; // unknown players default to A having White
  return { aIsWhite };
}

function paintGame(spoil) {
  const s = state.snapshot;
  const id = selectedId();
  const round = s.rounds.find((r) => r.id === id);
  const detail = state.details[id] || null;
  const now = Date.now();
  const [a, b] = s.players;

  setText(el.gameName, round.name);
  if (!detail) {
    setText(el.gameState, round.status === 'UPCOMING' ? formatStartTime(round.startsAt) : 'Loading…');
    setClass(el.gameState, 'is-live', false);
    el.evalChip.hidden = true;
    for (const n of ['pA', 'pD', 'pB']) setText(el[n], '–');
    setText(el.clockA, '–');
    setText(el.clockB, '–');
    el.clockA.value = '–';
    el.clockB.value = '–';
    el.chartWrap.hidden = true;
    el.stakes.hidden = true;
    el.evalNote.hidden = true;
    setText(el.tcText, round.status === 'UPCOMING' ? `Starts ${formatStartTime(round.startsAt)}` : 'Loading this game…');
    return;
  }
  el.chartWrap.hidden = detail.moves.length === 0; // nothing to plot before the first move

  const live = detail.status === 'LIVE';
  const finished = detail.status === 'FINISHED';
  const { aIsWhite } = sidesOf(detail);
  const delay = live ? state.settings.streamDelaySec : 0;
  const view = finished || live
    ? deriveGame(s, detail, now, delay)
    : { whiteSec: detail.clocks.whiteSec, blackSec: detail.clocks.blackSec, probs: pregameFor(s, detail) };
  const probs = view.probs;
  const secA = aIsWhite ? view.whiteSec : view.blackSec;
  const secB = aIsWhite ? view.blackSec : view.whiteSec;

  // header chips
  el.gameState.className = `state-chip${live ? ' is-live' : ''}`;
  setText(el.gameState, live ? `LIVE · move ${detail.moveNumber}` : finished ? (spoil ? 'FINISHED' : `FINAL ${formatResult(detail.result)}`) : formatStartTime(detail.startsAt, now));
  if (live && detail.eval && !spoil) {
    el.evalChip.hidden = false;
    setText(el.evalChip, `Eval ${formatEval(detail.eval.pawns, detail.eval.mate)}`);
  } else {
    el.evalChip.hidden = true;
  }
  // win / draw / loss, by player
  const pA = aIsWhite ? probs.whiteWin : probs.blackWin;
  const pB = aIsWhite ? probs.blackWin : probs.whiteWin;
  const pct = (p) => `${Math.round(p * 100)}%`;
  setText(el.pA, spoil ? '·' : pct(pA));
  setText(el.pD, spoil ? '·' : pct(probs.draw));
  setText(el.pB, spoil ? '·' : pct(pB));
  setText(el.lA, a.name);
  setText(el.lB, b.name);
  el.segA.style.width = spoil ? '33%' : `${pA * 100}%`;
  el.segD.style.width = spoil ? '34%' : `${probs.draw * 100}%`;
  el.segB.style.width = spoil ? '33%' : `${pB * 100}%`;
  setAttr(el.wdlBar, 'aria-label', spoil ? 'Odds hidden' : `${a.name} ${pct(pA)}, draw ${pct(probs.draw)}, ${b.name} ${pct(pB)}`);

  let note = '';
  if (live && !probs.known) note = 'Estimated from ratings and clocks: there is no engine eval for this position yet.';
  else if (live && detail.eval && detail.plyCount - detail.eval.ply >= 3) note = `The engine eval is ${Math.ceil((detail.plyCount - detail.eval.ply) / 2)} moves old.`;
  el.evalNote.hidden = !note;
  if (note) setText(el.evalNote, note);

  // clocks
  const turnA = live && (aIsWhite ? detail.isWhiteTurn : !detail.isWhiteTurn);
  const turnB = live && !turnA;
  setClass(el.turnA, 'is-on', turnA);
  setClass(el.turnB, 'is-on', turnB);
  el.swatchA.className = `swatch ${aIsWhite ? '' : 'is-black'}`;
  el.swatchB.className = `swatch ${aIsWhite ? 'is-black' : ''}`;
  setText(el.csNameA, a.name);
  setText(el.csNameB, b.name);
  setAttr(el.clockA, 'aria-label', `${a.name}'s clock`);
  setAttr(el.clockB, 'aria-label', `${b.name}'s clock`);
  for (const [side, node, sec, ticking] of [['a', el.clockA, secA, turnA], ['b', el.clockB, secB, turnB]]) {
    const editable = live && ticking;
    node.readOnly = !editable;
    setClass(node, 'is-editable', editable);
    if (state.editing !== side) {
      const text = formatClockSeconds(sec);
      if (node.value !== text) node.value = text;
    }
    const stress = aIsWhite ? (side === 'a' ? probs.clocks.stressW : probs.clocks.stressB) : (side === 'a' ? probs.clocks.stressB : probs.clocks.stressW);
    setClass(node, 'is-zeitnot', live && stress >= 0.45);
  }
  const c = probs.clocks;
  const tauA = aIsWhite ? c.tauWSec : c.tauBSec;
  const tauB = aIsWhite ? c.tauBSec : c.tauWSec;
  const pace = (name, tau) => (live ? (c.isPhase2 ? `${name}: +30 s per move` : `${name}: ${(tau / 60).toFixed(1)} min per move to move 40`) : null);
  for (const [node, tau, name, ticking] of [[el.clockA, tauA, a.name, turnA], [el.clockB, tauB, b.name, turnB]]) {
    setAttr(node, 'title', ticking && live ? `${pace(name, tau)}. Click to match your stream.` : pace(name, tau));
  }
  const diff = secA - secB;
  if ((live || finished) && Math.abs(diff) >= 1) {
    el.deltaChip.hidden = false;
    const lead = diff > 0 ? 'is-a' : 'is-b';
    el.deltaChip.className = `delta-chip ${lead}`;
    const m = Math.floor(Math.abs(diff) / 60);
    const sec = Math.floor(Math.abs(diff) % 60);
    setText(el.deltaChip, `${diff > 0 ? a.name : b.name} +${m}:${String(sec).padStart(2, '0')}`);
  } else {
    el.deltaChip.hidden = true;
  }
  setText(el.vsLabel, finished ? 'final' : 'vs');

  // time-control strip
  let danger = false;
  let tc;
  if (live) {
    if (c.isPhase2) tc = `Move ${detail.moveNumber} · +30 s per move`;
    else {
      tc = `${c.mRem} move${c.mRem === 1 ? '' : 's'} to move 40 · no increment`;
      danger = Math.min(secA, secB) < 600;
    }
  } else if (finished) {
    const next = s.rounds.find((r) => r.id === s.nextRoundId);
    tc = `${detail.completedMoves ? `Finished after ${detail.completedMoves} moves` : 'Finished'}${next && next.n === detail.n + 1 ? ` · ${next.name} in ${formatCountdownShort(next.startsAt - now)}` : ''}`;
  } else {
    const ms = (detail.startsAt || 0) - now;
    tc = ms > 0 ? `Starts in ${formatCountdown(ms)} · ${formatStartTime(detail.startsAt, now)}` : 'Starting now';
  }
  setText(el.tcText, tc);
  setClass(el.tcStrip, 'is-danger', danger);
  const delaySet = live && state.settings.streamDelaySec > 0;
  el.delayChip.hidden = !delaySet;
  if (delaySet) setText(el.delayChip, `Stream +${state.settings.streamDelaySec}s ✕`);

  paintChart(detail, aIsWhite, spoil);
  paintStakes(detail, aIsWhite, spoil);
}

function chartHasEvals(detail) {
  return detail.moves.some((m) => m.e !== null && m.e !== undefined);
}

function paintChart(detail, aIsWhite, spoil) {
  const s = state.snapshot;
  const [a, b] = s.players;
  const mode = state.chartMode || (chartHasEvals(detail) ? 'eval' : 'clock');
  setAttr(el.tabEval, 'aria-selected', String(mode === 'eval'));
  setAttr(el.tabClock, 'aria-selected', String(mode === 'clock'));
  const topKey = state.settings.follow !== 'none' ? state.settings.follow : a.key;
  const topIsWhite = detail.white.key === topKey;
  const key = [detail.id, detail.fetchedAt, detail.moves.length, mode, topKey, spoil].join('|');
  if (key !== last.chartKey) {
    last.chartKey = key;
    const model = chartModel(detail.moves, { kind: mode, width: CHART_W, height: CHART_H, topIsWhite });
    paintChart.model = model;
    const eval_ = mode === 'eval';
    const showData = model.hasData && !(spoil && eval_);
    setHidden(el.chartArea, !eval_);
    setHidden(el.chartLine, !eval_);
    setHidden(el.chartMid, !eval_);
    setHidden(el.clockLineA, eval_);
    setHidden(el.clockLineB, eval_);
    el.chartEmpty.hidden = showData || (!eval_ && model.hasData);
    setText(el.chartEmpty, eval_ ? (detail.moves.length ? 'No engine evals for this game yet. Try the clocks.' : 'The game has not started.') : 'No clock data yet.');
    el.chartArea.setAttribute('d', eval_ && showData ? model.area : '');
    el.chartLine.setAttribute('d', eval_ && showData ? model.line : '');
    if (!eval_ && model.hasData) {
      el.clockLineA.setAttribute('d', aIsWhite ? model.white : model.black);
      el.clockLineB.setAttribute('d', aIsWhite ? model.black : model.white);
    }
    const m40 = model.markers[0];
    setHidden(el.chartMarker, !m40);
    if (m40) {
      el.chartMarker.setAttribute('x1', m40.x);
      el.chartMarker.setAttribute('x2', m40.x);
    }
    el.chart.style.setProperty('--ctop', colorVar(topKey));
    el.chart.style.setProperty('--cbottom', colorVar(topKey === a.key ? b.key : a.key));
    setHidden(el.chartCursor, true);
    setHidden(el.chartDot, true);
    el.chartLegend.classList.toggle('is-bottom', !eval_);
    el.chartLegend.replaceChildren(
      ...(eval_
        ? [legendItem(`${playerOf(topKey).name} better ↑`, colorVar(topKey))]
        : [legendItem(a.name, 'var(--pa)'), legendItem(b.name, 'var(--pb)')])
    );
    const showAxis = !eval_ && model.hasData;
    el.axisTop.hidden = !showAxis;
    el.axisBottom.hidden = !showAxis;
    if (showAxis) {
      setText(el.axisTop, formatClockSeconds(model.axis.hi));
      setText(el.axisBottom, formatClockSeconds(model.axis.lo));
    }
  }
  paintCaption(detail, mode, spoil);
}

function legendItem(label, color) {
  const span = document.createElement('span');
  const dot = document.createElement('i');
  dot.style.setProperty('--pc', color);
  span.append(dot, label);
  return span;
}

function paintCaption(detail, mode, spoil) {
  const model = paintChart.model;
  if (spoil) {
    setText(el.chartCaption, ' ');
    return;
  }
  if (state.hoverPly && model) {
    const h = model.hover[state.hoverPly - 1];
    if (h) {
      const m = h.move;
      const bits = [`${m.n}${m.b ? '...' : '.'} ${m.s}`];
      if (m.e !== null && m.e !== undefined) bits.push(`eval ${formatEval(m.e, m.m)}`);
      if (m.c !== null && m.c !== undefined) bits.push(`${formatClockSeconds(m.c)} left`);
      setText(el.chartCaption, bits.join(' · '));
      return;
    }
  }
  const opening = shortOpening(detail.opening);
  const bits = [];
  if (opening) bits.push(opening);
  if (detail.lastMove) bits.push(`last ${detail.lastMove}`);
  setText(el.chartCaption, bits.length ? bits.join(' · ') : detail.status === 'UPCOMING' ? 'Not started' : ' ');
  setAttr(el.chartCaption, 'title', detail.opening || null);
}

function paintStakes(detail, aIsWhite, spoil) {
  const s = state.snapshot;
  const st = stakesFor(s, detail);
  el.stakes.hidden = !st;
  if (!st) return;
  const [a, b] = s.players;
  const key = state.settings.follow !== 'none' ? state.settings.follow : a.key;
  const mine = (odds) => (spoil ? '·' : `${Math.round(titleOddsFor(s, odds, key) * 100)}%`);
  setText(el.stakesTitle, `${playerOf(key).name}'s title odds if…`);
  setText(el.stakeLblA, `${a.name} wins`);
  setText(el.stakeLblB, `${b.name} wins`);
  setText(el.stakeA, mine(aIsWhite ? st.whiteWin : st.blackWin));
  setText(el.stakeD, mine(st.draw));
  setText(el.stakeB, mine(aIsWhite ? st.blackWin : st.whiteWin));
}

function paintFooter() {
  const s = state.snapshot;
  const now = Date.now();
  setText(el.refreshLabel, state.syncing ? 'Syncing…' : 'Sync');
  el.refreshBtn.disabled = state.syncing;
  el.refreshBtn.querySelector('svg').classList.toggle('spinning', state.syncing);
  let text;
  let isError = false;
  if (state.flash && state.flash.until > now) text = state.flash.text;
  else if (state.syncing) text = s ? `Updated ${formatAgo(now - s.fetchedAt)}` : 'Connecting…';
  else if (state.syncError || state.meta.lastError) {
    isError = true;
    text = s ? `Offline · showing data from ${formatAgo(now - s.fetchedAt)}` : 'Offline';
  } else text = s ? `Updated ${formatAgo(now - s.fetchedAt)}` : 'Connecting…';
  setText(el.statusBar, text);
  setClass(el.statusBar, 'is-error', isError);
}

function announceChanges(spoil) {
  const s = state.snapshot;
  if (spoil) return;
  const key = `${formatPoints(s.score.a)}-${formatPoints(s.score.b)}-${s.rounds.filter((r) => r.status === 'FINISHED').length}`;
  if (last.announce !== null && last.announce !== key) {
    const [a, b] = s.players;
    setText(el.announcer, `Score is now ${a.name} ${formatPoints(s.score.a)}, ${b.name} ${formatPoints(s.score.b)}.`);
  }
  last.announce = key;
}

// ---------- settings sheet ----------

function paintSettings() {
  const st = state.settings;
  const followBtns = ['none', ...EVENT.players.map((p) => p.key)];
  const wanted = followBtns.join();
  if (el.followControl.dataset.keys !== wanted) {
    el.followControl.dataset.keys = wanted;
    el.followControl.replaceChildren(
      ...followBtns.map((k) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('role', 'radio');
        btn.dataset.value = k;
        btn.textContent = k === 'none' ? 'Nobody' : EVENT.players.find((p) => p.key === k).name;
        return btn;
      })
    );
  }
  for (const btn of el.followControl.children) setAttr(btn, 'aria-checked', String(btn.dataset.value === st.follow));
  for (const btn of el.badgeControl.children) setAttr(btn, 'aria-checked', String(btn.dataset.value === st.badge));
  el.shieldSwitch.checked = st.spoilerShield;
  setText(el.delayValue, `${st.streamDelaySec} s`);
  el.notifySoon.checked = st.notify.soon;
  el.notifyResult.checked = st.notify.result;
  el.notifyZeitnot.checked = st.notify.zeitnot;
  el.delayMinus.disabled = st.streamDelaySec <= 0;
  el.delayPlus.disabled = st.streamDelaySec >= MAX_STREAM_DELAY_SEC;
}

async function ensureNotificationPermission() {
  if (!chrome.permissions || !chrome.permissions.request) return false;
  try {
    return await chrome.permissions.request({ permissions: ['notifications'] });
  } catch {
    return false;
  }
}

async function onNotifyChange(key, input) {
  if (input.checked && !(await ensureNotificationPermission())) {
    input.checked = false;
    el.notifyNote.hidden = false;
    setText(el.notifyNote, 'Chrome did not allow notifications, so this stays off. You can try again.');
    return;
  }
  el.notifyNote.hidden = true;
  await saveSettings(chrome.storage.local, { notify: { [key]: input.checked } });
}

/** Updates the screen first, then saves, so two quick clicks on + add up instead of both starting from the old value. */
function setDelay(sec) {
  state.settings = { ...state.settings, streamDelaySec: sec };
  schedulePaint();
  return saveSettings(chrome.storage.local, { streamDelaySec: sec });
}

// ---------- clock calibration ----------

function flashClock(node, cls) {
  node.classList.remove('is-ok', 'is-bad');
  void node.offsetWidth;
  node.classList.add(cls);
  setTimeout(() => node.classList.remove(cls), 800);
}

async function commitCalibration(side) {
  const node = side === 'a' ? el.clockA : el.clockB;
  state.editing = null;
  const detail = state.details[selectedId()];
  if (!detail || detail.status !== 'LIVE') return;
  const entered = tryParseClockSeconds(node.value);
  const real = clocksNow(detail, Date.now(), 0);
  const { aIsWhite } = sidesOf(detail);
  const ticking = detail.clocks.ticking === 'w' ? real.whiteSec : real.blackSec;
  const delay = entered === null ? NaN : Math.round(entered - ticking);
  if (!Number.isFinite(delay) || delay < -5 || delay > MAX_STREAM_DELAY_SEC) {
    flashClock(node, 'is-bad');
    flashStatus(entered === null ? 'That is not a clock time. Try 1:23:45' : delay > 0 ? 'Your stream looks more than 5 minutes behind' : 'That is ahead of the live clock');
    paint();
    return;
  }
  void aIsWhite;
  await setDelay(Math.max(0, delay));
  flashClock(node, 'is-ok');
  flashStatus(delay <= 0 ? 'In step with the live clock' : `Stream delay set to ${delay} s`);
}

function wireClock(side) {
  const node = side === 'a' ? el.clockA : el.clockB;
  node.addEventListener('focus', () => {
    if (node.readOnly) {
      node.blur();
      return;
    }
    state.editing = side;
    node.select();
  });
  node.addEventListener('blur', () => {
    if (state.editing === side) commitCalibration(side);
  });
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      node.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      state.editing = null;
      node.blur();
      paint();
    }
  });
}

// ---------- events ----------

function wire() {
  el.refreshBtn.addEventListener('click', () => requestSync(true));
  el.emptyRetry.addEventListener('click', () => requestSync(true));
  el.statusPill.addEventListener('click', () => {
    const s = state.snapshot;
    if (s && s.liveRoundId) pickRound(s.liveRoundId);
  });
  el.roundStrip.addEventListener('click', (e) => {
    const btn = e.target.closest('.cell');
    if (btn) pickRound(btn.dataset.id);
  });

  el.settingsBtn.addEventListener('click', () => {
    state.settingsOpen = !state.settingsOpen;
    paint();
  });
  el.settingsClose.addEventListener('click', () => {
    state.settingsOpen = false;
    paint();
  });
  el.followControl.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn) saveSettings(chrome.storage.local, { follow: btn.dataset.value });
  });
  el.badgeControl.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn) saveSettings(chrome.storage.local, { badge: btn.dataset.value });
  });
  el.shieldSwitch.addEventListener('change', () => {
    state.revealed = false;
    saveSettings(chrome.storage.local, { spoilerShield: el.shieldSwitch.checked });
  });
  el.shieldToggle.addEventListener('click', () => {
    state.revealed = !state.revealed;
    paint();
  });
  el.delayMinus.addEventListener('click', () => setDelay(Math.max(0, state.settings.streamDelaySec - 5)));
  el.delayPlus.addEventListener('click', () => setDelay(Math.min(MAX_STREAM_DELAY_SEC, state.settings.streamDelaySec + 5)));
  el.delayChip.addEventListener('click', () => setDelay(0));
  el.notifySoon.addEventListener('change', () => onNotifyChange('soon', el.notifySoon));
  el.notifyResult.addEventListener('change', () => onNotifyChange('result', el.notifyResult));
  el.notifyZeitnot.addEventListener('change', () => onNotifyChange('zeitnot', el.notifyZeitnot));

  for (const side of ['A', 'B']) {
    el[`follow${side}`].addEventListener('click', () => {
      const s = state.snapshot;
      if (!s) return;
      const key = s.players[side === 'A' ? 0 : 1].key;
      saveSettings(chrome.storage.local, { follow: state.settings.follow === key ? 'none' : key });
    });
  }

  el.tabEval.addEventListener('click', () => { state.chartMode = 'eval'; last.chartKey = ''; schedulePaint(); });
  el.tabClock.addEventListener('click', () => { state.chartMode = 'clock'; last.chartKey = ''; schedulePaint(); });
  el.chart.addEventListener('pointermove', (e) => {
    const model = paintChart.model;
    if (!model || !model.hover.length) return;
    const rect = el.chart.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / (rect.width || CHART_W)) * CHART_W;
    const h = nearestPly(model, x);
    if (!h) return;
    state.hoverPly = h.ply;
    setHidden(el.chartCursor, false);
    el.chartCursor.setAttribute('x1', h.x);
    el.chartCursor.setAttribute('x2', h.x);
    const pt = (model.points || (h.move.b ? model.blackPoints : model.whitePoints) || []).find((p) => p.ply === h.ply);
    setHidden(el.chartDot, !pt);
    if (pt) {
      el.chartDot.setAttribute('cx', pt.x);
      el.chartDot.setAttribute('cy', pt.y);
    }
    schedulePaint();
  });
  el.chart.addEventListener('pointerleave', () => {
    state.hoverPly = null;
    setHidden(el.chartCursor, true);
    setHidden(el.chartDot, true);
    schedulePaint();
  });

  el.copyBtn.addEventListener('click', async () => {
    const s = state.snapshot;
    if (!s) return;
    if (spoilNow()) {
      flashStatus('Reveal spoilers to copy a summary');
      return;
    }
    try {
      await navigator.clipboard.writeText(summaryText(s, state.details[selectedId()] || null, currentOdds(), Date.now()));
      flashStatus('Summary copied');
    } catch {
      flashStatus('Could not copy');
    }
  });

  wireClock('a');
  wireClock('b');

  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape' && state.settingsOpen) {
      state.settingsOpen = false;
      paint();
    } else if (e.key === 'ArrowLeft') {
      stepRound(-1);
    } else if (e.key === 'ArrowRight') {
      stepRound(1);
    } else if (e.key === 'l' || e.key === 'L') {
      const s = state.snapshot;
      if (s) pickRound(s.liveRoundId || s.focusRoundId);
    } else if (e.key === 'r' || e.key === 'R') {
      requestSync(true);
    }
  });
}

// ---------- start ----------

async function start() {
  wire();
  try {
    await loadState();
  } catch {
    // Storage unreadable: show the empty state and let the sync try.
  }
  paint();
  requestSync(false);
  setInterval(() => {
    if (document.hidden) return;
    paint();
    if (!state.syncing && Date.now() - state.lastRequestAt >= wantedRefreshMs()) requestSync(false);
  }, 1000);
}

start();
