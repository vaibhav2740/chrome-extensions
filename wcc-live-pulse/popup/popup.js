// WCC Live Pulse - Popup Controller
import {
  fetchWccSnapshot,
  formatClockSeconds,
  formatCountdown,
  parseClockSeconds,
} from '../shared/wcc_data.js';
import {
  calculateGameProbabilities,
  identifyPlayer,
} from '../shared/probability_engine.js';

const STORAGE_KEY = 'wccPulseStateV2';

const el = {
  matchScoreSub: document.getElementById('matchScoreSub'),
  statusPill: document.getElementById('statusPill'),
  pulseText: document.getElementById('pulseText'),
  roundSwitcher: document.getElementById('roundSwitcher'),
  tabLastRound: document.getElementById('tabLastRound'),
  tabNextRound: document.getElementById('tabNextRound'),
  heroTitle: document.getElementById('heroTitle'),
  openingBadge: document.getElementById('openingBadge'),
  segWhite: document.getElementById('segWhite'),
  segDraw: document.getElementById('segDraw'),
  segBlack: document.getElementById('segBlack'),
  lblProb1: document.getElementById('lblProb1'),
  valProb1: document.getElementById('valProb1'),
  lblProb2: document.getElementById('lblProb2'),
  valProb2: document.getElementById('valProb2'),
  lblProb3: document.getElementById('lblProb3'),
  valProb3: document.getElementById('valProb3'),
  bannerLabel: document.getElementById('bannerLabel'),
  bannerValue: document.getElementById('bannerValue'),
  whiteName: document.getElementById('whiteName'),
  whiteElo: document.getElementById('whiteElo'),
  whiteClock: document.getElementById('whiteClock'),
  whiteTurnDot: document.getElementById('whiteTurnDot'),
  whitePace: document.getElementById('whitePace'),
  blackName: document.getElementById('blackName'),
  blackElo: document.getElementById('blackElo'),
  blackClock: document.getElementById('blackClock'),
  blackTurnDot: document.getElementById('blackTurnDot'),
  blackPace: document.getElementById('blackPace'),
  centerTopLabel: document.getElementById('centerTopLabel'),
  deltaChip: document.getElementById('deltaChip'),
  tcAlert: document.getElementById('tcAlert'),
  tcText: document.getElementById('tcText'),
  movePill: document.getElementById('movePill'),
  lastMove: document.getElementById('lastMove'),
  evLbl1: document.getElementById('evLbl1'),
  evVal1: document.getElementById('evVal1'),
  evLbl2: document.getElementById('evLbl2'),
  evVal2: document.getElementById('evVal2'),
  evLbl3: document.getElementById('evLbl3'),
  evVal3: document.getElementById('evVal3'),
  refreshBtn: document.getElementById('refreshBtn'),
  refreshLabel: document.getElementById('refreshLabel'),
  autoSyncCheck: document.getElementById('autoSyncCheck'),
  lichessLink: document.getElementById('lichessLink'),
  statusBar: document.getElementById('statusBar'),
};

let snapshot = null;
let selectedRoundId = null;
let autoSyncTimer = null;
let tickTimer = null;
let isSyncing = false;
let isEditingClock = false;

document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();

  try {
    const cached = await chrome.storage.local.get([STORAGE_KEY]);
    if (cached[STORAGE_KEY]) {
      snapshot = cached[STORAGE_KEY];
      renderSnapshot(snapshot, true);
    }
  } catch (err) {
    console.warn('[WCC] Cache read failed:', err);
  }

  startSecondTicker();
  await syncNow(true);
  setupAutoSync();
});

function setupEventListeners() {
  el.refreshBtn.addEventListener('click', () => syncNow(false));
  el.autoSyncCheck.addEventListener('change', setupAutoSync);

  el.tabLastRound.addEventListener('click', async () => {
    if (!snapshot?.lastFinishedRound) return;
    selectedRoundId = snapshot.lastFinishedRound.id;
    await syncNow(false);
  });

  el.tabNextRound.addEventListener('click', async () => {
    if (!snapshot?.nextRound) return;
    selectedRoundId = snapshot.nextRound.id;
    await syncNow(false);
  });

  setupEditableClock(el.whiteClock, 'white');
  setupEditableClock(el.blackClock, 'black');
}

function setupEditableClock(clockEl, color) {
  clockEl.addEventListener('focus', () => {
    if (snapshot?.activeRound?.status !== 'LIVE') {
      clockEl.blur();
      return;
    }
    isEditingClock = true;
  });

  clockEl.addEventListener('blur', () => {
    if (!isEditingClock) return;
    isEditingClock = false;
    if (snapshot?.activeRound?.status !== 'LIVE') return;

    const sec = parseClockSeconds(clockEl.textContent.trim());
    if (sec >= 0) {
      const ar = snapshot.activeRound;
      if (color === 'white') {
        ar.white.timeSec = sec;
        ar.white.timeStr = formatClockSeconds(sec);
      } else {
        ar.black.timeSec = sec;
        ar.black.timeStr = formatClockSeconds(sec);
      }
      recomputeLiveRoundProbs();
      renderSnapshot(snapshot, true);
      el.statusBar.textContent = `Stream calibrated · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
  });

  clockEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clockEl.blur();
    }
  });
}

function setupAutoSync() {
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
  if (el.autoSyncCheck.checked) {
    autoSyncTimer = setInterval(() => syncNow(true), 15000);
  }
}

function startSecondTicker() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    if (!snapshot || isEditingClock) return;
    const ar = snapshot.activeRound;

    if (ar.status === 'LIVE') {
      if (ar.isWhiteTurn && ar.white.timeSec > 0) {
        ar.white.timeSec -= 1;
        ar.white.timeStr = formatClockSeconds(ar.white.timeSec);
      } else if (!ar.isWhiteTurn && ar.black.timeSec > 0) {
        ar.black.timeSec -= 1;
        ar.black.timeStr = formatClockSeconds(ar.black.timeSec);
      }
      recomputeLiveRoundProbs();
      renderSnapshot(snapshot, false);
    } else if (snapshot.nextRound) {
      // Update live countdown to next game cleanly (never touches player clocks!)
      renderCountdownOnly(snapshot);
    }
  }, 1000);
}

function recomputeLiveRoundProbs() {
  const ar = snapshot.activeRound;
  const wProf = identifyPlayer(ar.white.fullName, 'white');
  const bProf = identifyPlayer(ar.black.fullName, 'black');
  ar.gameProbs = calculateGameProbabilities({
    evalPawns: ar.evalPawns,
    mateIn: ar.mateIn,
    whiteTimeSec: ar.white.timeSec,
    blackTimeSec: ar.black.timeSec,
    moveNumber: ar.moveNumber,
    plyCount: ar.plyCount,
    whiteElo: ar.white.elo,
    blackElo: ar.black.elo,
    whiteFormBonus: wProf.formBonus,
    blackFormBonus: bProf.formBonus,
    opening: ar.opening,
    result: ar.result,
  });
}

async function syncNow(silent = false) {
  if (isSyncing) return;
  isSyncing = true;

  if (!silent) {
    const icon = el.refreshBtn.querySelector('svg');
    if (icon) icon.classList.add('spinning');
    el.refreshLabel.textContent = 'Syncing…';
  }

  try {
    const fresh = await fetchWccSnapshot(selectedRoundId);
    // If a game just went LIVE while user wasn't explicitly locked, jump to LIVE
    if (fresh.isAnyGameLive && !selectedRoundId) {
      selectedRoundId = fresh.activeRound.id;
    }
    snapshot = fresh;
    await chrome.storage.local.set({ [STORAGE_KEY]: fresh });
    renderSnapshot(fresh, true);
    el.statusBar.textContent = `Synced ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch (err) {
    console.warn('[WCC] Sync failed:', err);
    el.statusBar.textContent = snapshot ? 'Cached' : 'Offline';
  } finally {
    isSyncing = false;
    if (!silent) {
      const icon = el.refreshBtn.querySelector('svg');
      if (icon) icon.classList.remove('spinning');
      el.refreshLabel.textContent = 'Sync';
    }
  }
}

function formatScoreNum(n) {
  return Number.isInteger(n) ? `${n}` : `${n}`;
}

function formatEval(evalPawns, mateIn) {
  if (mateIn !== null && mateIn !== undefined) {
    return mateIn > 0 ? `#${mateIn}` : `-#${Math.abs(mateIn)}`;
  }
  const v = Number(evalPawns || 0);
  if (Math.abs(v) < 0.005) return '0.00';
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
}

function renderCountdownOnly(data) {
  const ar = data.activeRound;
  const nr = data.nextRound;
  if (!nr) return;

  const msLeft = nr.startsAt - Date.now();
  const cd = formatCountdown(msLeft);

  if (!data.isAnyGameLive && ar.status === 'FINISHED') {
    el.pulseText.textContent = `NEXT · ${cd}`;
    el.tcText.textContent = `${nr.name} starts in ${cd}`;
  } else if (ar.status === 'UPCOMING') {
    el.pulseText.textContent = `IN ${cd}`;
    el.tcText.textContent = `Starts in ${cd} · ${formatStartTime(ar.startsAt)}`;
  }
}

function formatStartTime(ms) {
  const d = new Date(ms);
  const isToday = new Date().toDateString() === d.toDateString();
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return isToday ? `Today ${timeStr}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${timeStr}`;
}

function renderSnapshot(data, updateClocks = true) {
  const { matchScore, matchExpectancy, activeRound: ar, nextRound, lastFinishedRound, isAnyGameLive } = data;

  // Match score chip
  el.matchScoreSub.textContent = `${formatScoreNum(matchScore.gukesh)} – ${formatScoreNum(matchScore.sindarov)}`;

  // Link to exact Lichess board
  el.lichessLink.href = ar.url || data.tourUrl;

  // Round switcher (cleanly between games when both last & next exist and no game is live)
  if (!isAnyGameLive && lastFinishedRound && nextRound) {
    el.roundSwitcher.hidden = false;
    const resSymbol = lastFinishedRound.result === '1/2-1/2' ? '½–½' : lastFinishedRound.result;
    el.tabLastRound.textContent = `${lastFinishedRound.name} · Final (${resSymbol})`;
    el.tabNextRound.textContent = `Next: ${nextRound.name}`;
    el.tabLastRound.classList.toggle('is-active', ar.id === lastFinishedRound.id);
    el.tabNextRound.classList.toggle('is-active', ar.id === nextRound.id);
  } else {
    el.roundSwitcher.hidden = true;
  }

  // Top-right status pill
  el.statusPill.className = 'status-pill';
  if (ar.status === 'LIVE') {
    el.statusPill.classList.add('is-live');
    el.pulseText.textContent = `LIVE · G${ar.roundNumber}`;
  } else if (ar.status === 'FINISHED') {
    if (nextRound) {
      el.statusPill.classList.add('is-break');
      el.pulseText.textContent = `NEXT · ${formatCountdown(nextRound.startsAt - Date.now())}`;
    } else {
      el.statusPill.classList.add('is-final');
      el.pulseText.textContent = `FINAL · ${ar.result === '1/2-1/2' ? '½–½' : ar.result}`;
    }
  } else {
    el.statusPill.classList.add('is-upcoming');
    el.pulseText.textContent = `IN ${formatCountdown(ar.startsAt - Date.now())}`;
  }

  // Hero Card
  const sTitlePct = (matchExpectancy.sindarov * 100).toFixed(1);
  const gTitlePct = (matchExpectancy.gukesh * 100).toFixed(1);
  const tbPct = (matchExpectancy.tiebreakRisk * 100).toFixed(1);

  if (ar.status === 'FINISHED') {
    const resLabel = ar.result === '1/2-1/2' ? 'Draw (½–½)' : ar.result === '1-0' ? `${ar.white.name} Won` : `${ar.black.name} Won`;
    el.heroTitle.textContent = 'Championship Title Odds';
    el.openingBadge.textContent = `${ar.name}: ${resLabel}`;

    // Bar shows Sindarov vs Gukesh overall title odds
    el.segWhite.style.width = `${sTitlePct}%`;
    el.segDraw.style.width = '0%';
    el.segBlack.style.width = `${gTitlePct}%`;

    el.lblProb1.textContent = 'Sindarov Title';
    el.valProb1.textContent = `${sTitlePct}%`;
    el.lblProb2.textContent = '7–7 Tiebreak';
    el.valProb2.textContent = `${tbPct}%`;
    el.lblProb3.textContent = 'Gukesh Title';
    el.valProb3.textContent = `${gTitlePct}%`;

    el.bannerLabel.textContent = `${ar.name} · ${ar.opening}`;
    el.bannerValue.textContent = `${matchExpectancy.remainingGames} games left`;
  } else {
    // LIVE or UPCOMING game view
    const { gameProbs } = ar;
    const wPct = (gameProbs.whiteWin * 100).toFixed(1);
    const dPct = (gameProbs.draw * 100).toFixed(1);
    const bPct = (gameProbs.blackWin * 100).toFixed(1);

    el.heroTitle.textContent = `${ar.name} Win Probability`;
    el.openingBadge.textContent = ar.opening;

    el.segWhite.style.width = `${wPct}%`;
    el.segDraw.style.width = `${dPct}%`;
    el.segBlack.style.width = `${bPct}%`;

    el.lblProb1.textContent = `${ar.white.name} (W)`;
    el.valProb1.textContent = `${wPct}%`;
    el.lblProb2.textContent = 'Draw';
    el.valProb2.textContent = `${dPct}%`;
    el.lblProb3.textContent = `${ar.black.name} (B)`;
    el.valProb3.textContent = `${bPct}%`;

    el.bannerLabel.textContent = '14-Game Title Odds';
    el.bannerValue.textContent = `Sindarov ${Math.round(matchExpectancy.sindarov * 100)}% · Gukesh ${Math.round(matchExpectancy.gukesh * 100)}%`;
  }

  // Players & Clocks
  el.whiteName.textContent = ar.white.name;
  el.whiteElo.textContent = ar.white.elo;
  el.blackName.textContent = ar.black.name;
  el.blackElo.textContent = ar.black.elo;

  const isEditable = ar.status === 'LIVE';
  el.whiteClock.contentEditable = isEditable ? 'true' : 'false';
  el.blackClock.contentEditable = isEditable ? 'true' : 'false';
  el.whiteClock.classList.toggle('is-editable', isEditable);
  el.blackClock.classList.toggle('is-editable', isEditable);

  if (updateClocks || !isEditingClock) {
    el.whiteClock.textContent = ar.white.timeStr;
    el.blackClock.textContent = ar.black.timeStr;
  }

  // Turn Dot: strictly LIVE only!
  el.whiteTurnDot.classList.toggle('active', ar.status === 'LIVE' && ar.isWhiteTurn);
  el.blackTurnDot.classList.toggle('active', ar.status === 'LIVE' && !ar.isWhiteTurn);

  const { clocks } = ar.gameProbs;
  el.centerTopLabel.textContent = ar.status === 'FINISHED' ? 'FINAL' : 'VS';
  el.deltaChip.textContent = clocks.deltaClockFormatted;

  if (ar.status === 'FINISHED') {
    el.whitePace.textContent = 'Final clock';
    el.blackPace.textContent = 'Final clock';
    el.whitePace.classList.remove('warning');
    el.blackPace.classList.remove('warning');
  } else if (ar.status === 'UPCOMING') {
    el.whitePace.textContent = '120m / 40mv';
    el.blackPace.textContent = '120m / 40mv';
    el.whitePace.classList.remove('warning');
    el.blackPace.classList.remove('warning');
  } else {
    el.whitePace.textContent = `${clocks.tauWMin}m / mv`;
    el.blackPace.textContent = `${clocks.tauBMin}m / mv`;
    el.whitePace.classList.toggle('warning', !clocks.isPhase2 && parseFloat(clocks.tauWMin) < 2.5);
    el.blackPace.classList.toggle('warning', !clocks.isPhase2 && parseFloat(clocks.tauBMin) < 2.5);
  }

  // Bottom strip of clocks card
  el.tcAlert.classList.remove('is-danger');
  if (ar.status === 'LIVE') {
    if (clocks.isPhase2) {
      el.tcText.textContent = 'Move 41+ (+30s increment per move)';
    } else {
      el.tcAlert.classList.add('is-danger');
      el.tcText.textContent = `${clocks.mRem} moves to move 40 (0s increment)`;
    }
  } else if (ar.status === 'FINISHED') {
    el.tcText.textContent = nextRound
      ? `${nextRound.name} starts in ${formatCountdown(nextRound.startsAt - Date.now())}`
      : `${ar.name} finished · ${ar.completedMoves} moves played`;
  } else {
    el.tcText.textContent = `Starts in ${formatCountdown(ar.startsAt - Date.now())} · ${formatStartTime(ar.startsAt)}`;
  }

  // Telemetry Card
  if (ar.status === 'FINISHED') {
    el.movePill.textContent = `${ar.name} Final · ${ar.completedMoves} moves`;
    el.lastMove.textContent = ar.lastMove;
    el.evLbl1.textContent = 'Final Eval';
    el.evVal1.textContent = formatEval(ar.evalPawns, ar.mateIn);
    el.evLbl2.textContent = 'Result';
    el.evVal2.textContent = ar.result === '1/2-1/2' ? '½–½' : ar.result;
    el.evLbl3.textContent = 'Match Score';
    el.evVal3.textContent = `${formatScoreNum(matchScore.gukesh)}–${formatScoreNum(matchScore.sindarov)}`;
  } else if (ar.status === 'UPCOMING') {
    el.movePill.textContent = `${ar.name} · ${formatStartTime(ar.startsAt)}`;
    el.lastMove.textContent = `${ar.white.name} (W)`;
    el.evLbl1.textContent = 'Pre-Game';
    el.evVal1.textContent = '0.00';
    el.evLbl2.textContent = 'Color/Form';
    el.evVal2.textContent = formatEval(ar.gameProbs.formShift, null);
    el.evLbl3.textContent = 'Effective';
    el.evVal3.textContent = formatEval(ar.gameProbs.effectiveEval, null);
  } else {
    const turnLabel = ar.isWhiteTurn ? 'White to move' : 'Black to move';
    el.movePill.textContent = `Move ${ar.moveNumber} · ${turnLabel}`;
    el.lastMove.textContent = ar.lastMove;
    el.evLbl1.textContent = 'Engine Eval';
    el.evVal1.textContent = formatEval(ar.evalPawns, ar.mateIn);
    el.evLbl2.textContent = 'Time Hazard';
    el.evVal2.textContent = formatEval(ar.gameProbs.timeShift, null);
    el.evLbl3.textContent = 'Effective';
    el.evVal3.textContent = formatEval(ar.gameProbs.effectiveEval, ar.mateIn);
  }
}
