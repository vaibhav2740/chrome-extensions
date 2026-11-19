import { Chess } from './lib/chess.js';
import { drawBoard, gridFromGame, pieceSrc, squareFromPoint, squareName, startGhost } from './board-view.js';
import { checkPosition, createEditor, fenFrom, guessTurn, homeCastling } from './editor.js';
import { createCropSheet } from './crop-ui.js';
import { createScanFlow } from './scan-flow.js';
import { createEngineClient } from './engine-client.js';
import { chesscomUrl, copyText, lichessUrl, openExternal } from './links.js';
import { fmtScore, normalizeFen, pvToSan, scoreClass } from './notation.js';
import { effectiveGlass, loadCompact, loadGlassMode, saveCompact, saveGlassMode } from './settings.js';
import { createScanner } from './scanner/client.js';
import { rotateGrid } from './scanner/core.js';

export { chesscomUrl, lichessUrl }; // handy for tests and other pages

const $ = (id) => document.getElementById(id);
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

let flipped = false;
let curFen = null;
let game = null;
let lastAutoFen = null;
let autoTimer = null;

// ---------- engine ----------

const engine = createEngineClient({
  getSettings: () => ({ multipv: $('multipv').value, depth: Math.max(8, Math.min(30, +$('depthMax').value || 20)) }),
  onLines: scheduleAnalysisRender,
  onError: (message) => setStatus(message, true),
});

// The engine reports several lines per second; draw at most once per frame.
let renderQueued = false;
function scheduleAnalysisRender() {
  if (renderQueued) return;
  renderQueued = true;
  const run = () => { renderQueued = false; renderAnalysis(); };
  if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(run); else setTimeout(run, 16);
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

// ---------- compact view ----------
// The host header owns the button; the panel owns the state (so it persists) and tells the host its width.
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

function applyGlass() {
  parent.postMessage({ type: 'glass', on: effectiveGlass($('glass').value) }, '*');
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

function renderBoard() {
  if (editor.isOpen()) { editor.render(); return; }
  if (!game) { $('board').textContent = ''; return; }
  const hl = new Set();
  const first = engine.lines[0] && engine.lines[0].pv[0];
  if (first && !sel) { hl.add(first.slice(0, 2)); hl.add(first.slice(2, 4)); }
  if (sel) hl.add(sel);
  const last = new Set(lastMove ? [lastMove.from, lastMove.to] : []);
  const targets = new Map(); // square -> true if it is a capture
  if (sel) {
    for (const m of legalMovesFrom(sel)) targets.set(m.to, !!m.captured || m.flags.includes('e'));
  }
  const weak = scanInfo && scanInfo.weak;
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

// Following the page would overwrite what you are doing here, so stop it. Returns true if it was on.
function stopAutoFollow() {
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
  if (stopAutoFollow()) setStatus('Auto-follow paused while you play moves here. Press Snapshot to go back to the real position.');
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
  const prev = history.pop();
  if (!prev) return;
  future.push({ fen: curFen, lastMove });
  $('turn').value = 'auto';
  setPosition(prev.fen, 'undo', { lastMove: prev.lastMove });
}

function redoMove() {
  const next = future.pop();
  if (!next) return;
  history.push({ fen: curFen, lastMove });
  $('turn').value = 'auto';
  setPosition(next.fen, 'redo', { lastMove: next.lastMove });
}

let ghost = null;
$('board').addEventListener('pointerdown', (e) => {
  if (editor.isOpen()) { editor.pointer('down', e); return; }
  if (!game || e.button !== 0 || pendingPromo) return;
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

function renderAnalysis() {
  const lines = engine.lines;
  const top = lines[0];
  $('bestMove').textContent = '—';
  $('bestEval').textContent = '';
  $('depth').textContent = '';
  $('lines').innerHTML = '';
  $('arrows').innerHTML = '';
  if (game && game.isGameOver()) {
    $('bestMove').textContent = game.isCheckmate() ? 'Checkmate' : 'Game over';
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

  // eval bar (white's perspective)
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
  if (game.isGameOver()) engine.stop(); else engine.analyse(fen);
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

// ---------- reading the page or the screen ----------

// The host page takes screenshots (it hides this panel first so the panel is not in the picture) and reads the
// chess site's own board data. Both come back as messages.
let capWait = null, capId = 0;
function captureTab() {
  return new Promise((resolve) => {
    const id = ++capId;
    const timer = setTimeout(() => {
      if (capWait && capWait.id === id) {
        capWait = null;
        resolve({ ok: false, error: 'The page did not answer. Paste a screenshot instead.' });
      }
    }, 8000);
    capWait = { id, resolve, timer };
    parent.postMessage({ type: 'capture', id }, '*');
  });
}

let snapWait = null, snapId = 0;
function snapshotOnce() { // the board as the page's own data describes it, or null
  return new Promise((resolve) => {
    const id = ++snapId;
    const timer = setTimeout(() => {
      if (snapWait && snapWait.id === id) { snapWait = null; resolve(null); }
    }, 2500);
    snapWait = { id, resolve, timer };
    parent.postMessage({ type: 'snapshot', auto: false, id }, '*');
  });
}

function askSnapshot(auto) { // fire and forget: Auto-follow polling
  parent.postMessage({ type: 'snapshot', auto }, '*');
}

window.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'toggleCompact') { setCompact(!compact); return; }
  if (d.type === 'captured') {
    if (capWait && d.id === capWait.id) { clearTimeout(capWait.timer); capWait.resolve(d); capWait = null; }
    return;
  }
  if (d.type !== 'snapshot') return;
  if (d.id) { // the answer to a Snapshot click
    if (snapWait && d.id === snapWait.id) { clearTimeout(snapWait.timer); snapWait.resolve(d); snapWait = null; }
    return;
  }
  if (!d.fen || editor.isOpen() || cropSheet.isOpen()) return; // Auto-follow tick: nothing to show, or busy editing
  if (d.auto) {
    if (d.fen === lastAutoFen) return;
    lastAutoFen = d.fen;
  }
  history = []; future = [];
  setPosition(d.fen, d.src);
});

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
  if (typeof navigator !== 'undefined' && navigator.deviceMemory && navigator.deviceMemory <= 2) {
    setStatus('This device has little memory, so reading a picture may take a while.');
  }
}

// Snapshot: the page's own board data when the page has a chess board (exact, with turn and castling),
// otherwise a picture of the whole screen. Shift+click always takes the picture.
async function snapshot(ev) {
  if (busy) { cycle++; flow.cancel(); setBusy(false); setStatus('Cancelled.'); return; }
  const token = ++cycle;
  lastAutoFen = null;
  hideNote();
  setBusy(true, 'Reading…');
  if (!(ev && ev.shiftKey)) {
    const s = await snapshotOnce();
    if (token !== cycle) return;
    if (s && s.fen) {
      setBusy(false);
      history = []; future = [];
      setPosition(s.fen, s.src);
      return;
    }
  }
  lowMemoryHint();
  const out = await flow.scanScreen();
  if (token !== cycle) return;
  setBusy(false);
  handleOutcome(out);
}

// A picture the person chose, pasted or dropped, or the boxed part of the last one.
async function readPicture(blob, crop = null) {
  if (busy) { cycle++; flow.cancel(); }
  const token = ++cycle;
  hideNote();
  setBusy(true, 'Reading…');
  lowMemoryHint();
  const out = await flow.scanBlob(blob, crop, 'picture');
  if (token !== cycle) return;
  setBusy(false);
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

// Show a position that came from a picture straight on the board and start analysing it.
// If it cannot be a real position, open the editor on it instead so it can be fixed.
function applyScan(out) {
  const res = out.result;
  const black = res.bottom === 'black';
  const grid = black ? rotateGrid(res.grid) : res.grid;
  const weak = new Set();
  (res.squareConfidence || []).forEach((c, i) => { if (c < WEAK) weak.add(drawnSquare(i >> 3, i & 7, black)); });
  const turn = guessTurn(grid);
  const castle = homeCastling(grid);
  const select = { label: 'Select board…', run: openCrop };
  if (checkPosition(grid, turn)) {
    if (res.pieces < 3) {
      showNote({
        kind: 'err',
        text: `I could not find a chess board on the ${out.source}. Select the board, or try a clearer picture.`,
        actions: [select, { label: 'Choose a picture…', run: () => $('pictureInput').click() }],
      });
      return;
    }
    openEditor({ grid, flipped: black, turn, castle, weak });
    return;
  }
  adopt({ grid, flipped: black, turn, castle, weak, src: `scanned from the ${out.source}`, unsure: res.orientationUnsure, verb: `Scanned from the ${out.source}` });
}

// Put a position on the board and say what it is.
function adopt({ grid, flipped: view, turn, castle, weak, src, unsure, verb }) {
  history = []; future = [];
  $('turn').value = 'auto';
  flipped = view; // show the board the way the picture showed it
  lastAutoFen = null;
  stopAutoFollow();
  setPosition(fenFrom({ grid, turn, castle }), src, { scanWeak: weak });
  const parts = [`${verb} · ${turn === 'w' ? 'White' : 'Black'} to move.`];
  if (unsure) parts.push('Not sure which side is at the bottom.');
  if (weak.size) parts.push(`${weak.size} uncertain square${weak.size > 1 ? 's' : ''} outlined.`);
  const doubtful = unsure || weak.size > 0;
  const actions = [{ label: 'Edit', run: editCurrent }];
  if (unsure) actions.push({ label: 'Wrong way up', run: turnAround });
  if (doubtful && lastShot) actions.push({ label: 'Select board…', run: openCrop });
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

// ---------- editing the position ----------

const rightsFrom = (field) => ({ K: /K/.test(field), Q: /Q/.test(field), k: /k/.test(field), q: /q/.test(field) });

function openEditor(spec) {
  engine.stop();
  hideNote();
  editor.open(spec);
}

function editCurrent() {
  if (!game) return;
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
    const wasFollowing = stopAutoFollow();
    setPosition(fenFrom({ grid, turn, castle }), 'edited on the panel');
    if (wasFollowing) setStatus('Auto-follow is off while you edit. Press Snapshot to go back to the page.');
  },
  onCancel: ({ flipped: view }) => {
    flipped = view;
    renderBoard();
    if (game && !game.isGameOver()) { engine.analyse(curFen); renderAnalysis(); } // it was paused while editing
  },
});

const cropSheet = createCropSheet({ $, onRead: (blob, crop) => readPicture(blob, crop), onCancel: () => {} });

// ---------- pictures from files, the clipboard and drag-and-drop ----------

$('pictureBtn').onclick = () => $('pictureInput').click();
$('pictureInput').onchange = (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (f) acceptPicture(f);
};
const busyEditing = () => editor.isOpen() || cropSheet.isOpen();
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
$('multipv').onchange = () => curFen && setPosition(curFen, undefined, { keep: true });
$('auto').onchange = () => {
  clearInterval(autoTimer);
  lastAutoFen = null;
  if ($('auto').checked) {
    askSnapshot(true);
    autoTimer = setInterval(() => askSnapshot(true), 800);
  }
};

$('openLichess').onclick = () => curFen && openExternal(lichessUrl(curFen, flipped));
$('openChesscom').onclick = () => curFen && openExternal(chesscomUrl(curFen, flipped));
$('copyFen').onclick = async () => {
  if (!curFen) return;
  const ok = await copyText(curFen);
  setStatus(ok ? 'FEN copied to the clipboard' : 'Copy was blocked by the browser', !ok);
};
$('glass').onchange = () => { saveGlassMode($('glass').value); applyGlass(); };
loadGlassMode().then((mode) => { $('glass').value = mode; applyGlass(); });
loadCompact().then((on) => { compact = on; applyCompact(); });

setPosition(START);

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

window.__panel = { editor, cropSheet, flow }; // for the offline tests; invisible to web pages (extension origin)
