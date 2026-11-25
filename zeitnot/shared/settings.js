// User settings, kept in chrome.storage.local. Everything is validated on the way in, so a corrupted or
// older value can never break the popup or the service worker.

import { EVENT } from './event.js';

export const SETTINGS_KEY = 'zeitnot:settings';
export const BADGE_MODES = ['eval', 'odds', 'off'];
export const MAX_STREAM_DELAY_SEC = 300;

export const DEFAULT_SETTINGS = Object.freeze({
  follow: 'none', // a player's key, or 'none'
  spoilerShield: false, // hide scores, results, odds and evals until you tap to reveal
  badge: 'eval', // what the toolbar badge shows while a game is on
  streamDelaySec: 0, // how far behind your video stream is; the running clock is shown as the stream would show it
  notify: Object.freeze({ soon: false, result: false, zeitnot: false }),
});

export function normalizeSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const n = r.notify && typeof r.notify === 'object' ? r.notify : {};
  const delay = Math.round(Number(r.streamDelaySec));
  return {
    follow: ['none', ...EVENT.players.map((p) => p.key)].includes(r.follow) ? r.follow : DEFAULT_SETTINGS.follow,
    spoilerShield: r.spoilerShield === true,
    badge: BADGE_MODES.includes(r.badge) ? r.badge : DEFAULT_SETTINGS.badge,
    streamDelaySec: Number.isFinite(delay) ? Math.max(0, Math.min(MAX_STREAM_DELAY_SEC, delay)) : 0,
    notify: { soon: n.soon === true, result: n.result === true, zeitnot: n.zeitnot === true },
  };
}

export async function loadSettings(area) {
  const got = await area.get(SETTINGS_KEY);
  return normalizeSettings(got[SETTINGS_KEY]);
}

/** Merges `patch` (notify merges key by key) into the saved settings and returns the result. */
export async function saveSettings(area, patch) {
  const current = await loadSettings(area);
  const next = normalizeSettings({ ...current, ...patch, notify: { ...current.notify, ...(patch.notify || {}) } });
  await area.set({ [SETTINGS_KEY]: next });
  return next;
}
