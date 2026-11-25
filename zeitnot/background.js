// Zeitnot service worker. It is the only thing that talks to Lichess and the only writer of the snapshot, so the
// popup, the badge and the notifications can never disagree. The popup reads storage and asks for a sync or a round.
//
// Syncs are one-shot alarms re-armed after every run (shared/schedule.js): every 30 s while a game is on, every
// minute in the hour before one, then every 5 / 30 minutes. A 5-minute watchdog restarts the chain if the worker
// was killed mid-sync.

import { createLichessClient } from './shared/lichess.js';
import { SNAPSHOT_VERSION, emptyCache, fetchRoundDetail, syncTournament } from './shared/tournament.js';
import { computeBadgeSpec } from './shared/badge.js';
import { detectEvents } from './shared/notify.js';
import { MIN_DELAY_MS, nextPollDelayMs } from './shared/schedule.js';
import { SETTINGS_KEY, loadSettings } from './shared/settings.js';
import {
  CACHE_KEY, DEFAULT_META, DETAILS_KEY, META_KEY, MSG_ROUND, MSG_SYNC, SNAPSHOT_KEY,
} from './shared/keys.js';

const SYNC_ALARM = 'zeitnot:sync';
const WATCHDOG_ALARM = 'zeitnot:watchdog';
/** Lichess' CDN caches for 10 s, so a second sync inside this window could not learn anything new. */
const MIN_GAP_MS = 8000;

const client = createLichessClient();
let inflight = null;

async function readState() {
  const got = await chrome.storage.local.get([SNAPSHOT_KEY, DETAILS_KEY, CACHE_KEY, META_KEY]);
  const snapshot = got[SNAPSHOT_KEY] && got[SNAPSHOT_KEY].v === SNAPSHOT_VERSION ? got[SNAPSHOT_KEY] : null;
  return {
    snapshot,
    details: snapshot ? got[DETAILS_KEY] || {} : {},
    cache: snapshot ? got[CACHE_KEY] || emptyCache() : emptyCache(),
    meta: { ...DEFAULT_META, ...(got[META_KEY] || {}) },
  };
}

export async function applyBadge(snapshot, details, settings, now = Date.now()) {
  const detail = snapshot ? details[snapshot.focusRoundId] || null : null;
  const { text, color, title } = computeBadgeSpec(snapshot, detail, settings, now);
  const calls = [chrome.action.setBadgeText({ text }), chrome.action.setBadgeBackgroundColor({ color }), chrome.action.setTitle({ title })];
  if (chrome.action.setBadgeTextColor) calls.push(chrome.action.setBadgeTextColor({ color: '#ffffff' }));
  await Promise.all(calls);
}

async function scheduleNext(snapshot, meta, now = Date.now()) {
  const blockedMs = Math.max(0, (meta.blockedUntil || 0) - now);
  const delay = nextPollDelayMs(snapshot, now, { failures: meta.failures, blockedMs });
  await chrome.alarms.create(SYNC_ALARM, { when: now + delay });
  return delay;
}

async function showNotifications(events) {
  if (!events.length || !chrome.notifications) return;
  for (const e of events) {
    try {
      await chrome.notifications.create(`${e.id}|${e.url || ''}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
        title: e.title,
        message: e.message,
        priority: 1,
      });
    } catch (err) {
      console.warn('[Zeitnot] notification failed:', err);
    }
  }
}

async function doSync({ force }) {
  const now = Date.now();
  const state = await readState();
  // A rate limit outlives the worker (it is saved in meta), and no one, not even the popup, may override it.
  if (state.meta.blockedUntil > now) {
    await scheduleNext(state.snapshot, state.meta, now);
    return { ok: false, error: 'Lichess asked us to slow down, trying again shortly', blockedMs: state.meta.blockedUntil - now };
  }
  if (!force && state.snapshot && !state.meta.lastError && now - state.snapshot.fetchedAt < MIN_GAP_MS) {
    await scheduleNext(state.snapshot, state.meta, now);
    return { ok: true, cached: true };
  }
  try {
    const out = await syncTournament({ client, cache: state.cache, details: state.details, now });
    const settings = await loadSettings(chrome.storage.local);
    const { events, notified } = detectEvents({
      prev: state.snapshot,
      next: out.snapshot,
      detail: out.details[out.snapshot.focusRoundId] || null,
      settings,
      notified: state.meta.notified,
      now,
    });
    const meta = { ...state.meta, failures: 0, lastError: null, lastAttemptAt: now, blockedUntil: 0, notified };
    await chrome.storage.local.set({
      [SNAPSHOT_KEY]: out.snapshot,
      [DETAILS_KEY]: out.details,
      [CACHE_KEY]: out.cache,
      [META_KEY]: meta,
    });
    await Promise.all([applyBadge(out.snapshot, out.details, settings, now), showNotifications(events), scheduleNext(out.snapshot, meta, now)]);
    return { ok: true };
  } catch (err) {
    const blockedUntil = err && err.status === 429 ? now + (err.retryAfterMs || 60000) : state.meta.blockedUntil;
    const meta = {
      ...state.meta,
      failures: state.meta.failures + 1,
      lastError: String((err && err.message) || err),
      lastAttemptAt: now,
      blockedUntil,
    };
    await chrome.storage.local.set({ [META_KEY]: meta });
    await scheduleNext(state.snapshot, meta, now);
    return { ok: false, error: meta.lastError };
  }
}

/** One sync at a time; callers that arrive meanwhile share its result. */
export function sync({ force = false } = {}) {
  if (!inflight) inflight = doSync({ force }).finally(() => { inflight = null; });
  return inflight;
}

async function loadRound(roundId) {
  let state = await readState();
  if (!state.snapshot) {
    await sync({ force: true });
    state = await readState();
  }
  if (!state.snapshot) throw new Error('No data yet');
  const round = state.snapshot.rounds.find((r) => r.id === roundId);
  if (!round) throw new Error('Unknown round');
  if (round.status === 'LIVE' || round.id === state.snapshot.focusRoundId) {
    if (state.details[roundId]) return state.details[roundId];
  }
  const { detail, details } = await fetchRoundDetail({
    client, roundId, snapshot: state.snapshot, cache: state.cache, details: state.details, now: Date.now(),
  });
  await chrome.storage.local.set({ [DETAILS_KEY]: details });
  return detail;
}

async function ensureAlarms() {
  const [main, dog] = await Promise.all([chrome.alarms.get(SYNC_ALARM), chrome.alarms.get(WATCHDOG_ALARM)]);
  if (!dog) await chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 5, delayInMinutes: 5 });
  if (!main) await chrome.alarms.create(SYNC_ALARM, { when: Date.now() + 1000 });
}

async function onNotificationClick(id) {
  const url = id.slice(id.indexOf('|') + 1);
  chrome.notifications.clear(id);
  if (/^https:\/\/lichess\.org\//.test(url)) await chrome.tabs.create({ url });
}

function listenForNotificationClicks() {
  if (chrome.notifications && !listenForNotificationClicks.done) {
    listenForNotificationClicks.done = true;
    chrome.notifications.onClicked.addListener(onNotificationClick);
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onInstalled.addListener(async () => {
    // Clear what the 1.x versions kept.
    await chrome.storage.local.remove(['wccPulseStateV2', 'wccClockAnchorV2', 'matchData', 'lastSyncAt', 'userAdjustedClocks', 'rawPgn']);
    await chrome.alarms.clear('wcc_live_sync');
    await ensureAlarms();
    await sync({ force: true });
  });

  chrome.runtime.onStartup.addListener(async () => {
    await ensureAlarms();
    await sync({ force: true });
  });

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === SYNC_ALARM) {
      await sync();
    } else if (alarm.name === WATCHDOG_ALARM) {
      const [main, state] = await Promise.all([chrome.alarms.get(SYNC_ALARM), readState()]);
      const overdue = state.meta.lastAttemptAt && Date.now() - state.meta.lastAttemptAt > 3 * 60 * 1000 + MIN_DELAY_MS;
      if (!main || overdue) await sync({ force: false });
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === MSG_SYNC) {
      sync({ force: Boolean(message.force) })
        .then(sendResponse)
        .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
      return true;
    }
    if (message && message.type === MSG_ROUND) {
      loadRound(message.roundId)
        .then((detail) => sendResponse({ ok: true, detail }))
        .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
      return true;
    }
    return false;
  });

  // Changing a setting (follow, spoiler shield, badge mode) should show on the badge at once, not at the next sync.
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' || !changes[SETTINGS_KEY]) return;
    const [state, settings] = await Promise.all([readState(), loadSettings(chrome.storage.local)]);
    if (state.snapshot) await applyBadge(state.snapshot, state.details, settings);
  });

  if (chrome.permissions && chrome.permissions.onAdded) chrome.permissions.onAdded.addListener(listenForNotificationClicks);
  listenForNotificationClicks();
}
