// Edit the position on the main board: place, move and remove pieces freely, choose who moves and the castling rights.
// While it is open, the panel hands the board's pointer events to `pointer()` and calls `render()` instead of drawing
// the game. Pieces live in a White's-view grid (see board-view.js); `flipped` only changes how it is shown.

import { Chess } from './lib/chess.js';
import { gridToPlacement } from './scanner/core.js';
import { drawBoard, pieceName, pieceSrc, squareFromPoint, squarePos, startGhost } from './board-view.js';

const PIECES = [...'KQRBNPkqrbnp'];
const RIGHTS = ['K', 'Q', 'k', 'q'];
const clone = (g) => g.map((r) => [...r]);

// Everything that can be wrong with a position a person might want analysed. Returns an error string or null.
// `turn` is the side to move; the side that just moved must not be left in check.
export function checkPosition(grid, turn) {
  const flat = grid.flat();
  const count = (c) => flat.filter((x) => x === c).length;
  if (count('K') !== 1) return count('K') ? 'There can only be one white king.' : 'Add the white king.';
  if (count('k') !== 1) return count('k') ? 'There can only be one black king.' : 'Add the black king.';
  if (count('P') > 8) return 'White has more than 8 pawns.';
  if (count('p') > 8) return 'Black has more than 8 pawns.';
  if (grid[0].some((c) => c === 'P' || c === 'p') || grid[7].some((c) => c === 'P' || c === 'p')) {
    return 'Pawns cannot stand on the first or last row.';
  }
  try {
    const g = new Chess(`${gridToPlacement(grid)} ${turn === 'w' ? 'b' : 'w'} - - 0 1`);
    if (g.isCheck()) return (turn === 'w' ? 'Black' : 'White') + ' is in check but it is not their move.';
  } catch (e) {
    return String((e && e.message) || e).replace(/^Invalid FEN:\s*/i, '');
  }
  return null;
}

// Castling is only possible while king and rook stand on their home squares.
export function homeCastling(grid) {
  return {
    K: grid[7][4] === 'K' && grid[7][7] === 'R',
    Q: grid[7][4] === 'K' && grid[7][0] === 'R',
    k: grid[0][4] === 'k' && grid[0][7] === 'r',
    q: grid[0][4] === 'k' && grid[0][0] === 'r',
  };
}

// The side to move is not in a picture: use the one that makes the position legal, White if both do.
export function guessTurn(grid) {
  return checkPosition(grid, 'w') && !checkPosition(grid, 'b') ? 'b' : 'w';
}

export function fenFrom({ grid, turn, castle }) {
  const rights = RIGHTS.filter((k) => castle[k]).join('');
  return `${gridToPlacement(grid)} ${turn} ${rights || '-'} - 0 1`;
}

// deps: { $, onDone({grid, turn, castle, flipped}), onCancel({flipped}), onChange() }
export function createEditor({ $, onDone, onCancel, onChange = () => {} }) {
  let active = false;
  let grid = [], flipped = false, turn = 'w', castle = {}, weak = new Set();
  let tool = 'move', sel = null, dragFrom = null, ghost = null;

  const board = () => $('board');
  const isOpen = () => active;

  function render() {
    drawBoard(board(), {
      grid, flipped, hidden: dragFrom,
      classFor: (name) => (sel === name ? ' hl' : '') + (weak.has(name) ? ' weak' : ''),
    });
  }

  function renderPalette() {
    const p = $('ePalette');
    p.textContent = '';
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

  function syncControls() {
    const home = homeCastling(grid);
    for (const k of RIGHTS) {
      if (!home[k]) castle[k] = false;
      const input = $('eC' + k);
      input.checked = !!castle[k];
      input.disabled = !home[k];
      input.closest('label').classList.toggle('disabled', !home[k]);
    }
    document.querySelectorAll('input[name=eTurn]').forEach((i) => { i.checked = i.value === turn; });
    const err = checkPosition(grid, turn);
    $('eDone').disabled = !!err;
    const note = $('eNote');
    note.className = 'edit-note';
    if (err) {
      note.textContent = err;
      note.classList.add('err');
    } else if (weak.size) {
      note.textContent = `${weak.size} outlined square${weak.size > 1 ? 's' : ''} may be wrong. Fix them, then press Done.`;
      note.classList.add('warn');
    } else {
      note.textContent = 'Drag pieces, or pick one below and tap squares.';
    }
    onChange();
  }

  function renderAll() { render(); renderPalette(); syncControls(); }

  function open(spec) {
    grid = clone(spec.grid);
    flipped = !!spec.flipped;
    turn = spec.turn === 'b' ? 'b' : 'w';
    castle = { K: false, Q: false, k: false, q: false, ...(spec.castle || {}) };
    weak = new Set(spec.weak || []);
    tool = 'move';
    sel = null;
    active = true;
    document.body.classList.add('editing');
    renderAll();
  }

  function finish() {
    active = false;
    hideGhost();
    document.body.classList.remove('editing');
    onChange();
  }

  // ---------- editing the board ----------

  function set(name, ch) {
    const [r, c] = squarePos(name);
    grid[r][c] = ch;
    weak.delete(name); // a square you touched is no longer the reader's guess
  }
  const at = (name) => { const [r, c] = squarePos(name); return grid[r][c]; };

  function hideGhost() {
    if (ghost) { ghost.remove(); ghost = null; }
    dragFrom = null;
  }

  function pointer(type, e) {
    if (type === 'down') {
      if (e.button !== 0) return;
      const name = squareFromPoint(board(), e.clientX, e.clientY, flipped);
      if (!name) return;
      if (tool !== 'move') {
        const want = tool === 'erase' ? null : tool;
        set(name, at(name) === want ? null : want); // placing the same piece again removes it
        renderAll();
        return;
      }
      if (sel && sel !== name) { // click-click move
        set(name, at(sel));
        set(sel, null);
        sel = null;
        renderAll();
        return;
      }
      if (at(name)) {
        sel = name;
        dragFrom = name;
        ghost = startGhost(at(name), board(), e.clientX, e.clientY);
        try { board().setPointerCapture(e.pointerId); } catch (err) { /* synthetic event */ }
      } else {
        sel = null;
      }
      render();
    } else if (type === 'move') {
      if (ghost) ghost.move(e.clientX, e.clientY);
    } else if (type === 'up') {
      if (!ghost) return;
      const from = dragFrom;
      hideGhost();
      const to = squareFromPoint(board(), e.clientX, e.clientY, flipped);
      if (!to) { set(from, null); sel = null; renderAll(); return; } // dropped off the board: remove
      if (to !== from) {
        set(to, at(from));
        set(from, null);
        sel = null;
        renderAll();
        return;
      }
      render(); // dropped where it was: stays selected for click-click
    } else if (type === 'cancel') {
      if (ghost) { hideGhost(); render(); }
    }
  }

  // ---------- controls ----------

  document.querySelectorAll('input[name=eTurn]').forEach((i) => { i.onchange = () => { if (i.checked) { turn = i.value; syncControls(); } }; });
  for (const k of RIGHTS) $('eC' + k).onchange = () => { castle[k] = $('eC' + k).checked; syncControls(); };
  $('eFlip').onclick = () => { flipped = !flipped; sel = null; render(); };
  $('eClear').onclick = () => { grid = grid.map((r) => r.map(() => null)); weak = new Set(); sel = null; renderAll(); };
  $('eCancel').onclick = () => { if (!active) return; finish(); onCancel({ flipped }); };
  $('eDone').onclick = () => {
    if (!active || checkPosition(grid, turn)) return;
    const result = { grid: clone(grid), turn, castle: { ...castle }, flipped };
    finish();
    onDone(result);
  };
  document.addEventListener('keydown', (e) => {
    if (!active || e.key !== 'Escape') return;
    if (sel) { sel = null; render(); return; }
    $('eCancel').onclick();
  });

  return { open, isOpen, render, pointer };
}
