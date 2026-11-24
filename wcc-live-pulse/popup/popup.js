// WCC Live Pulse - Popup Controller
import { calculateWccProbabilities } from './probability_engine.js';

const BROADCAST_PGN_URL = 'https://lichess.org/api/broadcast/round/xLgOJ6cb.pgn';

// DOM elements
const el = {
  segWhite: document.getElementById('segWhite'),
  segDraw: document.getElementById('segDraw'),
  segBlack: document.getElementById('segBlack'),
  probWhite: document.getElementById('probWhite'),
  probDraw: document.getElementById('probDraw'),
  probBlack: document.getElementById('probBlack'),
  matchValues: document.getElementById('matchValues'),
  openingBadge: document.getElementById('openingBadge'),
  whiteClock: document.getElementById('whiteClock'),
  blackClock: document.getElementById('blackClock'),
  whitePace: document.getElementById('whitePace'),
  blackPace: document.getElementById('blackPace'),
  deltaChip: document.getElementById('deltaChip'),
  tcText: document.getElementById('tcText'),
  movePill: document.getElementById('movePill'),
  lastMove: document.getElementById('lastMove'),
  engineEval: document.getElementById('engineEval'),
  timeHazard: document.getElementById('timeHazard'),
  effectiveEval: document.getElementById('effectiveEval'),
  refreshBtn: document.getElementById('refreshBtn'),
  refreshLabel: document.getElementById('refreshLabel'),
  autoSyncCheck: document.getElementById('autoSyncCheck'),
  statusBar: document.getElementById('statusBar'),
  pulseText: document.getElementById('pulseText'),
};

let autoSyncTimer = null;
let isSyncing = false;

// Default initial state (Game 1 Move 13 baseline)
const defaultState = {
  white: 'Sindarov, Javokhir',
  black: 'Gukesh D',
  whiteElo: 2782,
  blackElo: 2710,
  round: '1.1',
  opening: 'Berlin Defense',
  lastMove: '13... Bd7',
  moveNumber: 13,
  isWhiteTurn: true,
  whiteTimeStr: '1:54:43',
  blackTimeStr: '1:19:13',
  whiteTimeSec: 6883,
  blackTimeSec: 4753,
  evalPawns: 0.25,
};

document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();

  // Load cache first for instant render
  try {
    const cached = await chrome.storage.local.get(['matchData', 'lastSyncAt']);
    if (cached.matchData) {
      render(cached.matchData);
      const ageSec = Math.round((Date.now() - (cached.lastSyncAt || 0)) / 1000);
      el.statusBar.textContent = `Updated ${ageSec < 5 ? 'just now' : `${ageSec}s ago`}`;
    } else {
      render(defaultState);
    }
  } catch (err) {
    console.warn('Storage read error:', err);
    render(defaultState);
  }

  // Trigger live sync
  await syncMatchData();
  setupAutoSync();
});

function setupEventListeners() {
  el.refreshBtn.addEventListener('click', async () => {
    await syncMatchData();
  });

  el.autoSyncCheck.addEventListener('change', () => {
    setupAutoSync();
  });
}

function setupAutoSync() {
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
  if (el.autoSyncCheck.checked) {
    autoSyncTimer = setInterval(async () => {
      await syncMatchData(true);
    }, 15000); // Poll every 15 seconds
  }
}

async function syncMatchData(silent = false) {
  if (isSyncing) return;
  isSyncing = true;
  if (!silent) {
    const icon = el.refreshBtn.querySelector('svg');
    if (icon) icon.classList.add('spinning');
    el.refreshLabel.textContent = 'Syncing…';
  }

  try {
    const res = await fetch(BROADCAST_PGN_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const pgnText = await res.text();
    const parsed = parsePgn(pgnText);

    await chrome.storage.local.set({
      matchData: parsed,
      lastSyncAt: Date.now(),
    });

    render(parsed);
    el.statusBar.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    el.pulseText.textContent = 'LIVE';
  } catch (err) {
    console.warn('[WCC Live Pulse] Fetch error, using fallback state:', err);
    el.statusBar.textContent = 'Offline cache active';
    el.pulseText.textContent = 'STANDBY';
  } finally {
    isSyncing = false;
    if (!silent) {
      const icon = el.refreshBtn.querySelector('svg');
      if (icon) icon.classList.remove('spinning');
      el.refreshLabel.textContent = 'Sync';
    }
  }
}

function parsePgn(pgn) {
  const getHeader = (name) => {
    const m = pgn.match(new RegExp(`\\[${name}\\s+"([^"]+)"\\]`));
    return m ? m[1] : '';
  };

  const white = getHeader('White') || defaultState.white;
  const black = getHeader('Black') || defaultState.black;
  const whiteElo = parseInt(getHeader('WhiteElo') || '2782', 10);
  const blackElo = parseInt(getHeader('BlackElo') || '2710', 10);
  const openingFull = getHeader('Opening') || defaultState.opening;
  const opening = openingFull.includes('Berlin') ? 'Berlin Defense' : openingFull.split(':')[0];

  const clkMatches = [...pgn.matchAll(/(\d+\.{1,3}\s*[^\s{}]+)\s*\{\s*\[%clk\s+([^\]]+)\]/g)];

  let whiteTimeStr = defaultState.whiteTimeStr;
  let blackTimeStr = defaultState.blackTimeStr;
  let lastMove = defaultState.lastMove;
  let moveNumber = defaultState.moveNumber;
  let isWhiteTurn = defaultState.isWhiteTurn;

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
      if (!notation.includes('...') && whiteTimeStr === defaultState.whiteTimeStr) {
        whiteTimeStr = clk;
      }
      if (notation.includes('...') && blackTimeStr === defaultState.blackTimeStr) {
        blackTimeStr = clk;
      }
    }
  }

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
    opening,
    lastMove,
    moveNumber,
    isWhiteTurn,
    whiteTimeStr,
    blackTimeStr,
    whiteTimeSec: parseClockSeconds(whiteTimeStr),
    blackTimeSec: parseClockSeconds(blackTimeStr),
    evalPawns: 0.25,
  };
}

function render(data) {
  const probData = calculateWccProbabilities({
    evalPawns: data.evalPawns || 0.25,
    whiteTimeSec: data.whiteTimeSec,
    blackTimeSec: data.blackTimeSec,
    moveNumber: data.moveNumber,
    targetMove: 40,
    whiteElo: data.whiteElo,
    blackElo: data.blackElo,
    whiteFormBonus: 25,
    blackFormBonus: -10,
  });

  const { game1, match, clocks } = probData;

  // Segment widths & numbers
  const wPct = (game1.whiteWin * 100).toFixed(1);
  const dPct = (game1.draw * 100).toFixed(1);
  const bPct = (game1.blackWin * 100).toFixed(1);

  el.segWhite.style.width = `${wPct}%`;
  el.segDraw.style.width = `${dPct}%`;
  el.segBlack.style.width = `${bPct}%`;

  el.probWhite.textContent = `${wPct}%`;
  el.probDraw.textContent = `${dPct}%`;
  el.probBlack.textContent = `${bPct}%`;

  // Match series
  const sMatchPct = Math.round(match.sindarov * 100);
  const gMatchPct = 100 - sMatchPct;
  el.matchValues.textContent = `Sindarov ${sMatchPct}% · Gukesh ${gMatchPct}%`;

  // Opening & Move
  el.openingBadge.textContent = data.opening;
  const turnLabel = data.isWhiteTurn ? 'White to move' : 'Black to move';
  el.movePill.textContent = `Move ${data.moveNumber + (data.isWhiteTurn ? 1 : 0)} · ${turnLabel}`;
  el.lastMove.textContent = `Last: ${data.lastMove}`;

  // Clocks
  el.whiteClock.textContent = data.whiteTimeStr;
  el.blackClock.textContent = data.blackTimeStr;
  el.whitePace.textContent = `${clocks.tauWMin}m / move`;
  el.blackPace.textContent = `${clocks.tauBMin}m / move`;

  if (parseFloat(clocks.tauBMin) < 3.0) {
    el.blackPace.classList.add('warning');
  } else {
    el.blackPace.classList.remove('warning');
  }

  el.deltaChip.textContent = clocks.deltaClockFormatted;
  el.tcText.textContent = `${clocks.mRem} moves to move 40 (0s increment)`;

  // Telemetry
  el.engineEval.textContent = `+${(data.evalPawns || 0.25).toFixed(2)}`;
  el.timeHazard.textContent = `${game1.timeShift >= 0 ? '+' : ''}${game1.timeShift.toFixed(2)}`;
  el.effectiveEval.textContent = `${game1.effectiveEval >= 0 ? '+' : ''}${game1.effectiveEval.toFixed(2)}`;
}
