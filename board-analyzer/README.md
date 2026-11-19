# Board Analyzer (personal Chrome extension)

A floating, draggable analysis board for any page, powered by Stockfish 19 (lite, single-thread WASM) running entirely in your browser. It reads the position on chess.com and lichess, or **scans a board from any picture, screenshot or paused video frame**, then shows the best move, evaluation and top lines in a clean liquid-glass panel. No server, nothing leaves your machine.

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
- **Scan** (the viewfinder button next to Snapshot): read a position from a picture, see below.
- **Move pieces** like on an analysis board: drag and drop, or click a piece then its destination. Legal moves show as dots, the last move is highlighted, and a picker appears for promotions. Either side can move (the turn follows the piece you move), so a wrongly guessed side-to-move never locks the board. **←** / **→** (or the undo/redo buttons) step through your moves. Playing a move pauses Auto-follow so the page does not overwrite your line; press Snapshot to return to the real position.
- **Lichess / Chess.com / Copy FEN**: continue the exact same position (with your Turn override and board orientation) on the Lichess or Chess.com analysis board in a new tab, or copy the FEN. These links are built from each site's documented URL pattern.
- Header buttons: the corner-brackets button switches between the **full panel and a compact view** (board, best move, Snapshot, Auto-follow, undo/redo/flip and a Lichess link; the choice is remembered), **–** minimizes the panel to a slim pill (also: double-click the header), **×** hides it. The panel opens near the top and always keeps itself fully on screen. Click the toolbar icon (or Alt+Shift+A) to bring it back.
- **Style** (Auto / Glass / Basic): Glass uses a blur effect; Basic is a solid panel that is lighter on weak devices or over playing video. Auto picks Basic for "reduce transparency" users and very low-end devices.
- Turn / Depth / Lines controls; the flip button turns the board around.
- The panel resizes itself to fit; the glass frame follows the content.

## Scanning a board from a picture
Works on YouTube and other videos, articles, PDFs, photos of a screen and chess sites. Press the viewfinder button, then:
1. Get a picture: **Capture this tab**, paste one (Ctrl/⌘+V), drop a file on the panel, or **Choose file**. Capture needs one click on the toolbar icon on that tab first (Chrome's `activeTab` rule); the panel hides itself so it is not in the picture.
2. Optionally drag a box around the board. Without a box the whole picture is searched; a box is faster and a bit more reliable.
3. **Read position**. The reader finds the board, reads all 64 squares and shows them on an editable board. Squares it is unsure about get an orange dashed outline.
4. Fix anything wrong: drag pieces (drop one off the board to remove it), or pick a piece or the eraser from the palette and tap squares. Choose which side is at the **bottom of the picture** and who is **to move**: a picture cannot always say (a lone king and pawn look the same either way up). Castling boxes are only offered where king and rook stand on their home squares.
5. **Analyze** sends the position to the panel (Auto-follow is switched off, press Snapshot to go back to the page). Analyze stays disabled while the position is impossible (missing king, pawn on the last row, side not to move in check...).

How it works and what to expect:
- Reading happens on your device: the `scanner/` folder holds two small neural networks (about 46 MB in total, the open-source [chessimg2pos](https://github.com/mdicio/chessimg2pos) v2 models shrunk to 8-bit) and ONNX Runtime Web. Nothing is uploaded and no account or key is needed.
- It runs in a background worker and is shut down after two idle minutes, so the memory (a few hundred MB while it runs) is only held while you scan. A scan takes about a second on a normal computer; the first one also loads the models.
- On my synthetic tests it reads clean screenshots essentially always, boards on busy 1080p pages about 9 times in 10 and low-contrast video frames less often. Real photos at an angle are the hardest case. Treat the result as a suggestion and check the outlined squares.
- If the worker cannot start (some locked-down browsers), the same code runs on the page instead.
- Licences and how the models were made: `scanner/NOTICE.md`, `scripts/quantize-models.py`.

## How the position is read from chess.com and lichess
- chess.com: piece elements (`.piece.wp.square-52`) from the board DOM, plus the page's own `game.getFEN()` (read in the page's JS world) for turn, castling and en passant when it matches what is displayed.
- lichess: piece positions from `cg-board`, plus `lichess.analysis.node.fen` on analysis pages.
- If only the DOM is available, side to move comes from the last-move highlight and castling rights are guessed from home squares. Use the **Turn** selector to override.

## Permissions
`activeTab` (act on the tab where you click the icon, also what allows the screenshot), `scripting` (insert the panel and read the page's own board object) and `storage` (your settings). No access to other sites, no network requests.

## Development
```
npm install      # jsdom and pngjs, tests only
npm test         # panel UI, scan sheet, and the real models on test pictures (about 30 s)
npm run pack     # ../board-analyzer-<version>.zip for the Chrome Web Store (no tests or node_modules)
```
The scanner's pipeline is in `scanner/core.js` (pure JS), `engine.js` (ONNX Runtime), `runner.js` + `worker.js` (browser decoding and worker), `client.js` (what the panel talks to); the sheet is `scan-ui.js`. `test/fixtures/` holds a few synthetic boards with their answers.

## Notes
- After editing any file, hit the reload icon on the extension card, then refresh the page.
- Doesn't work on `chrome://` pages, the Web Store or the built-in PDF viewer.
- Chess.com and lichess forbid engine help in live games against real opponents. Use it for analysis, review and games you aren't playing.

Pieces: lichess's cburnett set (`pieces/`), GPL-compatible, same as lichess's default look.
