// WCC 2026 Live Pulse - Background Service Worker (ES Module)
import { fetchWccSnapshot } from './shared/wcc_data.js';

const ALARM_NAME = 'wcc_live_sync';
const STORAGE_KEY = 'wccPulseStateV2';

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.remove(['matchData', 'lastSyncAt', 'userAdjustedClocks', 'rawPgn']);
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  try {
    await syncSnapshot();
  } catch (err) {
    console.warn('[WCC Live Pulse] Initial sync failed:', err);
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    try {
      await syncSnapshot();
    } catch (err) {
      console.warn('[WCC Live Pulse] Alarm sync failed:', err);
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'SYNC_NOW') {
    syncSnapshot(message.roundId || null)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

async function syncSnapshot(preferredRoundId = null) {
  const snapshot = await fetchWccSnapshot(preferredRoundId);
  await chrome.storage.local.set({ [STORAGE_KEY]: snapshot });
  return snapshot;
}
