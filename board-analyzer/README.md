# Board Analyzer (personal Chrome extension)

A floating, draggable analysis board for any page, powered by Stockfish 19 (lite, single-thread WASM) running entirely in your browser. It reads the position on chess.com and lichess, then shows the best move, evaluation and top lines in a clean liquid-glass panel. No server, nothing leaves your machine.

## Install
1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick this folder (`~/personal/chrome-extensions/board-analyzer`)
4. Pin it via the puzzle-piece icon

## Use
- Click the extension icon (or **Alt+Shift+A**) on any normal web page to show/hide the panel. Drag the top bar to move it.
- **Snapshot**: reads the board currently displayed on the page, then shows the best move, eval and top lines.
- **Auto-follow**: re-reads the board every 0.8s and re-analyzes whenever it changes (live games, stepping through moves).
- Paste any FEN and press **Analyze** (works on every site).
- **Move pieces** like on an analysis board: drag and drop, or click a piece then its destination. Legal moves show as dots, the last move is highlighted, and a picker appears for promotions. Either side can move (the turn follows the piece you move), so a wrongly guessed side-to-move never locks the board. **←** / **→** (or the undo/redo buttons) step through your moves. Playing a move pauses Auto-follow so the page does not overwrite your line; press Snapshot to return to the real position.
- **Lichess / Chess.com / Copy FEN**: continue the exact same position (with your Turn override and board orientation) on the Lichess or Chess.com analysis board in a new tab, or copy the FEN. These links are built from each site's documented URL pattern.
- Header buttons: the corner-brackets button switches between the **full panel and a compact view** (board, best move, Snapshot, Auto-follow, undo/redo/flip and a Lichess link; the choice is remembered), **–** minimizes the panel to a slim pill (also: double-click the header), **×** hides it. The panel opens near the top and always keeps itself fully on screen. Click the toolbar icon (or Alt+Shift+A) to bring it back.
- **Style** (Auto / Glass / Basic): Glass uses a blur effect; Basic is a solid panel that is lighter on weak devices or over playing video. Auto picks Basic for "reduce transparency" users and very low-end devices.
- Turn / Depth / Lines controls; the flip button turns the board around.
- The panel resizes itself to fit; the glass frame follows the content.

## How the position is read
- chess.com: piece elements (`.piece.wp.square-52`) from the board DOM, plus the page's own `game.getFEN()` (read in the page's JS world) for turn, castling and en passant when it matches what is displayed.
- lichess: piece positions from `cg-board`, plus `lichess.analysis.node.fen` on analysis pages.
- If only the DOM is available, side to move comes from the last-move highlight and castling rights are guessed from home squares. Use the **Turn** selector to override.

## Notes
- After editing any file, hit the reload icon on the extension card, then refresh the page.
- Doesn't work on `chrome://` pages, the Web Store or the built-in PDF viewer.
- Chess.com and lichess forbid engine help in live games against real opponents. Use it for analysis, review and games you aren't playing.

Pieces: lichess's cburnett set (`pieces/`), GPL-compatible, same as lichess's default look.
