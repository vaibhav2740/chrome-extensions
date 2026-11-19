# Publishing Pawnshot and selling Premium

Everything needed to put Pawnshot on the Chrome Web Store (and Edge Add-ons) and start selling Premium.
Steps marked **(you)** need your accounts; the code side is done.

## 1. What is free and what is Premium

| | Free | Premium |
|---|---|---|
| Analysis board, Stockfish 19 on the device | ✓ | ✓ |
| Read chess.com / lichess boards (exact, with turn and castling) | ✓ | ✓ |
| Picture scans (video frame, screenshot, file, paste) | 10 a day | Unlimited |
| Follow a chess.com / lichess board | ✓ | ✓ |
| **Follow a video** (the board keeps up with YouTube etc., move by move) | – | ✓ |
| Search depth / lines | 20 / 3 | 30 / 5 |
| Board colours | 2 | 6 |
| Edit position, FEN, open on Lichess / Chess.com, compact view | ✓ | ✓ |

Why this split: the free plan has to be good enough for 5-star reviews (a casual viewer never hits a limit), and the
limits sit where a heavy user gets real value from paying (many scans a day, hands-free video following). Nothing
costs us money per user (it all runs on the device), so Premium has no running costs.

The numbers live in `plan.js` (`FREE_LIMITS`, `PREMIUM_LIMITS`, `THEMES`): change them there.

**Price suggestion:** one-time **$4.99 lifetime** at launch (impulse-buy price, no subscription to manage or refund),
raise to $7.99 once there are reviews. If you prefer recurring income: $1.99/month or $14.99/year. Look at what the
other board-scanner extensions charge before you settle; a low one-time price is easy to say yes to.

**Honest caveat:** Pawnshot is GPL-3.0 (it has to be, because it ships Stockfish) and the repo is public, so anyone may
build a copy without the paywall. That is allowed and normal for GPL software; people pay for the convenience of the
store version, updates and support. Don't add licence terms that forbid redistribution (the GPL doesn't allow that).

## 2. Payments: pick a shop (you)

Chrome Web Store has no built-in payments any more, so Premium is sold through a shop that issues licence keys. The
extension supports two; both have no monthly fee (they take a cut per sale) and both pay out to India.

1. **Lemon Squeezy (recommended).** Merchant of record: it charges the right VAT/GST in every country for you, issues
   keys with an activation limit, and has a licence API made for apps. Payouts to India go through PayPal (bank
   payouts go through Stripe, which is reported to be invite-only for new Indian accounts). Fee about 5% + 50¢ per
   sale; check their pricing page.
   - Create a store, then a product "Pawnshot Premium" with **License keys: on**, activation limit 3, no expiry (for
     lifetime) and your price.
   - Note the **store ID** (Settings → Stores) and the **product ID** (the number in the product's URL).
   - Copy the product's checkout link (Share → "Checkout link").
2. **Gumroad.** Simplest sign-up, also a merchant of record now. Its cut is higher (around 10% plus a per-sale fee;
   check the current pricing and the payout methods offered for India when you sign up). Create a product, tick
   **Generate a unique license key per sale**, and copy the product ID shown in that section.

Then fill in `premium-config.js`:

```js
export const PREMIUM_CONFIG = {
  provider: 'lemonsqueezy',           // or 'gumroad'
  checkoutUrl: 'https://<your-store>.lemonsqueezy.com/buy/<id>',
  priceLabel: '$4.99 one-time',
  lemonsqueezy: { storeId: 12345, productIds: [67890] },
  gumroad: { productId: '' },
  maxActivations: 3,
};
```

How it works for a buyer: ★ Premium in the panel → settings page → **Get Premium** (opens the checkout) → the key
arrives by email → paste it → Chrome asks once for permission to talk to the shop → Premium is on. The key is
re-checked about weekly; offline use keeps working for 30 days. A refunded or disabled key turns Premium off at the
next check. "Remove the key from this browser" frees an activation for another computer.

Test it before launch: make a 100% discount code in the shop, "buy" your own product, activate the key in an
unpacked copy. For testing features without buying, the settings page of an **unpacked** copy has a
"Developer: turn on Premium" switch (it does nothing in a store install).

## 3. Chrome Web Store listing (you)

One-time developer registration fee: **$5** (Google's, unavoidable). Edge Add-ons is free to publish on.

1. `npm test` (all four suites must pass), then `npm run pack` → `../pawnshot-2.0.0.zip` (~35 MB; the limit is far higher).
2. https://chrome.google.com/webstore/devconsole → New item → upload the zip.
3. Fill the listing with the text below, upload the screenshots (section 5), set the privacy practices (section 4).

**Name** (from the manifest, 50 chars): `Pawnshot: Chess Board Scanner & Stockfish Analysis`
People search the store for "chess", "stockfish", "chess analysis", "board scanner" and "chess position from image";
the name and summary carry those words. Don't add chess.com, lichess or YouTube to the name: brand names in a title get
items rejected as misleading. Mentioning them in the description is fine.

**Summary** (manifest description, 124 chars):
`Scan a chess board from any YouTube video, picture or web page and analyze it with Stockfish on your device. Fair-play safe.`

**Category:** Tools (second choice: Education). **Language:** English.

**Description:**

```
Watching a chess video and wondering what the engine thinks? Pawnshot reads the board for you.

Press Snapshot and Pawnshot reads the position from wherever it is:
• YouTube and other videos: straight from the video picture, no screenshot needed
• chess.com and lichess analysis boards: exact, including whose move it is and castling
• any page, book, PDF or picture: from a screenshot, a file, or paste (Ctrl+V)

Then it shows the best move with an arrow, the evaluation bar and the top lines from Stockfish 19, running entirely in
your browser. Nothing is uploaded: the board reader is an on-device neural network.

Play through ideas on the panel board: drag pieces, step back and forth with the arrow keys, fix any square in the
edit mode, then open the position on the Lichess or Chess.com analysis board in one click.

FOLLOW A VIDEO (Premium)
Turn on Follow and the board keeps up with the video by itself, move after move, with the analysis ready whenever
you glance at it. Minimize Pawnshot to a small pill that shows just the best move.

FAIR PLAY BUILT IN
Pawnshot is for learning, not cheating. It switches itself off while a game or a rated puzzle is in progress on
chess.com, chesskid.com or lichess, the same rule those sites use for their own analysis, and turns back on when the
game is over.

LIGHT ON YOUR COMPUTER
• Works on modest laptops and Chromebooks: a solid "Basic" style and a lighter search are picked automatically
• Nothing runs while the panel is hidden; the board reader unloads itself after two idle minutes
• No account, no sign-up, no ads, no tracking

FREE AND PREMIUM
Free: the full analysis board, chess.com and lichess boards, 10 picture scans a day, depth 20 with 3 lines.
Premium (one-time purchase): unlimited scans, Follow a video, depth 30 with 5 lines, extra board colours.

Open source (GPL-3.0). Uses Stockfish (GPL-3.0) and the chessimg2pos board reader (MIT).
Not affiliated with chess.com, lichess or YouTube.
```

## 4. Privacy practices tab

- **Single purpose:** "Shows a chess analysis board on web pages: reads a chess position from the page, a video or a
  picture and analyses it with an on-device chess engine."
- **activeTab:** "To read the chess position or take a screenshot of the tab, only after the user clicks the toolbar
  icon on that tab."
- **scripting:** "To show the analysis panel on the tab the user opened it on, and to read the chess site's own board
  data there."
- **storage:** "To remember the user's settings and, on the free plan, the number of scans used today."
- **Optional host permissions (api.lemonsqueezy.com, api.gumroad.com):** "Requested only when the user activates a
  Premium license key, to check the key with the shop that sold it."
- **Remote code:** No. **Data collection:** tick nothing; certify the three disclosures.
- **Privacy policy URL:** `https://github.com/vaibhav2740/chrome-extensions/blob/main/board-analyzer/PRIVACY.md`

## 5. Screenshots and artwork (you)

Required: at least one screenshot, **1280×800** (or 640×400), PNG/JPEG. Upload 5. Small promo tile 440×280 is
recommended (needed to be featured). Shoot them in Chrome at 1280×800 with the panel on the right:

1. A YouTube chess video, paused on a position, panel showing the best-move arrow and lines (hero shot).
2. Follow on a video: the minimized pill showing "Nf3 +0.4" over the playing video.
3. The fair-play lock card on a chess.com game ("Game in progress").
4. The edit mode with outlined uncertain squares after a scan from a picture.
5. The settings page, Free vs Premium comparison.

Add a one-line caption on each (e.g. "Scan any board from a video", "Fair play: off during live games").
Store the files in `store/` (not shipped in the zip).

## 6. After publishing

- **Edge Add-ons** (free): https://partner.microsoft.com/dashboard/microsoftedge → upload the same zip.
- Ask the first users for a review (the Chrome store ranks by installs, ratings and how often the words people search
  match the name and summary).
- Post where learners are: r/chess and r/chessbeginners (as "I made a free tool; it locks itself during live games"),
  chess Discord servers, and a short YouTube demo of Follow on a well-known video. Read each community's rules on
  self-promotion first.

## 7. Check on real pages before submitting (you)

These can only be checked in a real browser, which I don't drive for you:

- **Fair-play lock** on chess.com: start a game vs a bot and a 1-minute game: the panel must show "Game in progress"
  and Snapshot must do nothing. After the game ends, the lock should lift (if it stays locked on chess.com's
  end-of-game screen, send me that page's HTML around the clocks/result and I'll add the marker). Also check
  lichess: an ongoing game, a finished one, /analysis, a puzzle.
- **Video frames** on YouTube: Snapshot on a paused chess video should not blink the panel. On a site that forbids
  reading its video it falls back to a screenshot.
- **Follow video**: a few minutes on a game video, watch the moves arrive; full-screen the video (needs Chrome 133+ for
  the panel to come along).
- **Licence**: one real (100%-discounted) purchase, activate, remove, activate again.
- **Low-end check**: if you have an old laptop or Chromebook, open the panel on a playing video with Basic style.
