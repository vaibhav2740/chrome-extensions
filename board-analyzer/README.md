# Board Analyzer (personal Chrome extension)

A floating, draggable analysis board for any page, powered by Stockfish 19 (lite, single-thread WASM) running entirely in your browser. It reads the position on chess.com and lichess, or **scans a board from any picture, screenshot or paused video frame**, then shows the best move, evaluation and top lines in a clean liquid-glass panel. No server, nothing leaves your machine.

## Install
1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick this folder (`~/personal/chrome-extensions/board-analyzer`)
4. Pin it via the puzzle-piece icon

## Use
- Click the extension icon (or **Alt+Shift+A**) on any normal web page to show/hide the panel. Drag the top bar to move it.
- **Snapshot**: reads the position from the page or the screen (see below), then shows the best move, eval and top lines.
- **Auto-follow**: re-reads the board every 0.8s and re-analyzes whenever it changes (live games, stepping through moves).
- Paste any FEN and press **Analyze** (works on every site).
- **Move pieces** like on an analysis board: drag and drop, or click a piece then its destination. Legal moves show as dots, the last move is highlighted, and a picker appears for promotions. Either side can move (the turn follows the piece you move), so a wrongly guessed side-to-move never locks the board. **←** / **→** (or the undo/redo buttons) step through your moves. Playing a move pauses Auto-follow so the page does not overwrite your line; press Snapshot to return to the real position.
- **Lichess / Chess.com / Copy FEN**: continue the exact same position (with your Turn override and board orientation) on the Lichess or Chess.com analysis board in a new tab, or copy the FEN. These links are built from each site's documented URL pattern.
- Header buttons: the corner-brackets button switches between the **full panel and a compact view** (board, best move, Snapshot, Auto-follow, undo/redo/flip and a Lichess link; the choice is remembered), **–** minimizes the panel to a slim pill (also: double-click the header), **×** hides it. The panel opens near the top and always keeps itself fully on screen. Click the toolbar icon (or Alt+Shift+A) to bring it back.
- **Style** (Auto / Glass / Basic): Glass uses a blur effect; Basic is a solid panel that is lighter on weak devices or over playing video. Auto picks Basic for "reduce transparency" users and very low-end devices.
- Turn / Depth / Lines controls; the flip button turns the board around.
- The panel resizes itself to fit; the glass frame follows the content.

## Snapshot: one button for the page or the screen
**Snapshot** reads the position, whatever you are looking at:
- On chess.com and lichess it reads the page's own board data. That is instant and exact, and the only way to also know whose move it is, castling rights and en passant.
- Anywhere else (YouTube and other videos, articles, PDFs, a photo of a screen) it takes a picture of the whole screen, finds the board and reads it, then goes **straight to analysis**. No confirmation step. Shift+click always uses the screen.
- Capturing the screen needs one click on the toolbar icon on that tab first (Chrome's `activeTab` rule). The panel hides itself for a moment so it is not in the picture.

A picture can be wrong, so the note under the board says what happened and what you can do:
- Squares the reader is unsure about get an orange dashed outline.
- **Edit** opens the edit mode (below). **Wrong way up** appears when the picture cannot say which side is at the bottom (a few pieces look the same either way up). **Select board** lets you draw a box around the board on the picture and read only that.
- If what was read cannot be a real position (a missing king, say) the editor opens on it so you can fix it. If no board is found at all you get a clear message instead of an empty board.

A picture from a file is the side option (the picture button): choose one, or paste or drop an image anywhere on the panel, and it is read the same way.

**Edit** (the pencil) works on any position, from the page, a FEN or a scan: the board becomes editable. Drag pieces anywhere (drop one off the board to remove it), or pick a piece or the eraser and tap squares. Choose who is to move and the castling rights (offered only where king and rook stand on their home squares). **Done** analyses it, and Undo brings back the previous position. Done stays disabled while the position is impossible (missing king, pawn on the last row, side not to move in check...).

How reading a picture works and what to expect:
- It happens on your device: the `scanner/` folder holds two small neural networks (about 46 MB in total, the open-source [chessimg2pos](https://github.com/mdicio/chessimg2pos) v2 models shrunk to 8-bit) and ONNX Runtime Web. Nothing is uploaded and no account or key is needed.
- It runs in a background worker that is shut down after two idle minutes, so the memory (a few hundred MB while it runs) is only held while you scan. A scan takes about a second on a normal computer; the first one also loads the models.
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
Where things are: `panel.js` wires the panel together. Small modules do one job each: `engine-client.js` (Stockfish), `board-view.js` (drawing the board), `editor.js` (edit mode), `scan-flow.js` (capture and read), `crop-ui.js` (select the board), `links.js`, `settings.js`, `notation.js`. The reader itself is in `scanner/`: `core.js` (pure JS pipeline), `engine.js` (ONNX Runtime), `runner.js` + `worker.js` (browser decoding and worker), `client.js` (what the panel talks to). `test/fixtures/` holds a few synthetic boards with their answers.

## Notes
- After editing any file, hit the reload icon on the extension card, then refresh the page.
- Doesn't work on `chrome://` pages, the Web Store or the built-in PDF viewer.
- Chess.com and lichess forbid engine help in live games against real opponents. Use it for analysis, review and games you aren't playing.

Pieces: lichess's cburnett set (`pieces/`), GPL-compatible, same as lichess's default look.
