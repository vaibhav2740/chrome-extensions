// Zeitnot - Background Service Worker (ES Module)
import {
  computeBadgeSpec,
  fetchWccSnapshot,
  resolveAnchoredSnapshot,
} from './shared/wcc_data.js';

const ALARM_NAME = 'wcc_live_sync';
const STORAGE_KEY = 'wccPulseStateV2';
const ANCHOR_KEY = 'wccClockAnchorV2';

async function applyActionBadge(snapshot) {
  const { text, color, title } = computeBadgeSpec(snapshot);
  await Promise.all([
    chrome.action.setBadgeText({ text }),
    chrome.action.setBadgeBackgroundColor({ color }),
    chrome.action.setTitle({ title }),
  ]);
}

export async function syncAndAnchorSnapshot(preferredRoundId = null) {
  const fresh = await fetchWccSnapshot(preferredRoundId);
  const stored = await chrome.storage.local.get([ANCHOR_KEY]);
  const prevAnchor = stored[ANCHOR_KEY] || null;

  const { snapshot, anchor } = resolveAnchoredSnapshot(fresh, prevAnchor);
  await chrome.storage.local.set({
    [STORAGE_KEY]: snapshot,
    [ANCHOR_KEY]: anchor,
  });

  await applyActionBadge(snapshot);
  return { snapshot, anchor };
}

if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onInstalled.addListener(async () => {
    await chrome.storage.local.remove(['matchData', 'lastSyncAt', 'userAdjustedClocks', 'rawPgn']);
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
    try {
      await syncAndAnchorSnapshot();
    } catch (err) {
      console.warn('[Zeitnot] Initial sync failed:', err);
    }
  });

  chrome.runtime.onStartup.addListener(async () => {
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
    try {
      await syncAndAnchorSnapshot();
    } catch (err) {
      console.warn('[Zeitnot] Startup sync failed:', err);
    }
  });

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === ALARM_NAME) {
      try {
        await syncAndAnchorSnapshot();
      } catch (err) {
        console.warn('[Zeitnot] Alarm sync failed:', err);
      }
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'SYNC_NOW') {
      syncAndAnchorSnapshot(message.roundId || null)
        .then((res) => sendResponse({ ok: true, ...res }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }
    if (message?.type === 'UPDATE_BADGE' && message.snapshot) {
      applyActionBadge(message.snapshot)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }
  });
}
