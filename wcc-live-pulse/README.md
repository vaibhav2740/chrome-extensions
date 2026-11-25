# WCC 2026 Live Pulse

A minimalist Manifest V3 Chrome Extension delivering live FIDE World Chess Championship probabilities, clock physics, match scores, and toolbar badge telemetry in an Apple Liquid Glass + Pawnshot HUD.

---

## Features

* **Multi-Factor Game & Match Probabilities:**
  * Real-time **White Win / Draw / Black Win** percentages calibrated for 2750+ classical WCC play.
  * **Exact Backward-Induction DP** across all 14 games (including remaining White/Black color balance, live match score, and 7–7 tiebreak risk).
  * Automatic color-swapping per round (e.g., Game 1: Sindarov White vs. Gukesh Black; Game 2: Gukesh White vs. Sindarov Black).
* **Authoritative Lichess Broadcast Sync:**
  * Reads live tour metadata (`qfkdt8mn`), full tournament PGN (`qfkdt8mn.pgn`), round JSON (`fen`, centisecond DGT clocks, `thinkTime`), and Lichess `cloud-eval` fallback.
  * Cleanly distinguishes **LIVE**, **FINISHED** (frozen final clocks + result), and **UPCOMING** (countdown to `startsAt`), with a 14-round segmented navigator (`‹` / `›` + quick Last/Next toggle).
  * **Clock Anchoring:** 15-second background polls never reset live countdowns or user stream calibrations mid-ply, and immediately snap to DGT clocks when a new move lands.
* **Phase-Aware FIDE Clock Physics:**
  * **Phase 1 (Moves 1–40):** `120m / 40 moves` with **0s increment**, modeling both log-ratio clock imbalance and absolute **zeitnot stress** (`S_i`).
  * **Phase 2 (Move 41+):** `+30m + 30s/move` increment horizon.
  * **Stream Calibration:** Click either clock while a game is `LIVE` to match your video stream; invalid edits are rejected gracefully.
* **Live Toolbar Badge Telemetry:**
  * Displays real-time Stockfish eval (`+0.4`, `-0.7`, `#3`) when `LIVE`, or a countdown pill (`7m`) in the final 30 minutes before a round starts.

---

## Architecture

```
wcc-live-pulse/
├── manifest.json                 # Manifest V3 config (ES module background worker)
├── background.js                 # Periodic Lichess alarm sync, clock anchor & toolbar badge
├── shared/
│   ├── probability_engine.js     # Zeitnot-aware WDL model + 14-game DP expectancy
│   └── wcc_data.js               # Lichess broadcast client, hardened PGN parser, clock anchor
├── popup/
│   ├── popup.html                # Liquid-glass layout & 14-round navigator
│   ├── popup.css                 # Specular glass sheen, open metrics, light/dark parity
│   └── popup.js                  # Live ticker, stream clock calibration & UI controller
├── icons/                        # Exact 16px, 48px, 128px PNG icons
└── test/
    └── wcc_pulse.test.mjs        # Automated Node unit & manifest integrity tests
```

---

## Testing & Verification

Run the automated test suite (Node 20+):

```bash
node --test wcc-live-pulse/test/wcc_pulse.test.mjs
```

---

## Install / Reload in Chrome

1. Open `chrome://extensions/` and turn on **Developer mode**.
2. Click **Load unpacked** (or **Reload 🔄** after updates) and select:
   ```bash
   ~/personal/chrome-extensions/wcc-live-pulse
   ```
3. Pin **WCC 2026 Live Pulse** to your toolbar.
