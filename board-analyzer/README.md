# Pawnshot: chess analyzer and board scanner

A floating, draggable analysis board for any page, powered by Stockfish 19 (lite, single-thread WASM) running entirely in your browser. It reads the position on chess.com and lichess, or **scans a board from any picture, screenshot or video (YouTube included)**, then shows the best move, evaluation and top lines in a clean liquid-glass panel. No server, nothing leaves your machine.

It is made for learning, not cheating: it **switches itself off while a game or a rated puzzle is in progress** on chess.com, chesskid.com and lichess (see [Fair play](#fair-play)).

There is a free plan and a one-time Premium (unlimited picture scans, Follow a video, deeper search). How to publish it and sell Premium: [PUBLISHING.md](PUBLISHING.md). Privacy policy: [PRIVACY.md](PRIVACY.md).

## Install
1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick this folder (`~/personal/chrome-extensions/board-analyzer`; the folder keeps its old name)
4. Pin it via the puzzle-piece icon

## Use
- Click the extension icon (or **Alt+Shift+A**) on any normal web page to show/hide the panel. Drag the top bar to move it.
- **Snapshot**: reads the position from the page or the screen (see below), then shows the best move, eval and top lines.
- **Follow** keeps the panel in step with what you are watching:
  - on a chess.com / lichess analysis board or a finished game, it re-reads the board every 0.8 s and re-analyses when it changes (stepping through moves);
  - on a page with a video (YouTube and others; Premium), it watches the board in the video and plays each new move on the panel board, so the move list stays right. It reads only the board area, only after the picture has changed and settled, and slows down by itself on slow computers.
- Paste any FEN and press **Analyze** (works on every site).
- **Move pieces** like on an analysis board: drag and drop, or click a piece then its destination. Legal moves show as dots, the last move is highlighted, and a picker appears for promotions. Either side can move (the turn follows the piece you move), so a wrongly guessed side-to-move never locks the board. **←** / **→** (or the undo/redo buttons) step through your moves. Playing a move pauses Follow so the page does not overwrite your line; press Snapshot to return to the real position.
- **Lichess / Chess.com / Copy FEN**: continue the exact same position (with your Turn override and board orientation) on the Lichess or Chess.com analysis board in a new tab, or copy the FEN. These links are built from each site's documented URL pattern.
- Header buttons: the corner-brackets button switches between the **full panel and a compact view** (board, best move, Snapshot, Follow, undo/redo/flip and a Lichess link; the choice is remembered), **–** minimizes the panel to a slim pill that keeps showing the best move and evaluation (also: double-click the header), **×** hides it and stops everything. The panel opens near the top and always keeps itself fully on screen. Click the toolbar icon (or Alt+Shift+A) to bring it back.
- Turn / Depth / Lines controls; the flip button turns the board around.
- The gear opens the **settings page** (also in the extension's right-click menu → Options): panel **Style** (Auto / Glass / Basic; Basic is a solid panel that is lighter on weak devices or over playing video, Auto picks it for "reduce transparency" users and very low-end devices), board colours, compact view, default depth and lines, the keyboard shortcut, and the Premium key. Changes apply to open panels straight away.
- The panel resizes itself to fit; the glass frame follows the content.

## Snapshot: one button for the page, the video or the screen
**Snapshot** reads the position, whatever you are looking at:
- On chess.com and lichess it reads the page's own board data. That is instant and exact, and the only way to also know whose move it is, castling rights and en passant.
- On a page with a video (YouTube and others) it reads the current picture of the video itself, so the panel does not blink and nothing on top of the video gets in the way. If the site does not allow reading its video, it falls back to the screen.
- Anywhere else (articles, PDFs, a photo of a screen) it takes a picture of the whole screen, finds the board and reads it, then goes **straight to analysis**. No confirmation step. Shift+click always uses the screen.
- Capturing the screen needs one click on the toolbar icon on that tab first (Chrome's `activeTab` rule). The panel hides itself for a moment so it is not in the picture.
- Reading a picture counts as one scan on the free plan (10 a day); reading chess.com / lichess boards is never counted.

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

## Fair play
Engine help during a game is cheating on every chess site ([chess.com's fair-play policy](https://www.chess.com/legal/fair-play)). Pawnshot locks itself, and every way of reading the board (page, video, screen, Follow), while:
- a game is in progress on chess.com or chesskid.com (play, live, daily, variants pages) or on lichess and lichess-like sites (a game view with a running clock or move controls);
- a puzzle is open (chess.com puzzles; lichess training, streak, storm and racer).

The panel then shows "Game in progress" (or "Puzzle in progress") instead of the analysis, and unlocks by itself once the game is over. On those pages it fails closed: if it cannot tell that the game is over, it stays locked. While locked, the whole panel is off on that tab (FEN, pictures and the links too), so it cannot be worked around from the same page. The rules are in `fairplay.js`.

## Free and Premium
| | Free | Premium |
|---|---|---|
| Analysis board, chess.com / lichess boards, Follow on those boards, edit, links | ✓ | ✓ |
| Picture scans (video, screen, file, paste) | 10 a day | unlimited |
| Follow a video | | ✓ |
| Depth / lines | 20 / 3 | 30 / 5 |
| Board colours | 2 | 6 |

Limits live in `plan.js`. Premium is a licence key bought from Lemon Squeezy or Gumroad; the shop is set in `premium-config.js` (until it is filled in, the settings page says "Premium is coming soon"). The key is checked with the shop when it is entered and then about weekly (`license.js`); Premium keeps working offline for 30 days. To try Premium features without a key, an **unpacked** copy has a "Developer: turn on Premium" switch on the settings page (it does nothing in a store install).

## How the position is read from chess.com and lichess
- chess.com: piece elements (`.piece.wp.square-52`) from the board DOM, plus the page's own `game.getFEN()` (read in the page's JS world) for turn, castling and en passant when it matches what is displayed.
- lichess: piece positions from `cg-board`, plus `lichess.analysis.node.fen` on analysis pages.
- If only the DOM is available, side to move comes from the last-move highlight and castling rights are guessed from home squares. Use the **Turn** selector to override.

## Permissions
`activeTab` (act on the tab where you click the icon, also what allows the screenshot), `scripting` (insert the panel and read the page's own board object) and `storage` (your settings and today's scan count). Optional: `api.lemonsqueezy.com` / `api.gumroad.com`, asked for only when you enter a Premium key, to check it. No other network requests, no analytics.

## Development
```
npm install      # jsdom and pngjs, tests only
npm test         # panel UI, scan sheet, the real models on test pictures, fair play / plans / video (about 30 s)
npm run pack     # ../pawnshot-<version>.zip for the Chrome Web Store (no tests, node_modules or store docs)
```
The tests run offline in jsdom; they do not open a real browser, so the fair-play markers on the live chess.com and lichess pages and video reading on YouTube still need a check by hand (list in [PUBLISHING.md](PUBLISHING.md#7-check-on-real-pages-before-submitting-you)).

Where things are: `panel.js` wires the panel together. `content.js` is the page side (the panel frame, reading the page's board, the video and Follow on it) and `fairplay.js` decides when it is locked. `options.*` is the settings page; `plan.js`, `license.js` and `premium-config.js` are the Free/Premium side. Small modules do one job each: `engine-client.js` (Stockfish), `board-view.js` (drawing the board), `editor.js` (edit mode), `scan-flow.js` (capture and read), `crop-ui.js` (select the board), `links.js`, `settings.js`, `notation.js`. The reader itself is in `scanner/`: `core.js` (pure JS pipeline), `engine.js` (ONNX Runtime), `runner.js` + `worker.js` (browser decoding and worker), `client.js` (what the panel talks to). `test/fixtures/` holds a few synthetic boards with their answers.

## Notes
- After editing any file, hit the reload icon on the extension card, then refresh the page.
- Doesn't work on `chrome://` pages, the Web Store or the built-in PDF viewer.
- Chess.com and lichess forbid engine help in live games against real opponents. Pawnshot locks itself there (see Fair play); use it for analysis, review, videos and games you aren't playing.

Pieces: lichess's cburnett set (`pieces/`), GPL-compatible, same as lichess's default look.
