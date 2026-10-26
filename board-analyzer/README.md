# Board Analyzer (personal Chrome extension)

Floating, draggable chessboard on any page with in-browser Stockfish 19 (lite, single-thread WASM). No server, nothing leaves your machine.

## Install
1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick this folder (`~/personal/chess-extension`)
4. Pin it via the puzzle-piece icon

## Use
- Click the extension icon (or **Alt+Shift+A**) on any normal web page to show/hide the panel. Drag the top bar to move it.
- **📷 Snapshot**: reads the board currently displayed on the page, then shows the best move, eval and top lines.
- **Auto-follow**: re-reads the board every 0.8s and re-analyzes whenever it changes (live games, stepping through moves).
- Paste any FEN and press **Analyze** (works on every site).
- **✋ Play**: drag (or click-click) pieces on the panel board to try moves without touching the real board. Legal moves are shown as dots, evaluation updates after each move, ↶ undoes. Pauses Auto-follow; press Snapshot to go back to the real position.
- Turn / Depth / Lines controls; ⇅ flips the board.

## How the position is read
- chess.com: piece elements (`.piece.wp.square-52`) from the board DOM, plus the page's own `game.getFEN()` (read in the page's JS world) for turn, castling and en passant when it matches what is displayed.
- lichess: piece positions from `cg-board`, plus `lichess.analysis.node.fen` on analysis pages.
- If only the DOM is available, side to move comes from the last-move highlight and castling rights are guessed from home squares. Use the **Turn** selector to override.

## Notes
- After editing any file, hit the reload icon on the extension card, then refresh the page.
- Doesn't work on `chrome://` pages, the Web Store or the built-in PDF viewer.
- Chess.com and lichess forbid engine help in live games against real opponents. Use it for analysis, review and games you aren't playing.

Pieces: lichess's cburnett set (`pieces/`), GPL-compatible, same as lichess's default look.
