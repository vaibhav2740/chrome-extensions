// WCC 2026 Live Pulse - Background Service Worker
const BROADCAST_PGN_URL = 'https://lichess.org/api/broadcast/round/xLgOJ6cb.pgn';
const ALARM_NAME = 'wcc_live_sync';

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[WCC Live Pulse] Service Worker initialized');
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  await syncLiveMatch();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await syncLiveMatch();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SYNC_NOW') {
    syncLiveMatch().then((data) => sendResponse({ ok: true, data })).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // Keep message port open for async response
  }
});

async function syncLiveMatch() {
  try {
    const res = await fetch(BROADCAST_PGN_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const pgnText = await res.text();
    const parsed = parseBroadcastPgn(pgnText);
    await chrome.storage.local.set({
      lastSyncAt: Date.now(),
      matchData: parsed,
      rawPgn: pgnText,
    });
    return parsed;
  } catch (err) {
    console.warn('[WCC Live Pulse] Sync error:', err);
    throw err;
  }
}

function parseBroadcastPgn(pgn) {
  const getHeader = (name) => {
    const m = pgn.match(new RegExp(`\\[${name}\\s+"([^"]+)"\\]`));
    return m ? m[1] : '';
  };

  const white = getHeader('White') || 'Sindarov, Javokhir';
  const black = getHeader('Black') || 'Gukesh D';
  const whiteElo = parseInt(getHeader('WhiteElo') || '2782', 10);
  const blackElo = parseInt(getHeader('BlackElo') || '2710', 10);
  const round = getHeader('Round') || '1.1';
  const openingFull = getHeader('Opening') || 'Ruy Lopez: Berlin Defense';
  const opening = openingFull.includes('Berlin') ? 'Berlin Defense' : openingFull.split(':')[0];

  const clkMatches = [...pgn.matchAll(/(\d+\.{1,3}\s*[^\s{}]+)\s*\{\s*\[%clk\s+([^\]]+)\]/g)];
  
  let whiteTimeStr = null;
  let blackTimeStr = null;
  let lastMove = 'Game start';
  let moveNumber = 1;
  let isWhiteTurn = true;

  if (clkMatches.length > 0) {
    const last = clkMatches[clkMatches.length - 1];
    lastMove = last[1].trim();

    const moveMatch = lastMove.match(/^(\d+)(\.{1,3})/);
    if (moveMatch) {
      moveNumber = parseInt(moveMatch[1], 10);
      isWhiteTurn = moveMatch[2] === '...';
    }

    for (let i = clkMatches.length - 1; i >= 0; i--) {
      const notation = clkMatches[i][1];
      const clk = clkMatches[i][2];
      if (!notation.includes('...') && !whiteTimeStr) {
        whiteTimeStr = clk;
      }
      if (notation.includes('...') && !blackTimeStr) {
        blackTimeStr = clk;
      }
      if (whiteTimeStr && blackTimeStr) break;
    }
  }

  whiteTimeStr = whiteTimeStr || '1:54:43';
  blackTimeStr = blackTimeStr || '1:19:13';

  const parseClockSeconds = (str) => {
    const parts = str.split(':').map((p) => parseInt(p, 10));
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 7200;
  };

  return {
    white,
    black,
    whiteElo,
    blackElo,
    round,
    opening,
    lastMove,
    moveNumber,
    isWhiteTurn,
    whiteTimeStr,
    blackTimeStr,
    whiteTimeSec: parseClockSeconds(whiteTimeStr),
    blackTimeSec: parseClockSeconds(blackTimeStr),
  };
}
