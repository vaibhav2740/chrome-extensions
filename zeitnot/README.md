# Zeitnot

*Zeitnot* is chess for time trouble. This Manifest V3 extension follows the FIDE World Chess Championship live:
match score, win/draw/loss odds for the game on, title odds for the match, both clocks ticking, and a toolbar badge that
shows the eval or a countdown. Data comes from the free Lichess broadcast. No account, no keys, no server.

Not affiliated with FIDE or Lichess. See [PRIVACY.md](PRIVACY.md): nothing is collected.

## What you get

* **Scoreboard.** Both players in fixed positions and colours (champion left, amber; challenger right, cyan), the score, a race
  to 7½, title odds and the chance the match goes to a 7–7 tiebreak.
* **The 14 games at a glance.** A strip of results that is also the navigation (click, or ← →; **L** jumps to the live game,
  **R** syncs). Open any finished game for its chart and final clocks.
* **The game on.** Win/draw/loss by player, both clocks ticking, who is to move, the time-control phase (moves 1–40 have no
  increment; the +30 min and +30 s/move arrive at move 41), an eval chart or a zoomed clocks chart with hover, and **the
  stakes**: what a win, a draw or a loss would do to the title odds.
* **Follow a player** (the ☆). The badge turns green or red for them and the stakes are about them.
* **Spoiler shield.** Scores, odds, results and evals are not even put in the page until you reveal them; the badge shows only
  LIVE. For when you are watching on delay.
* **Stream delay.** Click the running clock and type what your stream shows. The offset sticks across moves.
* **Notifications** (off by default; Chrome asks when you switch one on): a game starts in 10 minutes, a game finishes, a
  player is under 5 minutes with no increment before move 40.
* **Toolbar badge:** the eval (from your player's side, or White's), your player's title odds, or just LIVE; a countdown
  pill in the last hour before a game; the champion's initials when it is over. Alt+Shift+Z opens the popup.

## How the odds work (and what they are not)

A transparent heuristic, in `shared/odds.js`, not a prediction service:

1. The engine eval, if there is one, plus a **time hazard** from the clock ratio and from absolute time scarcity.
2. A **rating prior** (ratings from the broadcast, plus a small subjective `form`/`rapid` nudge per player in
   `shared/event.js`) that fades as the game gives real information.
3. A draw-adjusted win/draw/loss split around that.
4. An **exact dynamic programme** over the unplayed games for the match odds. The tests check it against a brute-force
   enumeration.

The live PGN carries **no engine evals**, so Zeitnot asks Lichess' cloud eval once per position. When even that has nothing,
the popup says so and the odds come from ratings, colours and clocks only, instead of pretending the eval is 0.00.

## How it stays light

Lichess' CDN caches every response for 10 s, so polling faster is pointless. A warm sync is three small requests (tour list,
live round JSON, live round PGN); pairings and finished results are cached for good. The service worker polls every 30 s while
a game is on, every minute in the hour before one, then every 5 or 30 minutes, and every 12 hours once the match is decided.
It backs off after errors and honours HTTP 429. The popup never fetches: it reads what the worker saved.

```
zeitnot/
├── manifest.json            MV3; storage + alarms + lichess.org; notifications is optional
├── background.js            the only fetcher and writer: alarms, snapshot, badge, notifications
├── popup/                   popup.html / .css / .js: reads storage, asks the worker to sync, redraws
├── shared/
│   ├── event.js             which tournament and which two players (change this for the next match)
│   ├── lichess.js           fetch client: timeout, 429 cool-down, CDN Age
│   ├── tournament.js        Lichess -> snapshot (fetch policy, caching, scoring)
│   ├── pgn.js               single-pass PGN reader (clocks, evals)
│   ├── odds.js              game odds + match DP
│   ├── live.js              the clock and odds "right now" from a stored sample
│   ├── badge.js notify.js schedule.js settings.js chart.js summary.js format.js keys.js
├── icons/                   icon.svg + icon-small.svg -> PNGs (scripts/make-icons.py)
├── scripts/                 make-icons.py, pack.sh
└── test/                    node:test + jsdom, real captured Lichess responses as fixtures
```

## Develop

```bash
npm install          # jsdom, for the popup tests only
npm test             # about 100 tests, a couple of seconds
npm run icons        # re-render icons/*.png from the SVGs (macOS: Quick Look + Pillow + numpy)
npm run pack         # ../zeitnot-<version>.zip for the Chrome Web Store
```

The popup tests run the real `popup.html`, `popup.js` and `background.js` together against a fake Lichess. Nothing here has
been run in a real Chrome tab by the tests, so check a live game in the browser.

## Install

1. `chrome://extensions` → turn on **Developer mode**.
2. **Load unpacked** → pick this `zeitnot` folder (reload it after pulling).
3. Pin **Zeitnot** to the toolbar.

For the next championship, set the broadcast id and the two players in `shared/event.js`.
