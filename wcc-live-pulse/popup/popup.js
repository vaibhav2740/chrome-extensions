// WCC Live Pulse - Pawnshot Ultra-Glass Controller
import { calculateWccProbabilities } from './probability_engine.js';

const BROADCAST_PGN_URL = 'https://lichess.org/api/broadcast/round/xLgOJ6cb.pgn';

// DOM Elements
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
  whiteTurnDot: document.getElementById('whiteTurnDot'),
  blackTurnDot: document.getElementById('blackTurnDot'),
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
let liveTickTimer = null;
let isSyncing = false;
let isEditingClock = false;

// Default initial state (Game 1 Move 17)
let currentState = {
  white: 'Sindarov, Javokhir',
  black: 'Gukesh D',
  whiteElo: 2782,
  blackElo: 2710,
  round: '1.1',
  opening: 'Berlin Defense',
  lastMove: '17. b3',
  moveNumber: 17,
  isWhiteTurn: false, // 17. b3 was White's move, so now Black's turn!
  whiteTimeStr: '1:18:08',
  blackTimeStr: '1:04:54',
  whiteTimeSec: 4688,
  blackTimeSec: 3894,
  evalPawns: 0.25,
};

document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();

  try {
    const cached = await chrome.storage.local.get(['matchData', 'lastSyncAt', 'userAdjustedClocks']);
    if (cached.matchData) {
      currentState = { ...currentState, ...cached.matchData };
      if (cached.userAdjustedClocks) {
        if (cached.userAdjustedClocks.whiteTimeSec) currentState.whiteTimeSec = cached.userAdjustedClocks.whiteTimeSec;
        if (cached.userAdjustedClocks.blackTimeSec) currentState.blackTimeSec = cached.userAdjustedClocks.blackTimeSec;
        currentState.whiteTimeStr = formatSeconds(currentState.whiteTimeSec);
        currentState.blackTimeStr = formatSeconds(currentState.blackTimeSec);
      }
      render(currentState, true);
    } else {
      render(currentState, true);
    }
  } catch (err) {
    console.warn('Storage read error:', err);
    render(currentState, true);
  }

  startLiveTickTimer();
  await syncMatchData(true);
  setupAutoSync();
});

function setupEventListeners() {
  el.refreshBtn.addEventListener('click', async () => {
    await syncMatchData(false);
  });

  el.autoSyncCheck.addEventListener('change', () => {
    setupAutoSync();
  });

  setupClockEditable(el.whiteClock, 'white');
  setupClockEditable(el.blackClock, 'black');
}

function setupClockEditable(clockElement, playerColor) {
  clockElement.addEventListener('focus', () => {
    isEditingClock = true;
  });

  clockElement.addEventListener('blur', () => {
    isEditingClock = false;
    applyClockEdit(clockElement.textContent.trim(), playerColor);
  });

  clockElement.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clockElement.blur();
    }
  });
}

function applyClockEdit(rawText, playerColor) {
  const sec = parseClockSeconds(rawText);
  if (sec > 0) {
    if (playerColor === 'white') {
      currentState.whiteTimeSec = sec;
      currentState.whiteTimeStr = formatSeconds(sec);
    } else {
      currentState.blackTimeSec = sec;
      currentState.blackTimeStr = formatSeconds(sec);
    }
    chrome.storage.local.set({
      userAdjustedClocks: {
        whiteTimeSec: currentState.whiteTimeSec,
        blackTimeSec: currentState.blackTimeSec,
        setAt: Date.now(),
      }
    });
    render(currentState, true);
    el.statusBar.textContent = `Calibrated with stream at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
}

function startLiveTickTimer() {
  if (liveTickTimer) clearInterval(liveTickTimer);
  liveTickTimer = setInterval(() => {
    if (isEditingClock) return;

    if (currentState.isWhiteTurn && currentState.whiteTimeSec > 0) {
      currentState.whiteTimeSec -= 1;
      currentState.whiteTimeStr = formatSeconds(currentState.whiteTimeSec);
    } else if (!currentState.isWhiteTurn && currentState.blackTimeSec > 0) {
      currentState.blackTimeSec -= 1;
      currentState.blackTimeStr = formatSeconds(currentState.blackTimeSec);
    }

    render(currentState, false);
  }, 1000);
}

function setupAutoSync() {
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
  if (el.autoSyncCheck.checked) {
    autoSyncTimer = setInterval(async () => {
      await syncMatchData(true);
    }, 15000);
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

    const isNewMove = parsed.lastMove !== currentState.lastMove;
    if (isNewMove) {
      currentState = { ...currentState, ...parsed };
      await chrome.storage.local.remove('userAdjustedClocks');
    } else {
      currentState.white = parsed.white;
      currentState.black = parsed.black;
      currentState.whiteElo = parsed.whiteElo;
      currentState.blackElo = parsed.blackElo;
      currentState.opening = parsed.opening;
      currentState.isWhiteTurn = parsed.isWhiteTurn;
      currentState.moveNumber = parsed.moveNumber;
    }

    await chrome.storage.local.set({
      matchData: currentState,
      lastSyncAt: Date.now(),
    });

    render(currentState, true);
    el.statusBar.textContent = `DGT Synced · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    el.pulseText.textContent = 'LIVE';
  } catch (err) {
    console.warn('[WCC Live Pulse] Fetch error, continuing with local ticker:', err);
    el.statusBar.textContent = 'Offline / Ticking';
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

  const white = getHeader('White') || 'Sindarov, Javokhir';
  const black = getHeader('Black') || 'Gukesh D';
  const whiteElo = parseInt(getHeader('WhiteElo') || '2782', 10);
  const blackElo = parseInt(getHeader('BlackElo') || '2710', 10);
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

  whiteTimeStr = whiteTimeStr || '1:18:08';
  blackTimeStr = blackTimeStr || '1:04:54';

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

function parseClockSeconds(str) {
  if (!str) return 7200;
  const parts = str.split(':').map((p) => parseInt(p, 10));
  if (parts.length === 3) return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
  if (parts.length === 2) return (parts[0] || 0) * 60 + (parts[1] || 0);
  return 7200;
}

function formatSeconds(totalSec) {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return `${h}:${mm}:${ss}`;
}

function render(data, updateClockText = true) {
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

  const wPct = (game1.whiteWin * 100).toFixed(1);
  const dPct = (game1.draw * 100).toFixed(1);
  const bPct = (game1.blackWin * 100).toFixed(1);

  el.segWhite.style.width = `${wPct}%`;
  el.segDraw.style.width = `${dPct}%`;
  el.segBlack.style.width = `${bPct}%`;

  el.probWhite.textContent = `${wPct}%`;
  el.probDraw.textContent = `${dPct}%`;
  el.probBlack.textContent = `${bPct}%`;

  const sMatchPct = Math.round(match.sindarov * 100);
  const gMatchPct = 100 - sMatchPct;
  el.matchValues.textContent = `Sindarov ${sMatchPct}% · Gukesh ${gMatchPct}%`;

  el.openingBadge.textContent = data.opening;
  const turnLabel = data.isWhiteTurn ? 'White to move' : 'Black to move';
  const displayMove = data.moveNumber + (data.isWhiteTurn ? 1 : 0);
  el.movePill.textContent = `Move ${displayMove} · ${turnLabel}`;
  el.lastMove.textContent = data.lastMove;

  if (updateClockText && !isEditingClock) {
    el.whiteClock.textContent = data.whiteTimeStr;
    el.blackClock.textContent = data.blackTimeStr;
  } else if (!isEditingClock) {
    el.whiteClock.textContent = formatSeconds(data.whiteTimeSec);
    el.blackClock.textContent = formatSeconds(data.blackTimeSec);
  }

  // Turn dots
  if (data.isWhiteTurn) {
    el.whiteTurnDot.classList.add('active');
    el.blackTurnDot.classList.remove('active');
  } else {
    el.whiteTurnDot.classList.remove('active');
    el.blackTurnDot.classList.add('active');
  }

  el.whitePace.textContent = `${clocks.tauWMin}m / mv`;
  el.blackPace.textContent = `${clocks.tauBMin}m / mv`;

  if (parseFloat(clocks.tauBMin) < 3.0) {
    el.blackPace.classList.add('warning');
  } else {
    el.blackPace.classList.remove('warning');
  }

  el.deltaChip.textContent = clocks.deltaClockFormatted;
  el.tcText.textContent = `${clocks.mRem} moves to move 40 (0s increment)`;

  el.engineEval.textContent = `+${(data.evalPawns || 0.25).toFixed(2)}`;
  el.timeHazard.textContent = `${game1.timeShift >= 0 ? '+' : ''}${game1.timeShift.toFixed(2)}`;
  el.effectiveEval.textContent = `${game1.effectiveEval >= 0 ? '+' : ''}${game1.effectiveEval.toFixed(2)}`;
}
