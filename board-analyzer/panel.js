import { Chess } from './lib/chess.js';
import { drawBoard, gridFromGame, pieceSrc, squareFromPoint, squareName, startGhost } from './board-view.js';
import { checkPosition, createEditor, fenFrom, guessTurn, homeCastling } from './editor.js';
import { createCropSheet } from './crop-ui.js';
import { createScanFlow } from './scan-flow.js';
import { createEngineClient } from './engine-client.js';
import { chesscomUrl, copyText, lichessUrl, openExternal } from './links.js';
import { findMove, fmtScore, normalizeFen, pvToSan, scoreClass } from './notation.js';
import {
  effectiveGlass, loadCompact, loadDepth, loadGlassMode, loadLines, loadTheme, onSettingsChange,
  saveCompact, saveDepth, saveLines, weakDevice,
} from './settings.js';
import { FREE_LIMITS, THEMES, limitsFor, loadPremium, scansLeft, themeAllowed, useScan } from './plan.js';
import { createScanner } from './scanner/client.js';
import { gridToPlacement, rotateGrid } from './scanner/core.js';

export { chesscomUrl, lichessUrl }; // handy for tests and other pages

const $ = (id) => document.getElementById(id);
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

let flipped = false;
let curFen = null;
let game = null;
let lastAutoFen = null;
let autoTimer = null;

// ---------- plan (Free / Premium) ----------
let premium = false;
let limits = FREE_LIMITS;
let left = FREE_LIMITS.scansPerDay; // picture scans left today on the free plan

// ---------- the page around the panel (told by the host, content.js) ----------
// site: chess site or null; locked: a game is being played on this tab (fair play); board: the page has a chess
// board we can read directly; video: there is a video to read frames from.
let page = { site: null, locked: false, reason: '', board: false, video: false };
let shown = true; // false while the panel is hidden: no engine, no polling

// ---------- engine ----------

const engine = createEngineClient({
  getSettings: () => ({
    multipv: Math.min(limits.maxLines, +$('multipv').value || 3),
    depth: Math.max(8, Math.min(limits.maxDepth, +$('depthMax').value || 20)),
  }),
  onLines: scheduleAnalysisRender,
  onError: (message) => setStatus(message, true),
  hashMb: weakDevice() ? 16 : 64,
});

// The engine reports many lines per second. Drawing them is the costliest thing the panel does, so draw on the next
// frame and then at most about 8 times a second; a weak laptop stays responsive and the numbers are still readable.
const RENDER_GAP = 120;
let renderTimer = null, lastRender = 0;
function scheduleAnalysisRender() {
  if (renderTimer) return;
  const wait = Math.max(0, RENDER_GAP - (Date.now() - lastRender));
  const run = () => { renderTimer = null; lastRender = Date.now(); renderAnalysis(); };
  renderTimer = wait === 0 && typeof window.requestAnimationFrame === 'function'
    ? window.requestAnimationFrame(run) || true
    : setTimeout(run, wait || 16);
}

function analyse() {
  if (!game || page.locked || !shown || editor.isOpen()) return;
  if (game.isGameOver()) engine.stop(); else engine.analyse(curFen);
}

// ---------- turn override ----------

function applyTurnOverride(fen) {
  const o = $('turn').value;
  if (o === 'auto') return fen;
  const f = fen.split(' ');
  f[1] = o;
  f[3] = '-';
  return f.join(' ');
}

// ---------- compact view, style, board colours ----------
// The host header owns the compact button; the panel owns the state (so it persists) and tells the host its width.
let compact = false;
const COMPACT_WIDTH = 296, FULL_WIDTH = 372;

function applyCompact() {
  document.body.classList.toggle('compact', compact);
  parent.postMessage({ type: 'layout', compact, width: compact ? COMPACT_WIDTH : FULL_WIDTH }, '*');
}

function setCompact(on) {
  compact = !!on;
  saveCompact(compact);
  applyCompact();
}

let glassMode = 'auto';
function applyGlass() {
  parent.postMessage({ type: 'glass', on: effectiveGlass(glassMode) }, '*');
}

let themeName = 'classic';
function applyTheme() {
  const t = THEMES[themeAllowed(themeName, premium) ? themeName : 'classic'];
  document.documentElement.style.setProperty('--sq-light', t.light);
  document.documentElement.style.setProperty('--sq-dark', t.dark);
}

// ---------- rendering ----------

const WEAK = 0.85;        // squares the reader is less sure about than this are outlined
let sel = null;           // selected square (click-to-move)
let dragFrom = null;      // square currently being dragged
let history = [];         // undo stack: { fen, lastMove }
let future = [];          // redo stack
let lastMove = null;      // { from, to } of the last move played on the panel
let pendingPromo = null;  // { from, to, color } while the promotion picker is open
let scanInfo = null;      // { weak: Set<square> } while the position on the board came from a picture
let lastShot = null;      // the last picture read, kept so the board can be selected on it
let boardKey = '';        // what the board shows now; it is only rebuilt when that changes

function renderBoard() {
  if (editor.isOpen()) { boardKey = ''; editor.render(); return; }
  if (!game) { $('board').textContent = ''; boardKey = ''; return; }
  const hl = new Set();
  const first = !page.locked && engine.lines[0] && engine.lines[0].pv[0];
  if (first && !sel) { hl.add(first.slice(0, 2)); hl.add(first.slice(2, 4)); }
  if (sel) hl.add(sel);
  const last = new Set(lastMove ? [lastMove.from, lastMove.to] : []);
  const targets = new Map(); // square -> true if it is a capture
  if (sel) {
    for (const m of legalMovesFrom(sel)) targets.set(m.to, !!m.captured || m.flags.includes('e'));
  }
  const weak = scanInfo && scanInfo.weak;
  const key = [curFen, flipped, dragFrom, [...hl].join(), [...last].join(), [...targets].join(), weak ? [...weak].join() : ''].join('|');
  if (key === boardKey) return;
  boardKey = key;
  drawBoard($('board'), {
    grid: gridFromGame(game), flipped, hidden: dragFrom,
    classFor: (name) => (hl.has(name) ? ' hl' : last.has(name) ? ' last' : '') +
      (targets.has(name) ? (targets.get(name) ? ' cap' : ' dot') : '') +
      (weak && weak.has(name) ? ' weak' : ''),
  });
}

// ---------- moving pieces on the panel board (like an analysis board) ----------
// Drag-and-drop or click-click, always on. Either side may move: if you pick up a piece that is not on the move,
// the turn simply follows it (snapshots often guess the side to move, and a wrong guess must never lock the board).

const squareAt = (x, y) => squareFromPoint($('board'), x, y, flipped);
const letterOf = (p) => (p.color === 'w' ? p.type.toUpperCase() : p.type);

// A position in which `color` is the side to move (en passant rights do not carry over a turn flip).
function positionFor(color) {
  if (color === game.turn()) return game;
  const f = curFen.split(' ');
  f[1] = color;
  f[3] = '-';
  try { return new Chess(f.join(' ')); } catch (e) { return null; }
}

function legalMovesFrom(sq) {
  const piece = game && game.get(sq);
  if (!piece) return [];
  const g = positionFor(piece.color);
  return g ? g.moves({ square: sq, verbose: true }) : [];
}

// Following the page or a video would overwrite what you are doing here, so stop it. Returns true if it was on.
function stopFollowing() {
  if (!$('auto').checked) return false;
  $('auto').checked = false;
  $('auto').onchange();
  return true;
}

// Returns true (played), 'promo' (waiting for a promotion choice) or false (illegal).
function tryMove(from, to, promotion) {
  const piece = game.get(from);
  if (!piece) return false;
  const g = positionFor(piece.color);
  if (!g) return false;
  const cands = g.moves({ square: from, verbose: true }).filter((m) => m.to === to);
  if (!cands.length) return false;
  if (cands[0].promotion && !promotion) {
    pendingPromo = { from, to, color: piece.color };
    showPromo();
    return 'promo';
  }
  let m = null;
  try { m = g.move({ from, to, promotion: promotion || undefined }); } catch (e) { m = null; }
  if (!m) return false;
  history.push({ fen: curFen, lastMove });
  future = [];
  $('turn').value = 'auto';
  setPosition(g.fen(), 'played on panel: ' + m.san, { lastMove: { from, to } });
  if (stopFollowing()) setStatus('Follow paused while you play moves here. Press Snapshot to go back to the real position.');
  return true;
}

function showPromo() {
  const box = $('promo');
  box.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'promo-card';
  const names = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' };
  for (const t of ['q', 'r', 'b', 'n']) {
    const btn = document.createElement('button');
    btn.className = 'promo-btn';
    btn.dataset.piece = t;
    btn.title = 'Promote to ' + names[t];
    const img = document.createElement('img');
    img.src = pieceSrc(pendingPromo.color === 'w' ? t.toUpperCase() : t);
    img.alt = names[t];
    img.draggable = false;
    btn.appendChild(img);
    btn.onclick = (ev) => {
      ev.stopPropagation();
      const p = pendingPromo;
      hidePromo();
      if (p) tryMove(p.from, p.to, t);
    };
    card.appendChild(btn);
  }
  box.appendChild(card);
  box.hidden = false;
}

function hidePromo() {
  pendingPromo = null;
  const box = $('promo');
  box.hidden = true;
  box.innerHTML = '';
  renderBoard();
}

function undoMove() {
  if (page.locked) return;
  const prev = history.pop();
  if (!prev) return;
  future.push({ fen: curFen, lastMove });
  $('turn').value = 'auto';
  setPosition(prev.fen, 'undo', { lastMove: prev.lastMove });
}

function redoMove() {
  if (page.locked) return;
  const next = future.pop();
  if (!next) return;
  history.push({ fen: curFen, lastMove });
  $('turn').value = 'auto';
  setPosition(next.fen, 'redo', { lastMove: next.lastMove });
}

let ghost = null;
$('board').addEventListener('pointerdown', (e) => {
  if (editor.isOpen()) { editor.pointer('down', e); return; }
  if (!game || e.button !== 0 || pendingPromo || page.locked) return;
  const sq = squareAt(e.clientX, e.clientY);
  if (!sq) return;
  if (sel && sel !== sq) {
    const r = tryMove(sel, sq);
    if (r === true) { sel = null; return; }
    if (r === 'promo') { sel = null; renderBoard(); return; }
  }
  const piece = game.get(sq);
  if (piece) {
    sel = sq;
    dragFrom = sq;
    ghost = startGhost(letterOf(piece), $('board'), e.clientX, e.clientY);
    try { $('board').setPointerCapture(e.pointerId); } catch (err) { /* synthetic event */ }
  } else {
    sel = null;
  }
  renderBoard();
});
$('board').addEventListener('pointermove', (e) => {
  if (editor.isOpen()) { editor.pointer('move', e); return; }
  if (ghost) ghost.move(e.clientX, e.clientY);
});
$('board').addEventListener('pointerup', (e) => {
  if (editor.isOpen()) { editor.pointer('up', e); return; }
  if (!ghost) return;
  const from = dragFrom;
  ghost.remove(); ghost = null; dragFrom = null;
  const to = squareAt(e.clientX, e.clientY);
  if (to && to !== from) {
    const r = tryMove(from, to);
    if (r === true) { sel = null; return; }
    if (r === 'promo') { sel = null; renderBoard(); return; }
  }
  renderBoard(); // dropped on the same square (keeps the selection for click-click) or illegal
});
$('board').addEventListener('pointercancel', (e) => {
  if (editor.isOpen()) { editor.pointer('cancel', e); return; }
  if (ghost) { ghost.remove(); ghost = null; dragFrom = null; renderBoard(); }
});

// Keyboard: ← undo, → redo, Esc deselect / cancel promotion (ignored while typing in a field or in a sheet).
document.addEventListener('keydown', (e) => {
  if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || '')) return;
  if (upsellOpen()) { if (e.key === 'Escape') closeUpsell(); return; }
  if (editor.isOpen() || cropSheet.isOpen()) return; // they have their own keys
  if (e.key === 'ArrowLeft') { e.preventDefault(); undoMove(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); redoMove(); }
  else if (e.key === 'Escape') { if (pendingPromo) hidePromo(); else { sel = null; renderBoard(); } }
});

function sqCenter(name) {
  const f = name.charCodeAt(0) - 97, r = 8 - +name[1];
  const x = flipped ? 7 - f : f, y = flipped ? 7 - r : r;
  return [x + 0.5, y + 0.5];
}

function arrow(uci, color, width, opacity) {
  const [x1, y1] = sqCenter(uci.slice(0, 2));
  const [x2, y2] = sqCenter(uci.slice(2, 4));
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len, head = 0.38;
  const ex = x2 - ux * head * 0.8, ey = y2 - uy * head * 0.8;
  const px = -uy, py = ux;
  return `<g opacity="${opacity}" fill="${color}" stroke="${color}">
    <line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" stroke-width="${width}" stroke-linecap="round"/>
    <polygon stroke="none" points="${x2},${y2} ${ex + px * head * 0.6},${ey + py * head * 0.6} ${ex - px * head * 0.6},${ey - py * head * 0.6}"/>
  </g>`;
}

// The slim pill the panel shrinks to (minimized) shows the best move, so a video can be watched with the panel small.
let lastSummary = null;
function postSummary(text) {
  if (text === lastSummary) return;
  lastSummary = text;
  parent.postMessage({ type: 'summary', text }, '*');
}

function renderAnalysis() {
  const lines = page.locked ? [] : engine.lines;
  const top = lines[0];
  $('bestMove').textContent = '—';
  $('bestEval').textContent = '';
  $('depth').textContent = '';
  $('lines').innerHTML = '';
  $('arrows').innerHTML = '';
  $('evalbar').classList.toggle('flipped', flipped);
  if (page.locked) { postSummary('Off during the game'); renderBoard(); return; }
  if (game && game.isGameOver()) {
    $('bestMove').textContent = game.isCheckmate() ? 'Checkmate' : 'Game over';
    postSummary($('bestMove').textContent);
    renderBoard();
    return;
  }
  if (!top || !top.pv.length) { renderBoard(); return; }

  const g = new Chess(curFen);
  let san = top.pv[0];
  try { san = g.move({ from: top.pv[0].slice(0, 2), to: top.pv[0].slice(2, 4), promotion: top.pv[0][4] }).san; } catch (e) {}
  $('bestMove').textContent = san;
  $('bestEval').textContent = fmtScore(top);
  $('depth').textContent = 'depth ' + top.depth;
  postSummary(`${san}  ${fmtScore(top)}`);

  let svg = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!l || !l.pv.length) continue;
    svg += i === 0 ? arrow(l.pv[0], '#3fbf3f', 0.14, 0.85) : arrow(l.pv[0], '#4a90e2', 0.09, 0.5);
  }
  $('arrows').innerHTML = svg;

  $('lines').innerHTML = lines
    .map((l) => l && l.pv.length
      ? `<div class="line"><b class="${scoreClass(l)}">${fmtScore(l)}</b> ${pvToSan(curFen, l.pv)}</div>` : '')
    .join('');

  // eval bar (White's share; it turns with the board)
  let pct = 50;
  if (top.mate != null) pct = top.mate > 0 ? 100 : 0;
  else pct = 50 + 50 * (2 / (1 + Math.exp(-top.cp / 250)) - 1);
  $('evalfill').style.height = pct + '%';
  renderBoard();
}

function setStatus(msg, err = false) {
  $('status').textContent = msg;
  $('status').className = err ? 'err' : '';
}

// ---------- flow ----------

// opts: lastMove (highlight), scanWeak (squares to outline: the position came from a picture),
//       keep (same pieces as before: leave the scan note and outlines alone)
function setPosition(rawFen, src, opts = {}) {
  let fen;
  try {
    fen = applyTurnOverride(normalizeFen(rawFen));
    game = new Chess(fen);
  } catch (e) {
    setStatus('Invalid position: ' + (e.message || e), true);
    return false;
  }
  curFen = fen;
  sel = null;
  lastMove = opts.lastMove || null;
  if (!opts.keep) {
    scanInfo = opts.scanWeak ? { weak: opts.scanWeak } : null;
    if (!opts.scanWeak) hideNote();
  }
  if (pendingPromo) { pendingPromo = null; $('promo').hidden = true; $('promo').innerHTML = ''; }
  $('fen').value = fen;
  setStatus(src ? 'Source: ' + src : '');
  if (game.isGameOver()) engine.stop(); else analyse();
  renderBoard();
  renderAnalysis();
  return true;
}

// ---------- the note under the board ----------
// What was read from a picture, how sure the reader is, and what to do about it.

function showNote({ kind = 'info', text, actions = [] }) {
  const n = $('scanNote');
  n.className = kind === 'info' ? 'note' : `note ${kind}`;
  $('noteText').textContent = text;
  const box = $('noteActions');
  box.textContent = '';
  for (const a of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = a.label;
    b.onclick = a.run;
    box.appendChild(b);
  }
  n.hidden = false;
}

function hideNote() {
  $('scanNote').hidden = true;
  lastShot = null; // the picture is only kept while its note can still offer to select the board on it
}

$('noteClose').onclick = () => {
  hideNote();
  if (scanInfo) { scanInfo = null; renderBoard(); } // acknowledged: drop the outlines too
};

// ---------- fair play ----------
// While a game is being played on this tab, nothing is read and nothing is analysed. The host (content.js) decides;
// every read it is asked for is refused while locked, so this is only what the panel shows.

const LOCKABLE = ['snap', 'editBtn', 'pictureBtn', 'auto', 'undo', 'redo', 'flip', 'fen', 'go', 'openLichess', 'openChesscom', 'copyFen', 'turn', 'depthMax', 'multipv'];

function applyLock() {
  const on = !!page.locked;
  document.body.classList.toggle('locked', on);
  $('lock').hidden = !on;
  $('lockText').textContent = page.reason || '';
  $('lockTitle').textContent = page.kind === 'puzzle' ? 'Puzzle in progress' : 'Game in progress';
  for (const id of LOCKABLE) $(id).disabled = on;
  $('followChip').classList.toggle('off', on);
  if (on) {
    stopFollowing();
    engine.stop();
    if (busy) { cycle++; flow.cancel(); setBusy(false); }
    if (editor.isOpen()) $('eCancel').onclick();
    if (cropSheet.isOpen()) cropSheet.close();
    hideNote();
    sel = null;
    setStatus('');
  } else if (wasLocked) {
    setStatus('The game is over: Pawnshot is back on. Press Snapshot to read the final position.');
    analyse();
  }
  wasLocked = on;
  renderAnalysis();
  updateFollowChip();
}
let wasLocked = false;

function updateFollowChip() {
  const label = $('followLabel');
  const chip = $('followChip');
  if (page.board) { label.textContent = 'Follow'; chip.title = 'Keep the board in step with the board on this page'; }
  else if (page.video) { label.textContent = premium ? 'Follow video' : 'Follow video ★'; chip.title = 'Keep the board in step with the video as it plays'; }
  else { label.textContent = 'Follow'; chip.title = 'Follow works on chess.com and lichess boards, and on videos'; }
}

// ---------- reading the page, a video or the screen ----------

// Requests to the host page, answered by a message carrying the same id.
const waits = new Map(); // `${answerType}:${id}` -> { resolve, timer }
let nextId = 0;
function ask(type, answerType, timeoutMs, onTimeout) {
  return new Promise((resolve) => {
    const id = ++nextId;
    const key = `${answerType}:${id}`;
    const timer = setTimeout(() => { if (waits.delete(key)) resolve(onTimeout); }, timeoutMs);
    waits.set(key, { resolve, timer });
    parent.postMessage({ type, id, auto: false }, '*');
  });
}
function answered(d) {
  const key = `${d.type}:${d.id}`;
  const w = waits.get(key);
  if (!w) return false;
  waits.delete(key);
  clearTimeout(w.timer);
  w.resolve(d);
  return true;
}

// The host takes screenshots (it hides this panel first so the panel is not in the picture).
const captureTab = () => ask('capture', 'captured', 8000, { ok: false, error: 'The page did not answer. Paste a screenshot instead.' });
// The board as the page's own data describes it, or null.
const snapshotOnce = () => ask('snapshot', 'snapshot', 2500, null);
// The current picture of the video on the page.
const videoFrame = () => ask('videoFrame', 'videoFrame', 5000, { ok: false, error: 'The page did not answer.' });

function askSnapshot(auto) { // fire and forget: Follow polling on a chess site
  parent.postMessage({ type: 'snapshot', auto }, '*');
}

window.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'toggleCompact') { setCompact(!compact); return; }
  if (d.type === 'page') { onPage(d); return; }
  if (d.type === 'shown') { onShown(!!d.visible); return; }
  if (d.type === 'followFrame') { onFollowFrame(d); return; }
  if (d.type === 'followError') { onFollowError(d.error); return; }
  if (d.id && answered(d)) return;
  if (d.type !== 'snapshot' || d.id) return;
  // a Follow tick on a chess site
  if (d.locked) { onPage({ ...page, locked: true, reason: d.reason || page.reason }); return; }
  if (!d.fen || editor.isOpen() || cropSheet.isOpen()) return; // nothing to show, or busy editing
  if (d.fen === lastAutoFen) return;
  lastAutoFen = d.fen;
  history = []; future = [];
  setPosition(d.fen, d.src);
});

function onPage(info) {
  const lockChanged = !!info.locked !== !!page.locked || (info.locked && info.reason !== page.reason);
  page = { site: info.site || null, locked: !!info.locked, kind: info.kind || null, reason: info.reason || '', board: !!info.board, video: !!info.video };
  if (lockChanged) applyLock(); else updateFollowChip();
  if (follow.mode === 'video' && !page.video) stopFollowing();
}

function onShown(visible) {
  if (visible === shown) return;
  shown = visible;
  if (!visible) {
    stopFollowing();
    engine.stop();
  } else {
    analyse();
    renderAnalysis();
    refreshPlan();
  }
}

const STAGE_LABEL = { capturing: 'Capturing…', loading: 'Loading reader…', locating: 'Finding board…', reading: 'Reading pieces…' };
const SNAP_TITLE = $('snap').title;
let busy = false;
let cycle = 0;       // bumps whenever a read starts or is cancelled; a late answer from an older read is ignored

function setBusy(on, label) {
  busy = on;
  $('snap').classList.toggle('busy', on);
  $('snap').setAttribute('aria-busy', on ? 'true' : 'false');
  $('snap').title = on ? 'Click to cancel' : SNAP_TITLE;
  $('snapLabel').textContent = on ? label || 'Reading…' : 'Snapshot';
}

const flow = createScanFlow({
  capture: captureTab,
  makeScanner: (onStage) => createScanner({ onStage }),
  onStage: (stage) => { if (busy && STAGE_LABEL[stage]) $('snapLabel').textContent = STAGE_LABEL[stage]; },
});

function lowMemoryHint() {
  if (weakDevice()) setStatus('This device is on the slow side, so reading a picture may take a few seconds.');
}

// The free plan reads a few pictures a day. Returns false (and explains) when today's are used up.
async function canScan() {
  if (premium) return true;
  left = await scansLeft(false);
  updatePlanText();
  if (left > 0) return true;
  openUpsell('scans');
  return false;
}

async function countScan(out) {
  if (premium || !out.ok || !out.result || out.result.pieces < 3) return;
  left = await useScan(false);
  updatePlanText();
}

// Read the current video frame. -> the scan flow's outcome, or null when there is no readable video.
async function readVideo() {
  const v = await videoFrame();
  if (v.locked) { onPage({ ...page, locked: true, reason: v.error }); return { ok: false, kind: 'cancelled' }; }
  if (!v.ok || !v.blob) return null;
  const out = await flow.scanBlob(v.blob, null, 'video');
  if (out.ok) out.frameSize = v.size;
  return out;
}

// Snapshot: the page's own board data when the page has a chess board (exact, with turn and castling),
// otherwise the video on the page, otherwise a picture of the whole screen. Shift+click always takes the screenshot.
async function snapshot(ev) {
  if (page.locked) return;
  if (busy) { cycle++; flow.cancel(); setBusy(false); setStatus('Cancelled.'); return; }
  const token = ++cycle;
  lastAutoFen = null;
  hideNote();
  setBusy(true, 'Reading…');
  const shift = !!(ev && ev.shiftKey);
  if (!shift) {
    const s = await snapshotOnce();
    if (token !== cycle) return;
    if (s && s.locked) { setBusy(false); onPage({ ...page, locked: true, reason: s.reason }); return; }
    if (s && s.fen) {
      setBusy(false);
      history = []; future = [];
      setPosition(s.fen, s.src);
      return;
    }
  }
  if (!(await canScan())) { if (token === cycle) setBusy(false); return; }
  if (token !== cycle) return;
  lowMemoryHint();
  if (!shift && page.video) {
    setBusy(true, 'Reading video…');
    const out = await readVideo();
    if (token !== cycle) return;
    if (out && (out.kind === 'cancelled' || (out.ok && out.result.pieces >= 3))) {
      setBusy(false);
      if (out.ok) { rememberVideoBoard(out); countScan(out); }
      handleOutcome(out);
      return;
    }
    // no board in the video picture (or it can't be read): look at the whole screen instead
  }
  const out = await flow.scanScreen();
  if (token !== cycle) return;
  setBusy(false);
  countScan(out);
  handleOutcome(out);
}

// A picture the person chose, pasted or dropped, or the boxed part of the last one.
async function readPicture(blob, crop = null) {
  if (page.locked) return;
  if (busy) { cycle++; flow.cancel(); }
  const token = ++cycle;
  hideNote();
  setBusy(true, 'Reading…');
  if (!(await canScan())) { if (token === cycle) setBusy(false); return; }
  lowMemoryHint();
  const out = await flow.scanBlob(blob, crop, 'picture');
  if (token !== cycle) return;
  setBusy(false);
  countScan(out);
  handleOutcome(out);
}

function acceptPicture(file) {
  if (!file || !/^image\//.test(file.type || '')) {
    showNote({ kind: 'err', text: 'That is not a picture. Use a PNG, JPEG or WebP image.' });
    return;
  }
  readPicture(file);
}

function handleOutcome(out) {
  if (out.kind === 'cancelled') return;
  if (out.blob) lastShot = out.blob;
  if (out.ok) { applyScan(out); return; }
  const pick = { label: 'Choose a picture…', run: () => $('pictureInput').click() };
  const select = { label: 'Select board…', run: openCrop };
  if (out.kind === 'capture') {
    showNote({ kind: 'err', text: out.error, actions: [pick] });
  } else {
    showNote({
      kind: 'err',
      text: 'The board could not be read: ' + out.error,
      actions: [{ label: 'Try again', run: () => (out.blob ? readPicture(out.blob) : snapshot()) }, select, pick],
    });
  }
}

function openCrop() { if (lastShot) cropSheet.open(lastShot); }

// A square as drawn in the picture (row, column from the top-left) to its name.
const drawnSquare = (r, c, blackAtBottom) => (blackAtBottom ? squareName(7 - r, 7 - c) : squareName(r, c));
// The same square seen from the other end of the board (a1 <-> h8).
const rotateSquare = (name) => squareName(+name[1] - 1, 104 - name.charCodeAt(0));
const weakSquares = (res, black) => {
  const weak = new Set();
  (res.squareConfidence || []).forEach((c, i) => { if (c < WEAK) weak.add(drawnSquare(i >> 3, i & 7, black)); });
  return weak;
};

// Show a position that came from a picture straight on the board and start analysing it.
// If it cannot be a real position, open the editor on it instead so it can be fixed.
function applyScan(out) {
  const res = out.result;
  const black = res.bottom === 'black';
  const grid = black ? rotateGrid(res.grid) : res.grid;
  const weak = weakSquares(res, black);
  const turn = guessTurn(grid);
  const castle = homeCastling(grid);
  const select = { label: 'Select board…', run: openCrop };
  if (checkPosition(grid, turn)) {
    if (res.pieces < 3) {
      showNote({
        kind: 'err',
        text: `I could not find a chess board in the ${out.source}. Select the board, or try a clearer picture.`,
        actions: [select, { label: 'Choose a picture…', run: () => $('pictureInput').click() }],
      });
      return;
    }
    openEditor({ grid, flipped: black, turn, castle, weak });
    return;
  }
  adopt({ grid, flipped: black, turn, castle, weak, src: `scanned from the ${out.source}`, unsure: res.orientationUnsure, verb: `Scanned from the ${out.source}`, video: out.source === 'video' });
}

// Put a position on the board and say what it is.
function adopt({ grid, flipped: view, turn, castle, weak, src, unsure, verb, video }) {
  history = []; future = [];
  $('turn').value = 'auto';
  flipped = view; // show the board the way the picture showed it
  lastAutoFen = null;
  if (follow.mode !== 'video') stopFollowing();
  setPosition(fenFrom({ grid, turn, castle }), src, { scanWeak: weak });
  const parts = [`${verb} · ${turn === 'w' ? 'White' : 'Black'} to move.`];
  if (unsure) parts.push('Not sure which side is at the bottom.');
  if (weak.size) parts.push(`${weak.size} uncertain square${weak.size > 1 ? 's' : ''} outlined.`);
  const doubtful = unsure || weak.size > 0;
  const actions = [{ label: 'Edit', run: editCurrent }];
  if (unsure) actions.push({ label: 'Wrong way up', run: turnAround });
  if (doubtful && lastShot) actions.push({ label: 'Select board…', run: openCrop });
  if (video && follow.mode !== 'video') actions.push({ label: premium ? 'Follow video' : 'Follow video ★', run: () => { $('auto').checked = true; $('auto').onchange(); } });
  if (!premium && left <= 3) parts.push(`${left} free scan${left === 1 ? '' : 's'} left today.`);
  showNote({ kind: doubtful ? 'warn' : 'info', text: parts.join(' '), actions });
}

// The reader guessed the wrong side at the bottom: the same pieces, seen from the other end.
function turnAround() {
  if (!game) return;
  const grid = rotateGrid(gridFromGame(game));
  const weak = new Set([...(scanInfo ? scanInfo.weak : [])].map(rotateSquare));
  const turn = game.turn();
  const castle = homeCastling(grid);
  const view = !flipped;
  if (checkPosition(grid, turn)) { openEditor({ grid, flipped: view, turn, castle, weak }); return; }
  adopt({ grid, flipped: view, turn, castle, weak, src: 'turned around', unsure: false, verb: 'Turned around' });
}

// ---------- Follow ----------
// On chess.com and lichess: re-read the page's board data every 0.8 s (free).
// On a video (Premium): the host watches the board area in the video and sends it over whenever the position has
// changed; the panel reads it and, when it is one legal move away, plays that move, so turn, castling and the move
// history (← / →) stay right.

const follow = { mode: null, board: null, fails: 0, relocating: false };

function videoBoardOf(out) {
  const r = out && out.result;
  const size = (out && out.frameSize) || (r && r.imageSize);
  if (!r || !r.corners || !size) return null;
  const xs = r.corners.map((p) => p[0]), ys = r.corners.map((p) => p[1]);
  const b = [Math.min(...xs) / size[0], Math.min(...ys) / size[1], Math.max(...xs) / size[0], Math.max(...ys) / size[1]];
  return b.every((v) => Number.isFinite(v)) && b[2] - b[0] > 0.05 && b[3] - b[1] > 0.05 ? b.map((v) => Math.max(0, Math.min(1, v))) : null;
}

let videoBoard = null; // where the board was in the last video frame read, as fractions of the frame
function rememberVideoBoard(out) {
  videoBoard = videoBoardOf(out);
  if (follow.mode === 'video' && videoBoard) parent.postMessage({ type: 'followStart', board: videoBoard }, '*');
}

async function startVideoFollow() {
  follow.mode = 'video'; // first, so reading the first position does not switch Follow off again
  follow.fails = 0;
  if (!videoBoard) {
    setBusy(true, 'Finding the board…');
    const out = await readVideo();
    setBusy(false);
    if (!$('auto').checked || follow.mode !== 'video') return;
    if (!out || !out.ok || out.result.pieces < 3) {
      stopFollowing();
      showNote({ kind: 'err', text: 'No chess board found in the video right now. Pause on a board and try again.' });
      return;
    }
    videoBoard = videoBoardOf(out);
    handleOutcome(out);
    if (!videoBoard) { stopFollowing(); return; }
  }
  follow.board = videoBoard;
  parent.postMessage({ type: 'followStart', board: videoBoard }, '*');
  setStatus('Following the video. Moves on the board update by themselves; ← and → step through them.');
}

async function onFollowFrame(d) {
  const done = (interval) => parent.postMessage({ type: 'followDone', interval }, '*');
  if (follow.mode !== 'video' || busy || page.locked || editor.isOpen() || cropSheet.isOpen() || !d.blob) { done(); return; }
  const t0 = Date.now();
  const size = d.size || [1, 1];
  const box = Array.isArray(d.box) ? [d.box[0] * size[0], d.box[1] * size[1], d.box[2] * size[0], d.box[3] * size[1]] : null;
  const out = await flow.scanBlob(d.blob, null, 'video', box ? { box } : {});
  // a weak device gets more time between reads
  done(Math.max(700, Math.min(4000, 2 * (Date.now() - t0))));
  if (follow.mode !== 'video' || out.kind === 'cancelled') return;
  followResult(out);
}

function followResult(out) {
  const res = out.ok && out.result;
  if (!res || res.pieces < 3 || res.confidence < 0.5) { followMiss(); return; }
  // keep the way up the board already has unless the picture is sure
  const black = res.orientationUnsure ? flipped : res.bottom === 'black';
  const grid = black ? rotateGrid(res.grid) : res.grid;
  const weak = weakSquares(res, black);
  const placement = gridToPlacement(grid);
  if (curFen && placement === curFen.split(' ')[0]) { follow.fails = 0; return; } // a highlight or arrow changed, not the position
  const mv = curFen && findMove(curFen, placement);
  if (mv) {
    follow.fails = 0;
    history.push({ fen: curFen, lastMove });
    future = [];
    flipped = black;
    $('turn').value = 'auto';
    setPosition(mv.fen, 'video: ' + mv.san, { lastMove: { from: mv.from, to: mv.to }, scanWeak: weak.size ? weak : null });
    return;
  }
  // not one move away: the video jumped, or a misread. Only take it if it is a real position and fairly sure.
  const turn = guessTurn(grid);
  if (checkPosition(grid, turn) || weak.size > 3) { followMiss(); return; }
  follow.fails = 0;
  if (curFen) history.push({ fen: curFen, lastMove });
  future = [];
  flipped = black;
  $('turn').value = 'auto';
  setPosition(fenFrom({ grid, turn, castle: homeCastling(grid) }), 'from the video', { scanWeak: weak.size ? weak : null });
}

// The board area no longer reads well: after a few misses look for the board in the whole frame again.
async function followMiss() {
  follow.fails++;
  if (follow.fails === 3 && !follow.relocating) {
    follow.relocating = true;
    const out = await readVideo();
    follow.relocating = false;
    if (follow.mode !== 'video') return;
    if (out && out.ok && out.result.pieces >= 3) {
      const b = videoBoardOf(out);
      if (b) { videoBoard = b; follow.board = b; parent.postMessage({ type: 'followStart', board: b }, '*'); }
      follow.fails = 0;
      followResult(out);
      return;
    }
  }
  if (follow.fails === 6) {
    showNote({ kind: 'warn', text: 'Lost the board in the video. Following keeps looking; press Snapshot to find it now.' });
  }
}

function onFollowError(error) {
  if (follow.mode !== 'video') return;
  stopFollowing();
  showNote({ kind: 'err', text: (error || 'This video cannot be followed.') + ' Snapshot still works with a screenshot (Shift+click).' });
}

function stopVideoFollow() {
  if (follow.mode === 'video') parent.postMessage({ type: 'followStop' }, '*');
  follow.mode = null;
  follow.fails = 0;
}

$('auto').onchange = () => {
  clearInterval(autoTimer);
  autoTimer = null;
  lastAutoFen = null;
  stopVideoFollow();
  if (!$('auto').checked) return;
  if (page.locked) { $('auto').checked = false; return; }
  if (page.board) {
    follow.mode = 'dom';
    askSnapshot(true);
    autoTimer = setInterval(() => { if (shown && !document.hidden) askSnapshot(true); }, 800);
  } else if (page.video) {
    if (!limits.follow) { $('auto').checked = false; openUpsell('follow'); return; }
    startVideoFollow();
  } else {
    $('auto').checked = false;
    setStatus('Nothing to follow here. Follow works on chess.com and lichess boards, and on videos.');
  }
};

// ---------- editing the position ----------

const rightsFrom = (field) => ({ K: /K/.test(field), Q: /Q/.test(field), k: /k/.test(field), q: /q/.test(field) });

function openEditor(spec) {
  engine.stop();
  hideNote();
  editor.open(spec);
}

function editCurrent() {
  if (!game || page.locked) return;
  openEditor({
    grid: gridFromGame(game), flipped, turn: game.turn(), castle: rightsFrom(curFen.split(' ')[2]),
    weak: scanInfo ? scanInfo.weak : [],
  });
}

const editor = createEditor({
  $,
  onDone: ({ grid, turn, castle, flipped: view }) => {
    if (curFen) history.push({ fen: curFen, lastMove });
    future = [];
    $('turn').value = 'auto';
    flipped = view;
    const wasFollowing = stopFollowing();
    setPosition(fenFrom({ grid, turn, castle }), 'edited on the panel');
    if (wasFollowing) setStatus('Follow is off while you edit. Press Snapshot to go back to the page.');
  },
  onCancel: ({ flipped: view }) => {
    flipped = view;
    boardKey = '';
    renderBoard();
    if (game && !game.isGameOver()) { analyse(); renderAnalysis(); } // it was paused while editing
  },
});

const cropSheet = createCropSheet({ $, onRead: (blob, crop) => readPicture(blob, crop), onCancel: () => {} });

// ---------- Premium ----------

const UPSELL_WHY = {
  scans: `You have used today's ${FREE_LIMITS.scansPerDay} free scans. They come back tomorrow, or go unlimited with Premium.`,
  follow: 'Following a video move by move is part of Premium.',
  depth: `The free plan searches up to depth ${FREE_LIMITS.maxDepth} with ${FREE_LIMITS.maxLines} lines. Premium goes to depth 30 with 5 lines.`,
  info: 'Pawnshot is free to use. Premium lifts the limits and adds a few extras.',
};
const upsellOpen = () => document.body.classList.contains('upsell');
function openUpsell(reason) {
  $('upsellWhy').textContent = UPSELL_WHY[reason] || UPSELL_WHY.info;
  document.body.classList.add('upsell');
}
function closeUpsell() { document.body.classList.remove('upsell'); }

function openOptions(section) {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'openOptions', section });
      return;
    }
  } catch (e) { /* fall back to a plain link */ }
  openExternal('options.html' + (section ? '#' + section : ''));
}

function updatePlanText() {
  const t = $('planText');
  if (premium) {
    t.textContent = '★ Premium';
    t.className = 'premium';
    $('planBtn').hidden = true;
    return;
  }
  t.textContent = left > 0 ? `Free · ${left} scan${left === 1 ? '' : 's'} left today` : 'Free · no scans left today';
  t.className = left <= 2 ? 'low' : '';
  $('planBtn').hidden = false;
}

function applyLimits() {
  limits = limitsFor(premium);
  $('depthMax').max = String(limits.maxDepth);
  if (+$('depthMax').value > limits.maxDepth) $('depthMax').value = String(limits.maxDepth);
  if (+$('multipv').value > limits.maxLines) $('multipv').value = String(limits.maxLines);
  for (const o of $('multipv').options) o.textContent = +o.value > FREE_LIMITS.maxLines && !premium ? `${o.value} ★` : o.value;
  applyTheme();
  updateFollowChip();
}

async function refreshPlan() {
  const was = premium;
  try { premium = await loadPremium(); } catch (e) { premium = false; }
  left = await scansLeft(premium);
  applyLimits();
  updatePlanText();
  if (was && !premium && follow.mode === 'video') stopFollowing();
}

$('upsellClose').onclick = closeUpsell;
$('upsellGo').onclick = () => { closeUpsell(); openOptions('premium'); };
$('planBtn').onclick = () => openUpsell('info');
$('settingsBtn').onclick = () => openOptions('');

// ---------- pictures from files, the clipboard and drag-and-drop ----------

$('pictureBtn').onclick = () => $('pictureInput').click();
$('pictureInput').onchange = (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (f) acceptPicture(f);
};
const busyEditing = () => editor.isOpen() || cropSheet.isOpen() || upsellOpen() || page.locked;
document.addEventListener('paste', (e) => {
  if (busyEditing()) return;
  const item = Array.from((e.clipboardData && e.clipboardData.items) || []).find((it) => it.kind === 'file' && /^image\//.test(it.type || ''));
  if (!item) return;
  e.preventDefault();
  acceptPicture(item.getAsFile());
});
const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
document.addEventListener('dragover', (e) => { if (hasFiles(e) && !busyEditing()) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  if (!hasFiles(e) || busyEditing()) return;
  e.preventDefault();
  const f = Array.from(e.dataTransfer.files || []).find((x) => /^image\//.test(x.type || ''));
  if (f) acceptPicture(f);
});

// ---------- wiring ----------

$('snap').onclick = snapshot;
$('editBtn').onclick = editCurrent;
$('undo').onclick = undoMove;
$('redo').onclick = redoMove;
$('go').onclick = () => setPosition($('fen').value);
$('fen').addEventListener('keydown', (e) => { if (e.key === 'Enter') setPosition($('fen').value); });
$('flip').onclick = () => { flipped = !flipped; renderBoard(); renderAnalysis(); };
$('turn').onchange = () => curFen && setPosition(curFen, undefined, { keep: true });
$('multipv').onchange = () => {
  if (+$('multipv').value > limits.maxLines) { $('multipv').value = String(limits.maxLines); openUpsell('depth'); }
  saveLines(+$('multipv').value);
  if (curFen) setPosition(curFen, undefined, { keep: true });
};
$('depthMax').onchange = () => {
  let d = Math.round(+$('depthMax').value || 20);
  if (d > limits.maxDepth) { d = limits.maxDepth; openUpsell('depth'); }
  d = Math.max(8, d);
  $('depthMax').value = String(d);
  saveDepth(d);
  if (curFen) setPosition(curFen, undefined, { keep: true });
};

$('openLichess').onclick = () => curFen && openExternal(lichessUrl(curFen, flipped));
$('openChesscom').onclick = () => curFen && openExternal(chesscomUrl(curFen, flipped));
$('copyFen').onclick = async () => {
  if (!curFen) return;
  const ok = await copyText(curFen);
  setStatus(ok ? 'FEN copied to the clipboard' : 'Copy was blocked by the browser', !ok);
};

// Settings changed on the options page (or in another tab): apply them here too.
onSettingsChange((ch) => {
  if ('glassMode' in ch) { glassMode = ch.glassMode || 'auto'; applyGlass(); }
  if ('boardTheme' in ch) { themeName = ch.boardTheme || 'classic'; applyTheme(); }
  if ('compactMode' in ch && !!ch.compactMode !== compact) { compact = !!ch.compactMode; applyCompact(); }
  if ('license' in ch) refreshPlan();
});

async function boot() {
  const [mode, isCompact, theme, depth, lines] = await Promise.all([loadGlassMode(), loadCompact(), loadTheme(), loadDepth(), loadLines()]);
  glassMode = mode; applyGlass();
  compact = isCompact; applyCompact();
  themeName = theme;
  const engineChanged = $('depthMax').value !== String(depth) || $('multipv').value !== String(lines);
  $('depthMax').value = String(depth);
  $('multipv').value = String(lines);
  await refreshPlan();
  if (engineChanged) analyse(); // search again with the saved depth / lines
  try { if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) chrome.runtime.sendMessage({ type: 'checkLicense' }); } catch (e) { /* tests */ }
}

setPosition(START);
boot();
parent.postMessage({ type: 'hello' }, '*'); // the host answers with what it knows about the page

// Tell the host how tall the panel is, now and whenever the content changes (more engine lines, status text...).
let lastHeight = 0;
function reportHeight() {
  const h = Math.ceil(document.body.getBoundingClientRect().height) + 4;
  if (h === lastHeight) return;
  lastHeight = h;
  parent.postMessage({ type: 'height', height: h }, '*');
}
reportHeight();
if (typeof ResizeObserver === 'function') new ResizeObserver(reportHeight).observe(document.body);

window.__panel = { editor, cropSheet, flow, follow }; // for the offline tests; invisible to web pages (extension origin)
