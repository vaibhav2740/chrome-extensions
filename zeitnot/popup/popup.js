// WCC Live Pulse - Popup Controller
import {
  fetchWccSnapshot,
  formatClockSeconds,
  formatCountdown,
  resolveAnchoredSnapshot,
  tryParseClockSeconds,
} from '../shared/wcc_data.js';
import {
  calculateGameProbabilities,
  identifyPlayer,
} from '../shared/probability_engine.js';

const STORAGE_KEY = 'wccPulseStateV2';
const ANCHOR_KEY = 'wccClockAnchorV2';

const el = {
  matchScoreSub: document.getElementById('matchScoreSub'),
  statusPill: document.getElementById('statusPill'),
  pulseText: document.getElementById('pulseText'),
  roundSwitcher: document.getElementById('roundSwitcher'),
  prevRoundBtn: document.getElementById('prevRoundBtn'),
  tabLastRound: document.getElementById('tabLastRound'),
  tabNextRound: document.getElementById('tabNextRound'),
  nextRoundBtn: document.getElementById('nextRoundBtn'),
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
let lastStartRefreshAt = 0;

document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();

  try {
    const cached = await chrome.storage.local.get([STORAGE_KEY, ANCHOR_KEY]);
    if (cached[STORAGE_KEY]) {
      const reconciled = resolveAnchoredSnapshot(cached[STORAGE_KEY], cached[ANCHOR_KEY] || null);
      snapshot = reconciled.snapshot;
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
    const target = snapshot?.lastFinishedRound || snapshot?.rounds?.[0];
    if (!target) return;
    selectedRoundId = target.id;
    await syncNow(false);
  });

  el.tabNextRound.addEventListener('click', async () => {
    const live = snapshot?.rounds?.find((r) => r.status === 'LIVE');
    const target = live || snapshot?.nextRound;
    if (!target) return;
    selectedRoundId = target.id;
    await syncNow(false);
  });

  el.prevRoundBtn.addEventListener('click', async () => stepRound(-1));
  el.nextRoundBtn.addEventListener('click', async () => stepRound(1));

  setupEditableClock(el.whiteClock, 'white');
  setupEditableClock(el.blackClock, 'black');
}

async function stepRound(delta) {
  const rounds = snapshot?.rounds || [];
  if (rounds.length === 0) return;
  const idx = rounds.findIndex((r) => r.id === snapshot.activeRound.id);
  const nextIdx = Math.max(0, Math.min(rounds.length - 1, (idx === -1 ? 0 : idx) + delta));
  if (nextIdx === idx) return;
  selectedRoundId = rounds[nextIdx].id;
  await syncNow(false);
}

function flashClockState(clockEl, className) {
  clockEl.classList.remove('is-calibrated', 'is-invalid');
  void clockEl.offsetWidth; // trigger reflow for repeated feedback
  clockEl.classList.add(className);
  setTimeout(() => clockEl.classList.remove(className), 750);
}

function setupEditableClock(clockEl, color) {
  clockEl.addEventListener('focus', () => {
    if (snapshot?.activeRound?.status !== 'LIVE') {
      clockEl.blur();
      return;
    }
    isEditingClock = true;
  });

  clockEl.addEventListener('blur', async () => {
    if (!isEditingClock) return;
    isEditingClock = false;
    if (snapshot?.activeRound?.status !== 'LIVE') return;

    const ar = snapshot.activeRound;
    const sec = tryParseClockSeconds(clockEl.textContent);
    if (sec === null) {
      clockEl.textContent = color === 'white' ? ar.white.timeStr : ar.black.timeStr;
      flashClockState(clockEl, 'is-invalid');
      return;
    }

    if (color === 'white') {
      ar.white.timeSec = sec;
      ar.white.timeStr = formatClockSeconds(sec);
    } else {
      ar.black.timeSec = sec;
      ar.black.timeStr = formatClockSeconds(sec);
    }

    const calibratedAnchor = {
      roundId: ar.id,
      plyCount: ar.plyCount,
      whiteBaseSec: ar.white.timeSec,
      blackBaseSec: ar.black.timeSec,
      anchoredAt: Date.now(),
      isUserCalibrated: true,
    };

    recomputeLiveRoundProbs();
    await chrome.storage.local.set({
      [STORAGE_KEY]: snapshot,
      [ANCHOR_KEY]: calibratedAnchor,
    });
    chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', snapshot }).catch(() => {});
    renderSnapshot(snapshot, true);
    flashClockState(clockEl, 'is-calibrated');
    el.statusBar.textContent = `Calibrated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  });

  clockEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clockEl.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      isEditingClock = false;
      const ar = snapshot?.activeRound;
      if (ar) clockEl.textContent = color === 'white' ? ar.white.timeStr : ar.black.timeStr;
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
      renderCountdownOnly(snapshot);
      const msLeft = snapshot.nextRound.startsAt - Date.now();
      // Auto-refresh cleanly once round start wall-clock time arrives
      if (msLeft <= 0 && Date.now() - lastStartRefreshAt > 15000) {
        lastStartRefreshAt = Date.now();
        syncNow(true);
      }
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
    if (fresh.isAnyGameLive && !selectedRoundId) {
      selectedRoundId = fresh.activeRound.id;
    }

    const stored = await chrome.storage.local.get([ANCHOR_KEY]);
    const prevAnchor = stored[ANCHOR_KEY] || null;
    const { snapshot: anchored, anchor } = resolveAnchoredSnapshot(fresh, prevAnchor);

    snapshot = anchored;
    await chrome.storage.local.set({
      [STORAGE_KEY]: anchored,
      [ANCHOR_KEY]: anchor,
    });
    chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', snapshot: anchored }).catch(() => {});

    renderSnapshot(anchored, true);
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
  } else if (ar.status === 'UPCOMING' && ar.startsAt) {
    const roundCd = formatCountdown(ar.startsAt - Date.now());
    el.pulseText.textContent = `IN ${roundCd}`;
    el.tcText.textContent = `Starts in ${roundCd} · ${formatStartTime(ar.startsAt)}`;
  }
}

function formatStartTime(ms) {
  if (!ms) return 'Scheduled';
  const d = new Date(ms);
  const isToday = new Date().toDateString() === d.toDateString();
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return isToday ? `Today ${timeStr}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${timeStr}`;
}

function renderSnapshot(data, updateClocks = true) {
  const { matchScore, matchExpectancy, activeRound: ar, nextRound, lastFinishedRound, rounds = [] } = data;

  el.matchScoreSub.textContent = `${matchScore.gukesh} – ${matchScore.sindarov}`;
  el.lichessLink.href = ar.url || data.tourUrl;

  // Segmented round navigator across all 14 games
  if (rounds.length > 1) {
    el.roundSwitcher.hidden = false;
    const curIdx = rounds.findIndex((r) => r.id === ar.id);
    el.prevRoundBtn.disabled = curIdx <= 0;
    el.nextRoundBtn.disabled = curIdx === -1 || curIdx >= rounds.length - 1;

    const liveRound = rounds.find((r) => r.status === 'LIVE');
    if (lastFinishedRound) {
      const resSym = lastFinishedRound.result === '1/2-1/2' ? '½–½' : lastFinishedRound.result;
      el.tabLastRound.textContent = `${lastFinishedRound.name} · ${resSym}`;
      el.tabLastRound.disabled = false;
      el.tabLastRound.classList.toggle('is-active', ar.id === lastFinishedRound.id);
    } else {
      el.tabLastRound.textContent = 'Game 1';
      el.tabLastRound.disabled = false;
      el.tabLastRound.classList.toggle('is-active', curIdx === 0);
    }

    const focusUpcoming = liveRound || nextRound;
    if (focusUpcoming) {
      el.tabNextRound.textContent = liveRound ? `Live: ${liveRound.name}` : `Next: ${focusUpcoming.name}`;
      el.tabNextRound.disabled = false;
      el.tabNextRound.classList.toggle('is-active', ar.id === focusUpcoming.id);
    } else {
      el.tabNextRound.textContent = 'Match Complete';
      el.tabNextRound.disabled = true;
      el.tabNextRound.classList.remove('is-active');
    }
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
    el.pulseText.textContent = `IN ${formatCountdown((ar.startsAt || 0) - Date.now())}`;
  }

  // Hero Card
  const sTitlePct = (matchExpectancy.sindarov * 100).toFixed(1);
  const gTitlePct = (matchExpectancy.gukesh * 100).toFixed(1);
  const tbPct = (matchExpectancy.tiebreakRisk * 100).toFixed(1);

  if (ar.status === 'FINISHED') {
    const resLabel = ar.result === '1/2-1/2' ? 'Draw (½–½)' : ar.result === '1-0' ? `${ar.white.name} Won` : `${ar.black.name} Won`;
    el.heroTitle.textContent = 'Championship Odds';
    el.openingBadge.textContent = `${ar.name}: ${resLabel}`;
    el.openingBadge.title = `${ar.name}: ${resLabel}`;

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
    const { gameProbs } = ar;
    const wPct = (gameProbs.whiteWin * 100).toFixed(1);
    const dPct = (gameProbs.draw * 100).toFixed(1);
    const bPct = (gameProbs.blackWin * 100).toFixed(1);

    el.heroTitle.textContent = `${ar.name} Win Odds`;
    el.openingBadge.textContent = ar.opening;
    el.openingBadge.title = ar.opening;

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
  el.whiteClock.title = isEditable ? 'Click to calibrate with live stream' : 'Game clock';
  el.blackClock.title = isEditable ? 'Click to calibrate with live stream' : 'Game clock';

  if (updateClocks || !isEditingClock) {
    el.whiteClock.textContent = ar.white.timeStr;
    el.blackClock.textContent = ar.black.timeStr;
  }

  el.whiteTurnDot.classList.toggle('active', ar.status === 'LIVE' && ar.isWhiteTurn);
  el.blackTurnDot.classList.toggle('active', ar.status === 'LIVE' && !ar.isWhiteTurn);

  const { clocks } = ar.gameProbs;
  el.whiteClock.classList.toggle('is-zeitnot', ar.status === 'LIVE' && clocks.stressW >= 0.45);
  el.blackClock.classList.toggle('is-zeitnot', ar.status === 'LIVE' && clocks.stressB >= 0.45);

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
    el.tcText.textContent = `Starts in ${formatCountdown((ar.startsAt || 0) - Date.now())} · ${formatStartTime(ar.startsAt)}`;
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
    el.evVal3.textContent = `${matchScore.gukesh}–${matchScore.sindarov}`;
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
