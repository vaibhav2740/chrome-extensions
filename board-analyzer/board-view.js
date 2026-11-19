// Drawing a board and mapping pointer positions to squares. Shared by the analysis board and the position editor.
// A "grid" is 8 rows of 8 cells holding FEN letters or null, rank 8 first and file a first (White's view);
// `flipped` only changes how it is shown.

export const FILES = 'abcdefgh';

export const pieceSrc = (letter) => `pieces/${letter === letter.toUpperCase() ? 'w' : 'b'}${letter.toUpperCase()}.svg`;

const NAMES = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
export const pieceName = (letter) => `${letter === letter.toUpperCase() ? 'White' : 'Black'} ${NAMES[letter.toLowerCase()]}`;

// Grid <-> square name ("e4")
export const squareName = (row, col) => FILES[col] + (8 - row);
export const squarePos = (name) => [8 - +name[1], FILES.indexOf(name[0])]; // [row, col]

export function gridFromGame(game) {
  return game.board().map((row) => row.map((c) => (c ? (c.color === 'w' ? c.type.toUpperCase() : c.type) : null)));
}

// Rebuilds the squares inside `container`.
//   classFor(name) -> extra class names for a square (highlights, dots...)
//   hidden         -> name of a square whose piece is being dragged (drawn empty)
export function drawBoard(container, { grid, flipped = false, classFor = () => '', hidden = null }) {
  const frag = document.createDocumentFragment();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const row = flipped ? 7 - r : r, col = flipped ? 7 - f : f;
      const name = squareName(row, col);
      const d = document.createElement('div');
      d.className = 'sq ' + ((row + col) % 2 === 0 ? 'light' : 'dark') + classFor(name);
      d.dataset.sq = name;
      const piece = grid[row][col];
      if (piece && name !== hidden) {
        const img = document.createElement('img');
        img.src = pieceSrc(piece);
        img.alt = pieceName(piece);
        img.draggable = false;
        d.appendChild(img);
      }
      if (f === 0) { const c = document.createElement('i'); c.className = 'coord r'; c.textContent = 8 - row; d.appendChild(c); }
      if (r === 7) { const c = document.createElement('i'); c.className = 'coord f'; c.textContent = FILES[col]; d.appendChild(c); }
      frag.appendChild(d);
    }
  }
  container.textContent = '';
  container.appendChild(frag);
}

// Square under a screen position, or null when outside the board.
export function squareFromPoint(container, x, y, flipped = false) {
  const r = container.getBoundingClientRect();
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
  const col = Math.min(7, Math.floor(((x - r.left) / r.width) * 8));
  const row = Math.min(7, Math.floor(((y - r.top) / r.height) * 8));
  return squareName(flipped ? 7 - row : row, flipped ? 7 - col : col);
}

// A piece that follows the pointer while it is dragged. Returns { move(x, y), remove() }.
export function startGhost(letter, container, x, y) {
  const size = container.getBoundingClientRect().width / 8;
  const img = document.createElement('img');
  img.src = pieceSrc(letter);
  img.alt = '';
  const place = (cx, cy) => { img.style.left = cx - size / 2 + 'px'; img.style.top = cy - size / 2 + 'px'; };
  img.style.cssText = `position:fixed;width:${size}px;height:${size}px;pointer-events:none;z-index:10;` +
    'filter:drop-shadow(0 6px 10px rgba(0,0,0,.45));transform:scale(1.12);';
  place(x, y);
  document.body.appendChild(img);
  return { move: place, remove: () => img.remove() };
}
