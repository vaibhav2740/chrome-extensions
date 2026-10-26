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

function fmtScore(l) {
  if (!l) return '';
  if (l.mate != null) return (l.mate > 0 ? '+M' : '-M') + Math.abs(l.mate);
  const v = l.cp / 100;
  return (v > 0 ? '+' : '') + v.toFixed(2);
}

// ---------- rendering ----------

let playMode = false;
let sel = null;       // selected square name (click-to-move)
let dragFrom = null;  // square currently being dragged
let history = [];     // previous FENs in play mode, for undo

function renderBoard() {
  const b = $('board');
  b.innerHTML = '';
  if (!game) return;
  const board = game.board(); // rank 8 first
  const hl = new Set();
  const first = lines[0] && lines[0].pv[0];
  if (first && !playMode) { hl.add(first.slice(0, 2)); hl.add(first.slice(2, 4)); }
  const targets = new Set();
  if (playMode && sel) {
    for (const m of game.moves({ square: sel, verbose: true })) targets.add(m.to);
  }
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const rr = flipped ? 7 - r : r, ff = flipped ? 7 - f : f;
      const cell = board[rr][ff];
      const name = 'abcdefgh'[ff] + (8 - rr);
      const d = document.createElement('div');
      d.className = 'sq ' + ((rr + ff) % 2 === 0 ? 'light' : 'dark') +
        (hl.has(name) || name === sel ? ' hl' : '') + (targets.has(name) ? (cell ? ' cap' : ' dot') : '');
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

// ---------- play moves on the panel board ----------

function squareAt(x, y) {
  const r = $('board').getBoundingClientRect();
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
  const col = Math.min(7, Math.floor(((x - r.left) / r.width) * 8));
  const row = Math.min(7, Math.floor(((y - r.top) / r.height) * 8));
  const f = flipped ? 7 - col : col, rk = flipped ? row : 7 - row;
  return 'abcdefgh'[f] + (rk + 1);
}

function tryMove(from, to) {
  let m = null;
  try { m = game.move({ from, to, promotion: 'q' }); } catch (e) { m = null; }
  if (!m) return false;
  history.push(curFen);
  $('turn').value = 'auto';
  setPosition(game.fen(), 'played on panel: ' + m.san);
  return true;
}

let ghost = null;
$('board').addEventListener('pointerdown', (e) => {
  if (!playMode || !game || e.button !== 0) return;
  const sq = squareAt(e.clientX, e.clientY);
  if (!sq) return;
  const piece = game.get(sq);
  if (sel && sel !== sq && tryMove(sel, sq)) { sel = null; return; }
  if (piece && piece.color === game.turn()) {
    sel = sq;
    dragFrom = sq;
    ghost = document.createElement('img');
    ghost.src = `pieces/${piece.color}${piece.type.toUpperCase()}.svg`;
    const size = $('board').getBoundingClientRect().width / 8;
    ghost.style.cssText = `position:fixed;width:${size}px;height:${size}px;pointer-events:none;z-index:10;` +
      `left:${e.clientX - size / 2}px;top:${e.clientY - size / 2}px;`;
    document.body.appendChild(ghost);
    $('board').setPointerCapture(e.pointerId);
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
  if (to && to !== from && tryMove(from, to)) { sel = null; return; }
  renderBoard(); // dropped on same square (keeps selection for click-click) or illegal
});
$('board').addEventListener('pointercancel', () => {
  if (ghost) { ghost.remove(); ghost = null; dragFrom = null; renderBoard(); }
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
      ? `<div class="line"><b>${fmtScore(l)}</b> ${pvToSan(curFen, l.pv)}</div>` : '')
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

function setPosition(rawFen, src) {
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
  if (d.type !== 'snapshot') return;
  if (!d.fen) { if (!d.auto) setStatus('No board found on this page. Paste a FEN instead.', true); return; }
  if (d.auto) {
    if (d.fen === lastAutoFen) return;
    lastAutoFen = d.fen;
  }
  setPosition(d.fen, d.src);
});

$('snap').onclick = () => { lastAutoFen = null; history = []; askSnapshot(false); };
$('play').onchange = () => {
  playMode = $('play').checked;
  sel = null;
  document.body.classList.toggle('play', playMode);
  if (playMode && $('auto').checked) { $('auto').checked = false; $('auto').onchange(); }
  renderBoard();
};
$('undo').onclick = () => {
  const prev = history.pop();
  if (prev) { $('turn').value = 'auto'; setPosition(prev, 'undo'); }
};
$('go').onclick = () => setPosition($('fen').value);
$('fen').addEventListener('keydown', (e) => { if (e.key === 'Enter') setPosition($('fen').value); });
$('flip').onclick = () => { flipped = !flipped; renderBoard(); renderAnalysis(); };
$('close').onclick = () => parent.postMessage({ type: 'close' }, '*');
$('turn').onchange = () => curFen && setPosition(curFen);
$('multipv').onchange = () => curFen && setPosition(curFen);
$('auto').onchange = () => {
  clearInterval(autoTimer);
  lastAutoFen = null;
  if ($('auto').checked) {
    if (playMode) { $('play').checked = false; $('play').onchange(); }
    askSnapshot(true);
    autoTimer = setInterval(() => askSnapshot(true), 800);
  }
};

setPosition(START);
parent.postMessage({ type: 'height', height: document.body.scrollHeight + 16 }, '*');
