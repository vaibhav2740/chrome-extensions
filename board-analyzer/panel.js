import { Chess } from './lib/chess.js';

const $ = (id) => document.getElementById(id);
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

let flipped = false;
let curFen = null;
let game = null;
let lines = []; // by multipv index: {cp, mate, depth, pv:[uci...]}
let lastAutoFen = null;
let autoTimer = null;

// ---------- engine ----------

let worker = null;
let engineReady = false;
let pending = null; // search request waiting for engine to be ready/synced
let searchId = 0;

function startEngine() {
  worker = new Worker(new URL('./engine/stockfish-19-lite-single.js', import.meta.url));
  worker.onmessage = (e) => onEngine(String(e.data));
  worker.onerror = (e) => setStatus('Engine error: ' + (e.message || 'failed to load'), true);
  worker.postMessage('uci');
}

function onEngine(line) {
  if (line === 'uciok') {
    worker.postMessage('setoption name Threads value 1');
    worker.postMessage('setoption name Hash value 64');
    worker.postMessage('isready');
  } else if (line === 'readyok') {
    engineReady = true;
    if (pending) { const p = pending; pending = null; runSearch(p); }
  } else if (engineReady && line.startsWith('info') && line.includes(' pv ')) {
    parseInfo(line);
  }
}

function parseInfo(line) {
  const t = line.split(' ');
  const get = (k) => { const i = t.indexOf(k); return i >= 0 ? t[i + 1] : null; };
  const multipv = +(get('multipv') || 1);
  const depth = +get('depth');
  const si = t.indexOf('score');
  if (si < 0) return;
  const kind = t[si + 1], val = +t[si + 2];
  const pv = t.slice(t.indexOf('pv') + 1);
  // Stockfish scores are from the side to move; convert to white's perspective.
  const sign = game.turn() === 'w' ? 1 : -1;
  lines[multipv - 1] = { cp: kind === 'cp' ? val * sign : null, mate: kind === 'mate' ? val * sign : null, depth, pv };
  renderAnalysis();
}

function requestSearch(fen) {
  const req = { fen, id: ++searchId };
  lines = [];
  renderAnalysis();
  if (!worker) startEngine();
  if (!engineReady) { pending = req; return; }
  // stop any running search, then wait for readyok so stale output is flushed
  engineReady = false;
  pending = req;
  worker.postMessage('stop');
  worker.postMessage('isready');
}

function runSearch(req) {
  if (req.id !== searchId) return;
  worker.postMessage('setoption name MultiPV value ' + $('multipv').value);
  worker.postMessage('position fen ' + req.fen);
  worker.postMessage('go depth ' + Math.max(8, Math.min(30, +$('depthMax').value || 20)));
}

// ---------- chess helpers ----------

function pvToSan(fen, pv, max = 7) {
  const g = new Chess(fen);
  const out = [];
  const startNum = +fen.split(' ')[5] || 1;
  let white = g.turn() === 'w';
  let n = startNum;
  for (const uci of pv.slice(0, max)) {
    let m;
    try { m = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch (e) { break; }
    if (!m) break;
    out.push((white ? `${n}.` : out.length === 0 ? `${n}…` : '') + m.san);
    if (!white) n++;
    white = !white;
  }
  return out.join(' ');
}

function normalizeFen(raw) {
  const f = raw.trim().replace(/\s+/g, ' ').split(' ');
  const defaults = ['w', '-', '-', '0', '1'];
  while (f.length < 6) f.push(defaults[f.length - 1]);
  return f.join(' ');
}

function applyTurnOverride(fen) {
  const o = $('turn').value;
  if (o === 'auto') return fen;
  const f = fen.split(' ');
  f[1] = o;
  f[3] = '-';
  return f.join(' ');
}

function scoreClass(l) {
  const v = l.mate != null ? l.mate : l.cp;
  return v > 0 ? 'pos' : v < 0 ? 'neg' : '';
}

// ---------- open this position elsewhere ----------

// Lichess takes the FEN in the path with spaces as underscores; ?color=black shows the board from Black's side.
export function lichessUrl(fen, flippedView) {
  return 'https://lichess.org/analysis/' + fen.trim().replace(/\s+/g, '_') + (flippedView ? '?color=black' : '');
}

export function chesscomUrl(fen, flippedView) {
  return 'https://www.chess.com/analysis?fen=' + encodeURIComponent(fen.trim()) + '&flip=' + (flippedView ? 'true' : 'false');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { /* blocked */ }
    ta.remove();
    return ok;
  }
}

function openExternal(url) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

// ---------- glass vs basic style ----------
// Backdrop blur is cheap on most machines but costly on weak GPUs, especially over playing video, so it is a setting.
// Auto turns it off for "reduce transparency" users and very low-end devices.
function effectiveGlass(mode) {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-transparency: reduce)').matches) return false;
    if (navigator.deviceMemory && navigator.deviceMemory <= 2) return false;
    if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) return false;
  } catch (e) { /* unknown: assume capable */ }
  return true;
}

const hasChromeStorage = () => typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

async function loadGlassMode() {
  try {
    if (hasChromeStorage()) {
      const r = await chrome.storage.local.get('glassMode');
      if (['auto', 'on', 'off'].includes(r.glassMode)) return r.glassMode;
    } else if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem('ba.glassMode');
      if (['auto', 'on', 'off'].includes(v)) return v;
    }
  } catch (e) { /* fall through */ }
  return 'auto';
}

function saveGlassMode(mode) {
  try {
    if (hasChromeStorage()) chrome.storage.local.set({ glassMode: mode });
    else if (typeof localStorage !== 'undefined') localStorage.setItem('ba.glassMode', mode);
  } catch (e) { /* not persisted; still applied for this session */ }
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
  try {
    if (hasChromeStorage()) chrome.storage.local.set({ compactMode: compact });
    else if (typeof localStorage !== 'undefined') localStorage.setItem('ba.compactMode', compact ? '1' : '0');
  } catch (e) { /* not persisted */ }
  applyCompact();
}

async function loadCompact() {
  try {
    if (hasChromeStorage()) return !!(await chrome.storage.local.get('compactMode')).compactMode;
    if (typeof localStorage !== 'undefined') return localStorage.getItem('ba.compactMode') === '1';
  } catch (e) { /* default */ }
  return false;
}

function applyGlass() {
  parent.postMessage({ type: 'glass', on: effectiveGlass($('glass').value) }, '*');
}

function fmtScore(l) {
  if (!l) return '';
  if (l.mate != null) return (l.mate > 0 ? '+M' : '-M') + Math.abs(l.mate);
  const v = l.cp / 100;
  return (v > 0 ? '+' : '') + v.toFixed(2);
}

// ---------- rendering ----------

let sel = null;           // selected square (click-to-move)
let dragFrom = null;      // square currently being dragged
let history = [];         // undo stack: { fen, lastMove }
let future = [];          // redo stack
let lastMove = null;      // { from, to } of the last move played on the panel
let pendingPromo = null;  // { from, to, color } while the promotion picker is open

function renderBoard() {
  const b = $('board');
  b.innerHTML = '';
  if (!game) return;
  const board = game.board(); // rank 8 first
  const hl = new Set();
  const first = lines[0] && lines[0].pv[0];
  if (first && !sel) { hl.add(first.slice(0, 2)); hl.add(first.slice(2, 4)); }
  if (sel) hl.add(sel);
  const last = new Set(lastMove ? [lastMove.from, lastMove.to] : []);
  const targets = new Map(); // square -> true if it is a capture
  if (sel) {
    for (const m of legalMovesFrom(sel)) targets.set(m.to, !!m.captured || m.flags.includes('e'));
  }
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const rr = flipped ? 7 - r : r, ff = flipped ? 7 - f : f;
      const cell = board[rr][ff];
      const name = 'abcdefgh'[ff] + (8 - rr);
      const d = document.createElement('div');
      d.className = 'sq ' + ((rr + ff) % 2 === 0 ? 'light' : 'dark') +
        (hl.has(name) ? ' hl' : last.has(name) ? ' last' : '') +
        (targets.has(name) ? (targets.get(name) ? ' cap' : ' dot') : '');
      d.dataset.sq = name;
      if (cell && name !== dragFrom) {
        const img = document.createElement('img');
        img.src = `pieces/${cell.color}${cell.type.toUpperCase()}.svg`;
        img.draggable = false;
        d.appendChild(img);
      }
      if (f === 0) { const c = document.createElement('i'); c.className = 'coord r'; c.textContent = 8 - rr; d.appendChild(c); }
      if (r === 7) { const c = document.createElement('i'); c.className = 'coord f'; c.textContent = 'abcdefgh'[ff]; d.appendChild(c); }
      b.appendChild(d);
    }
  }
}

// ---------- moving pieces on the panel board (like an analysis board) ----------
// Drag-and-drop or click-click, always on. Either side may move: if you pick up a piece that is not on the move,
// the turn simply follows it (snapshots often guess the side to move, and a wrong guess must never lock the board).

function squareAt(x, y) {
  const r = $('board').getBoundingClientRect();
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
  const col = Math.min(7, Math.floor(((x - r.left) / r.width) * 8));
  const row = Math.min(7, Math.floor(((y - r.top) / r.height) * 8));
  const f = flipped ? 7 - col : col, rk = flipped ? row : 7 - row;
  return 'abcdefgh'[f] + (rk + 1);
}

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
  if ($('auto').checked) {
    // The page would overwrite your line on the next poll, so pause following until you press Snapshot.
    $('auto').checked = false;
    $('auto').onchange();
    setStatus('Auto-follow paused while you play moves here. Press Snapshot to go back to the real position.');
  }
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
    img.src = `pieces/${pendingPromo.color}${t.toUpperCase()}.svg`;
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
    ghost = document.createElement('img');
    ghost.src = `pieces/${piece.color}${piece.type.toUpperCase()}.svg`;
    const size = $('board').getBoundingClientRect().width / 8;
    ghost.style.cssText = `position:fixed;width:${size}px;height:${size}px;pointer-events:none;z-index:10;` +
      `left:${e.clientX - size / 2}px;top:${e.clientY - size / 2}px;filter:drop-shadow(0 6px 10px rgba(0,0,0,.45));` +
      'transform:scale(1.12);';
    document.body.appendChild(ghost);
    try { $('board').setPointerCapture(e.pointerId); } catch (err) { /* synthetic event */ }
  } else {
    sel = null;
  }
  renderBoard();
});
$('board').addEventListener('pointermove', (e) => {
  if (!ghost) return;
  const size = parseFloat(ghost.style.width);
  ghost.style.left = e.clientX - size / 2 + 'px';
  ghost.style.top = e.clientY - size / 2 + 'px';
});
$('board').addEventListener('pointerup', (e) => {
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
$('board').addEventListener('pointercancel', () => {
  if (ghost) { ghost.remove(); ghost = null; dragFrom = null; renderBoard(); }
});

// Keyboard: ← undo, → redo, Esc deselect / cancel promotion (ignored while typing in a field).
document.addEventListener('keydown', (e) => {
  if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || '')) return;
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
  if (pendingPromo) { pendingPromo = null; $('promo').hidden = true; $('promo').innerHTML = ''; }
  $('fen').value = fen;
  setStatus(src ? 'Source: ' + src : '');
  lines = [];
  renderBoard();
  renderAnalysis();
  if (!game.isGameOver()) requestSearch(fen);
  return true;
}

function askSnapshot(auto) {
  parent.postMessage({ type: 'snapshot', auto }, '*');
}

window.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'toggleCompact') { setCompact(!compact); return; }
  if (d.type !== 'snapshot') return;
  if (!d.fen) { if (!d.auto) setStatus('No board found on this page. Paste a FEN instead.', true); return; }
  if (d.auto) {
    if (d.fen === lastAutoFen) return;
    lastAutoFen = d.fen;
  }
  history = []; future = [];
  setPosition(d.fen, d.src);
});

$('snap').onclick = () => { lastAutoFen = null; history = []; future = []; askSnapshot(false); };
$('undo').onclick = undoMove;
$('redo').onclick = redoMove;
$('go').onclick = () => setPosition($('fen').value);
$('fen').addEventListener('keydown', (e) => { if (e.key === 'Enter') setPosition($('fen').value); });
$('flip').onclick = () => { flipped = !flipped; renderBoard(); renderAnalysis(); };
// The header (host shell) owns Hide/Minimize now; keep the hook so an older panel.html with its own button still works.
if ($('close')) $('close').onclick = () => parent.postMessage({ type: 'close' }, '*');
$('turn').onchange = () => curFen && setPosition(curFen);
$('multipv').onchange = () => curFen && setPosition(curFen);
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
