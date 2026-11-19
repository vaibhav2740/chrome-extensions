// "Scan a board" sheet: pick or capture a picture, optionally box the board, read it, fix any mistakes, analyze.
// The sheet works on a grid exactly as the picture shows it (top row first); the side at the bottom and the side to
// move are explicit choices, because a picture cannot always tell (a lone king and pawn look the same either way up).

import { Chess } from './lib/chess.js';
import { gridToPlacement, rotateGrid } from './scanner/core.js';

const PIECES = ['K', 'Q', 'R', 'B', 'N', 'P', 'k', 'q', 'r', 'b', 'n', 'p'];
const NAMES = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
const WEAK = 0.85; // squares the reader is less sure about than this get outlined
const pieceSrc = (ch) => `pieces/${ch === ch.toUpperCase() ? 'w' : 'b'}${ch.toUpperCase()}.svg`;
const pieceName = (ch) => `${ch === ch.toUpperCase() ? 'White' : 'Black'} ${NAMES[ch.toLowerCase()]}`;
const clone = (g) => g.map((r) => [...r]);
const emptyGrid = () => Array.from({ length: 8 }, () => Array(8).fill(null));

export function dataUrlToBlob(url) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url || '');
  if (!m) throw new Error('Not an image');
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] || 'image/png' });
}

// Everything that can be wrong with a position a person might want analysed. Returns an error string or null.
// `turn` is the side to move; the side that just moved must not be left in check.
export function checkPosition(whiteGrid, turn) {
  const flat = whiteGrid.flat();
  const count = (c) => flat.filter((x) => x === c).length;
  if (count('K') !== 1) return count('K') ? 'There can only be one white king.' : 'Add the white king.';
  if (count('k') !== 1) return count('k') ? 'There can only be one black king.' : 'Add the black king.';
  if (count('P') > 8) return 'White has more than 8 pawns.';
  if (count('p') > 8) return 'Black has more than 8 pawns.';
  if (whiteGrid[0].some((c) => c === 'P' || c === 'p') || whiteGrid[7].some((c) => c === 'P' || c === 'p')) {
    return 'Pawns cannot stand on the first or last row.';
  }
  const other = turn === 'w' ? 'b' : 'w';
  try {
    const g = new Chess(`${gridToPlacement(whiteGrid)} ${other} - - 0 1`);
    if (g.isCheck()) return (turn === 'w' ? 'Black' : 'White') + ' is in check but it is not their move.';
  } catch (e) {
    return String((e && e.message) || e).replace(/^Invalid FEN:\s*/i, '');
  }
  return null;
}

export function homeCastling(whiteGrid) {
  return {
    K: whiteGrid[7][4] === 'K' && whiteGrid[7][7] === 'R',
    Q: whiteGrid[7][4] === 'K' && whiteGrid[7][0] === 'R',
    k: whiteGrid[0][4] === 'k' && whiteGrid[0][7] === 'r',
    q: whiteGrid[0][4] === 'k' && whiteGrid[0][0] === 'r',
  };
}

const STAGE_TEXT = {
  loading: 'Loading the board reader…',
  locating: 'Finding the board…',
  reading: 'Reading the pieces…',
};

// deps: { $, makeScanner(onStage) -> {scan(blob, crop)}, capture() -> Promise<{ok,dataUrl,error}>,
//         onAnalyze({fen, flipped, summary}), onChange() }
export function initScanUI(deps) {
  const { $, makeScanner, capture, onAnalyze, onChange = () => {} } = deps;
  let scanner = null;
  let blob = null, objUrl = null, natW = 0, natH = 0, crop = null;
  let busy = false, runId = 0;
  let grid = emptyGrid(), weak = new Set(), bottom = 'white', turn = 'w';
  let castle = { K: false, Q: false, k: false, q: false };
  let tool = 'move', sel = null, dragFrom = null, ghost = null;
  let info = null; // the reader's last result

  // ---------- views ----------

  const VIEWS = ['scanPick', 'scanPic', 'scanBusy', 'scanResult'];
  function view(name) {
    for (const v of VIEWS) $(v).hidden = v !== name;
    onChange();
  }
  const isOpen = () => !$('scan').hidden;

  function open(file) {
    $('scan').hidden = false;
    document.body.classList.add('scanning');
    $('main').hidden = true;
    lowMemoryNote();
    if (file) setPicture(file); else { clearPicture(); view('scanPick'); }
    onChange();
  }

  function close() {
    runId++; // a read still running will be ignored
    busy = false;
    clearPicture();
    hideGhost();
    $('scan').hidden = true;
    $('main').hidden = false;
    document.body.classList.remove('scanning');
    onChange();
  }

  function lowMemoryNote() {
    const mem = typeof navigator !== 'undefined' && navigator.deviceMemory;
    $('scanLowMem').hidden = !(mem && mem <= 2);
  }

  // ---------- step 1: a picture ----------

  function clearPicture() {
    if (objUrl) { try { URL.revokeObjectURL(objUrl); } catch (e) { /* gone */ } }
    objUrl = null; blob = null; crop = null; natW = natH = 0;
    $('picImg').removeAttribute('src');
    $('picBox').hidden = true;
  }

  function setPicture(file) {
    if (!file || !/^image\//.test(file.type || '')) {
      $('scanPickMsg').textContent = 'That is not a picture. Drop or paste an image (PNG, JPEG or WebP).';
      $('scanPickMsg').className = 'scan-note err';
      view('scanPick');
      return;
    }
    clearPicture();
    blob = file;
    objUrl = URL.createObjectURL(file);
    $('scanPickMsg').textContent = '';
    $('picImg').src = objUrl;
    updateHint();
    view('scanPic');
  }

  $('picImg').addEventListener('load', () => {
    natW = $('picImg').naturalWidth;
    natH = $('picImg').naturalHeight;
  });
  $('picImg').addEventListener('error', () => {
    $('scanPickMsg').textContent = 'Could not open that picture. Try another file or a screenshot.';
    $('scanPickMsg').className = 'scan-note err';
    clearPicture();
    view('scanPick');
  });

  async function captureTab() {
    $('scanPickMsg').textContent = 'Capturing…';
    $('scanPickMsg').className = 'scan-note';
    $('scanCapture').disabled = true;
    let res;
    try { res = await capture(); } catch (e) { res = { ok: false, error: String((e && e.message) || e) }; }
    $('scanCapture').disabled = false;
    if (!isOpen()) return;
    if (!res || !res.ok) {
      $('scanPickMsg').textContent = (res && res.error) || 'Could not capture this tab. Paste a screenshot instead.';
      $('scanPickMsg').className = 'scan-note err';
      return;
    }
    try { setPicture(dataUrlToBlob(res.dataUrl)); } catch (e) {
      $('scanPickMsg').textContent = 'The capture could not be read. Paste a screenshot instead.';
      $('scanPickMsg').className = 'scan-note err';
    }
  }

  $('scanCapture').onclick = captureTab;
  $('scanFile').onclick = () => $('scanFileInput').click();
  $('scanFileInput').onchange = (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) setPicture(f); };
  $('scanBack').onclick = close;

  // paste anywhere in the panel, and drop a file anywhere on it
  const imageFrom = (list) => Array.from(list || []).find((f) => f && /^image\//.test(f.type || ''));
  document.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    let file = null;
    for (const it of Array.from(items || [])) {
      if (it.kind === 'file' && /^image\//.test(it.type || '')) { file = it.getAsFile(); break; }
    }
    if (!file) return;
    e.preventDefault();
    open(file);
  });
  document.addEventListener('dragover', (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); $('scanDrop').classList.add('over'); }
  });
  document.addEventListener('dragleave', () => $('scanDrop').classList.remove('over'));
  document.addEventListener('drop', (e) => {
    $('scanDrop').classList.remove('over');
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    const f = imageFrom(e.dataTransfer.files);
    if (f) open(f);
  });

  // ---------- step 2: draw a box around the board (optional) ----------

  function updateHint() {
    $('picHint').textContent = crop
      ? 'Only the boxed area will be read. Click the picture to clear the box.'
      : 'Drag a box around the board for the best result. Or just press Read position.';
  }

  let box = null; // { x, y } where the drag started, in displayed pixels
  const wrap = $('picWrap');
  wrap.addEventListener('pointerdown', (e) => {
    if (busy || e.button !== 0) return;
    const r = $('picImg').getBoundingClientRect();
    if (!r.width) return;
    box = { x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: Math.max(0, Math.min(r.height, e.clientY - r.top)), moved: false };
    try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* synthetic event */ }
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!box) return;
    const r = $('picImg').getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, e.clientX - r.left)), y = Math.max(0, Math.min(r.height, e.clientY - r.top));
    box.moved = true;
    drawBox(box.x, box.y, x, y);
  });
  const endBox = (e) => {
    if (!box) return;
    const r = $('picImg').getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, e.clientX - r.left)), y = Math.max(0, Math.min(r.height, e.clientY - r.top));
    const x0 = Math.min(box.x, x), y0 = Math.min(box.y, y), x1 = Math.max(box.x, x), y1 = Math.max(box.y, y);
    box = null;
    if (x1 - x0 < 24 || y1 - y0 < 24 || !r.width) { crop = null; $('picBox').hidden = true; updateHint(); return; }
    const sx = (natW || r.width) / r.width, sy = (natH || r.height) / r.height;
    crop = [x0 * sx, y0 * sy, x1 * sx, y1 * sy];
    drawBox(x0, y0, x1, y1);
    updateHint();
  };
  wrap.addEventListener('pointerup', endBox);
  wrap.addEventListener('pointercancel', () => { box = null; });
  function drawBox(x0, y0, x1, y1) {
    const el = $('picBox');
    el.hidden = false;
    el.style.left = Math.min(x0, x1) + 'px';
    el.style.top = Math.min(y0, y1) + 'px';
    el.style.width = Math.abs(x1 - x0) + 'px';
    el.style.height = Math.abs(y1 - y0) + 'px';
  }

  $('scanRetake').onclick = () => { clearPicture(); $('scanPickMsg').textContent = ''; view('scanPick'); };
  $('scanRead').onclick = readPicture;

  // ---------- reading ----------

  async function readPicture() {
    if (!blob || busy) return;
    busy = true;
    const mine = ++runId;
    $('busyText').textContent = STAGE_TEXT.loading;
    $('scanBusyErr').hidden = true;
    $('scanBusyCancel').hidden = false;
    $('scanBusySpin').hidden = false;
    view('scanBusy');
    try {
      if (!scanner) scanner = makeScanner((stage) => { if (busy && STAGE_TEXT[stage]) $('busyText').textContent = STAGE_TEXT[stage]; });
      const res = await scanner.scan(blob, crop);
      if (mine !== runId) return; // cancelled or closed meanwhile
      busy = false;
      showResult(res);
    } catch (e) {
      if (mine !== runId) return;
      busy = false;
      $('busyText').textContent = 'The board could not be read: ' + String((e && e.message) || e);
      $('scanBusyErr').hidden = false;
      $('scanBusyCancel').hidden = true;
      $('scanBusySpin').hidden = true;
      onChange();
    }
  }

  $('scanBusyCancel').onclick = () => { runId++; busy = false; view('scanPic'); };
  $('scanBusyRetry').onclick = readPicture;
  $('scanBusyBack').onclick = () => { busy = false; view(blob ? 'scanPic' : 'scanPick'); };

  // ---------- step 3: check and fix the result ----------

  function showResult(res) {
    info = res;
    grid = clone(res.grid);
    bottom = res.bottom === 'black' ? 'black' : 'white';
    weak = new Set();
    (res.squareConfidence || []).forEach((c, i) => { if (c < WEAK) weak.add(i); });
    tool = 'move'; sel = null;
    const wg = whiteGrid();
    castle = homeCastling(wg);
    // the side to move is not in the picture: use the one that makes the position legal, White if both do
    turn = checkPosition(wg, 'w') && !checkPosition(wg, 'b') ? 'b' : 'w';
    renderAll();
    view('scanResult');
  }

  const whiteGrid = () => (bottom === 'black' ? rotateGrid(grid) : grid);

  function renderAll() {
    renderBoard();
    renderPalette();
    syncControls();
  }

  function renderBoard() {
    const b = $('sBoard');
    b.innerHTML = '';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const d = document.createElement('div');
        const i = r * 8 + c;
        d.className = 'sq ' + ((r + c) % 2 === 0 ? 'light' : 'dark') +
          (sel && sel[0] === r && sel[1] === c ? ' hl' : '') + (weak.has(i) ? ' weak' : '');
        d.dataset.r = r;
        d.dataset.c = c;
        const ch = grid[r][c];
        if (ch && !(dragFrom && dragFrom[0] === r && dragFrom[1] === c)) {
          const img = document.createElement('img');
          img.src = pieceSrc(ch);
          img.alt = pieceName(ch);
          img.draggable = false;
          d.appendChild(img);
        }
        // labels follow the side at the bottom
        if (c === 0) { const t = document.createElement('i'); t.className = 'coord r'; t.textContent = bottom === 'white' ? 8 - r : r + 1; d.appendChild(t); }
        if (r === 7) { const t = document.createElement('i'); t.className = 'coord f'; t.textContent = 'abcdefgh'[bottom === 'white' ? c : 7 - c]; d.appendChild(t); }
        b.appendChild(d);
      }
    }
  }

  function renderPalette() {
    const p = $('sPalette');
    p.innerHTML = '';
    const add = (key, title, content) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tool' + (tool === key ? ' on' : '');
      btn.dataset.tool = key;
      btn.title = title;
      btn.setAttribute('aria-label', title);
      btn.setAttribute('aria-pressed', tool === key ? 'true' : 'false');
      if (typeof content === 'string') btn.innerHTML = content; else btn.appendChild(content);
      btn.onclick = () => { tool = key; sel = null; renderAll(); };
      p.appendChild(btn);
    };
    add('move', 'Move pieces (drag one off the board to remove it)',
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 5.6 3.9h1.6v3.3H3.9V5.6L1.5 8l2.4 2.4V8.8h3.3v3.3H5.6L8 14.5l2.4-2.4H8.8V8.8h3.3v1.6L14.5 8l-2.4-2.4v1.6H8.8V3.9h1.6L8 1.5z"/></svg>');
    for (const ch of PIECES) {
      const img = document.createElement('img');
      img.src = pieceSrc(ch);
      img.alt = '';
      img.draggable = false;
      add(ch, 'Place a ' + pieceName(ch).toLowerCase(), img);
    }
    add('erase', 'Erase a piece',
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.2 3 8 6.8 11.8 3 13 4.2 9.2 8l3.8 3.8-1.2 1.2L8 9.2 4.2 13 3 11.8 6.8 8 3 4.2z"/></svg>');
  }

  function fenNow() {
    const rights = ['K', 'Q', 'k', 'q'].filter((k) => castle[k]).join('');
    return `${gridToPlacement(whiteGrid())} ${turn} ${rights || '-'} - 0 1`;
  }

  function syncControls() {
    const wg = whiteGrid();
    const home = homeCastling(wg);
    for (const k of ['K', 'Q', 'k', 'q']) {
      if (!home[k]) castle[k] = false;
      const input = $('sC' + k);
      input.checked = !!castle[k];
      input.disabled = !home[k];
      input.closest('label').classList.toggle('disabled', !home[k]);
    }
    document.querySelectorAll('input[name=sBottom]').forEach((i) => { i.checked = i.value === bottom; });
    document.querySelectorAll('input[name=sTurn]').forEach((i) => { i.checked = i.value === turn; });
    const err = checkPosition(wg, turn);
    $('sAnalyze').disabled = !!err;
    const note = $('sNote');
    note.className = 'scan-note';
    if (err) {
      note.textContent = err;
      note.classList.add('err');
    } else if (info && info.orientationUnsure && !info.userTouchedBottom) {
      note.textContent = 'Not sure which side is at the bottom of the picture. Check the Bottom switch.';
      note.classList.add('warn');
    } else if (weak.size) {
      note.textContent = `${weak.size} outlined square${weak.size > 1 ? 's' : ''} may be wrong. Fix them, then analyze.`;
      note.classList.add('warn');
    } else {
      note.textContent = 'Looks right? Fix anything that is off, then analyze.';
    }
    onChange();
  }

  document.querySelectorAll('input[name=sBottom]').forEach((i) => {
    i.onchange = () => { if (i.checked && i.value !== bottom) { bottom = i.value; if (info) info.userTouchedBottom = true; sel = null; renderAll(); } };
  });
  document.querySelectorAll('input[name=sTurn]').forEach((i) => { i.onchange = () => { if (i.checked) { turn = i.value; syncControls(); } }; });
  for (const k of ['K', 'Q', 'k', 'q']) $('sC' + k).onchange = () => { castle[k] = $('sC' + k).checked; syncControls(); };

  // ---------- editing the board ----------

  function squareAt(x, y) {
    const r = $('sBoard').getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    return [Math.min(7, Math.floor(((y - r.top) / r.height) * 8)), Math.min(7, Math.floor(((x - r.left) / r.width) * 8))];
  }

  function set(r, c, ch) {
    grid[r][c] = ch;
    weak.delete(r * 8 + c); // a square you touched is no longer the reader's guess
  }

  function hideGhost() {
    if (ghost) { ghost.remove(); ghost = null; }
    dragFrom = null;
  }

  const sb = $('sBoard');
  sb.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const at = squareAt(e.clientX, e.clientY);
    if (!at) return;
    const [r, c] = at;
    if (tool !== 'move') {
      const want = tool === 'erase' ? null : tool;
      set(r, c, grid[r][c] === want ? null : want); // placing the same piece again removes it
      renderAll();
      return;
    }
    if (sel && (sel[0] !== r || sel[1] !== c)) { // click-click move
      const [sr, sc] = sel;
      set(r, c, grid[sr][sc]);
      set(sr, sc, null);
      sel = null;
      renderAll();
      return;
    }
    if (grid[r][c]) {
      sel = [r, c];
      dragFrom = [r, c];
      const size = sb.getBoundingClientRect().width / 8;
      ghost = document.createElement('img');
      ghost.src = pieceSrc(grid[r][c]);
      ghost.style.cssText = `position:fixed;width:${size}px;height:${size}px;pointer-events:none;z-index:10;` +
        `left:${e.clientX - size / 2}px;top:${e.clientY - size / 2}px;filter:drop-shadow(0 6px 10px rgba(0,0,0,.45));transform:scale(1.12);`;
      document.body.appendChild(ghost);
      try { sb.setPointerCapture(e.pointerId); } catch (err) { /* synthetic event */ }
    } else {
      sel = null;
    }
    renderBoard();
  });
  sb.addEventListener('pointermove', (e) => {
    if (!ghost) return;
    const size = parseFloat(ghost.style.width);
    ghost.style.left = e.clientX - size / 2 + 'px';
    ghost.style.top = e.clientY - size / 2 + 'px';
  });
  sb.addEventListener('pointerup', (e) => {
    if (!ghost) return;
    const from = dragFrom;
    hideGhost();
    const to = squareAt(e.clientX, e.clientY);
    if (!to) { set(from[0], from[1], null); sel = null; renderAll(); return; } // dropped off the board: remove
    if (to[0] !== from[0] || to[1] !== from[1]) {
      set(to[0], to[1], grid[from[0]][from[1]]);
      set(from[0], from[1], null);
      sel = null;
      renderAll();
      return;
    }
    renderBoard(); // dropped where it was: stays selected for click-click
  });
  sb.addEventListener('pointercancel', () => { if (ghost) { hideGhost(); renderBoard(); } });

  // ---------- finish ----------

  $('sBackToPic').onclick = () => view('scanPic');
  $('sClear').onclick = () => { grid = emptyGrid(); weak = new Set(); sel = null; renderAll(); };
  $('sAnalyze').onclick = () => {
    const wg = whiteGrid();
    if (checkPosition(wg, turn)) return;
    const fen = fenNow();
    const pieces = wg.flat().filter(Boolean).length;
    const summary = `scanned from a picture (${pieces} pieces${weak.size ? `, ${weak.size} uncertain` : ''})`;
    const flipped = bottom === 'black';
    close();
    onAnalyze({ fen, flipped, summary });
  };

  document.addEventListener('keydown', (e) => {
    if (!isOpen() || e.key !== 'Escape') return;
    if (sel) { sel = null; renderBoard(); return; }
    close();
  });

  return {
    open, close, isOpen, setPicture,
    fen: fenNow,
    _state: () => ({ grid: clone(grid), bottom, turn, castle: { ...castle }, crop, weak: [...weak], tool }),
  };
}
