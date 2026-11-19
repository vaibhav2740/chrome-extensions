# chrome-extensions

Small Chrome extensions (Manifest V3). Load them unpacked; Pawnshot is also being prepared for the Chrome Web Store.

| Extension | What it does |
|---|---|
| [Pawnshot](board-analyzer) | Floating liquid-glass analysis board with in-browser Stockfish 19 on any page. Reads the board from chess.com / lichess or scans one from any picture or YouTube video (on-device AI, nothing uploaded), can follow a video move by move, shows the best move and lines, and lets you play moves on the panel board. Locks itself during live games and puzzles. Free plan plus a one-time Premium. |
| [regqube-ai-player](regqube-ai-player) | **Krillion Bot** — AI sidekick for Krillion Puffer Party. Reads the category, lines up answers with Groq + Gemini, tracks what others said, and can play your turn automatically. Needs your own API keys (see its README). |

## Install any extension
1. `git clone git@github.com:vaibhav2740/chrome-extensions.git`
2. Open `chrome://extensions`, turn on **Developer mode**
3. **Load unpacked** and pick the extension's folder (e.g. `board-analyzer` or `regqube-ai-player`)

## License
GPL-3.0 (the Stockfish engine bundled in `board-analyzer` is GPLv3). Piece graphics are the cburnett set. The board scanner uses MIT-licensed parts (chessimg2pos models, ONNX Runtime Web); see `board-analyzer/scanner/NOTICE.md`.
