# Pawnshot privacy policy

_Last updated: 19 November 2026_

Pawnshot is a browser extension that shows a chess analysis board on web pages. This page explains what it does with data. The short version: **nothing about you or the pages you visit leaves your device.**

## What Pawnshot reads
- **The page you open it on, only when you ask.** Pawnshot runs on a tab only after you click its toolbar icon (or press its shortcut) on that tab. It then reads the chess board on the page (chess.com and lichess boards), the picture of a video on the page, or a screenshot of the visible tab, so it can show the position. This happens when you press Snapshot or turn on Follow.
- **Pictures you give it**, by choosing a file, pasting or dropping an image.

All of this is processed on your device by the built-in board reader and the Stockfish engine. Pictures and positions are never uploaded, stored on a server, or shared.

## What Pawnshot stores
In your browser's own extension storage (`chrome.storage.local`), on your device only:
- your settings (panel style, board colours, compact view, search depth, number of lines);
- on the free plan, how many minutes of following a video you used today;
- if you bought Premium, your license key and the result of its last check.

Uninstalling the extension deletes all of it.

## What Pawnshot sends over the network
- **Nothing**, unless you buy Premium.
- **If you activate a Premium key**, Pawnshot asks Chrome for permission to contact the shop that sold the key (Lemon Squeezy at `api.lemonsqueezy.com` or Gumroad at `api.gumroad.com`), then sends the key and a label for this browser ("Pawnshot on Chrome") to check it. The same check is repeated about once a week. The shop's own privacy policy covers your purchase (name, email, payment), which Pawnshot never sees except for the email address the shop returns with a valid key, which is shown to you on the settings page and stored only on your device.

Pawnshot has no analytics, no advertising, no tracking and no remote code.

## Children
Pawnshot does not knowingly collect any data from anyone, including children.

## Changes
If this policy changes, the new version will be published here with a new date.

## Contact
Questions: open an issue at https://github.com/vaibhav2740/chrome-extensions/issues
