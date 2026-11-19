# Publishing Pawnshot and selling Premium

Everything needed to put Pawnshot on the Chrome Web Store (and Edge Add-ons) and start selling Premium.
Steps marked **(you)** need your accounts; the code side is done.

## 1. What is free and what is Premium

| | Free | Premium |
|---|---|---|
| Analysis board, Stockfish 19 on the device | ✓ | ✓ |
| Read chess.com / lichess boards (exact, with turn and castling) | ✓ | ✓ |
| Picture scans (video frame, screenshot, file, paste) | Unlimited | Unlimited |
| Follow a chess.com / lichess board | ✓ | ✓ |
| **Follow a video** (the board keeps up with the video by itself, move by move) | 10 minutes a day | Unlimited |
| Search depth / lines | 20 / 3 | 30 / 5 |
| Board colours | 2 | 6 |
| Edit position, FEN, open on Lichess / Chess.com, compact view | ✓ | ✓ |

Why this split:
- The market leader (chessvision.ai) gives its extension's scans away free and without a limit. A scan limit would
  only cost us installs and reviews, so scans are unlimited.
- Following a video by itself is the one thing the others don't do, so that is what Premium sells. 10 free minutes a
  day is about one typical game-analysis video: enough to see it work and get used to it. People who watch long
  streams or many videos are the ones who pay. The minutes count only while the panel is on screen and the tab is
  visible.
- Nothing costs us money per user (it all runs on the device), so Premium has no running costs.

The numbers live in `plan.js` (`FREE_LIMITS`, `PREMIUM_LIMITS`, `THEMES`): change them there.

**Price: one-time, no subscription. $6.99 lifetime at launch, $9.99 once there are about 20 reviews.**
- chessvision.ai's membership is $5.99 a month or $45.99 a year and ScanChess is $4.99 a month or $29.99 a year
  (third-party figures; check their sites). "Pay once, $6.99, no account" is an easy yes next to those, and it is
  fair because Pawnshot has no servers to pay for.
- Under $10 is an impulse buy. Lemon Squeezy keeps about 5% + 50¢, so $6.99 leaves you about $6.15 before payout fees.
- Don't start with a subscription: a monthly fee for a tool that costs nothing to run invites "greedy" 1-star reviews,
  and renewals and refunds add work. For a launch push, use a discount code (say 30% off for the first week) rather
  than changing the price.
- Honest expectations: browser extensions usually convert 1–3% of active users to paid. At 5,000 weekly users and 2%,
  that is about 100 sales, around $600, then a trickle as new people install. More than pocket money needs tens of
  thousands of users, and those come from a good demo and reviews (section 6), not from the price.

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
  priceLabel: '$6.99 one-time',
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

1. `npm test` (every suite must pass), then `npm run pack` → `../pawnshot-2.0.0.zip` (~35 MB; the limit is far higher).
2. https://chrome.google.com/webstore/devconsole → New item → upload the zip.
3. Fill the listing with the text below, upload the screenshots (section 5), set the privacy practices (section 4).

**Name** (from the manifest, 49 chars): `Pawnshot: Chess Video Analysis & Position Scanner`

Why this name:
- The store finds items mostly by the words in the name and summary, then ranks them by installs, ratings and how
  many people keep them. So the words after the colon do the finding, and "Pawnshot" is the brand people remember
  and pass on.
- "Chess Video Analysis" is what only Pawnshot does, and hardly any other item uses those words, so it can rank at
  the top for them. "Position Scanner" is the phrase the market leader made common, so Pawnshot also shows up next to
  it for people looking for a scanner.
- Stockfish is in the summary, not the name: a name starting with "Stockfish" lands among the cheating bots.
- Keep out of the name: "live", "helper", "bot" (they read like a cheating tool) and chess.com, lichess, YouTube or
  Twitch (other brands in a title get items rejected as misleading). In the description, don't repeat a search word
  over and over or list many brands: Google's keyword-spam rule rejects that.
- "Pawnshot" itself is short, unique (no other chess product found under it) and says chess + snapshot. Its one weak
  spot: heard aloud it can be typed "pawnshop", so always give the store link with it.

**Summary** (manifest description, 132 of 132 chars):
`Follow a chess video move by move with Stockfish on your device. Scan a board from YouTube, a screenshot or picture. Fair-play safe.`

**Category:** Tools (second choice: Education). **Language:** English.

**Description:**

```
Watching chess on YouTube and wondering what the engine thinks? Pawnshot keeps an analysis board in step with the video.

FOLLOW A VIDEO, MOVE BY MOVE
Turn on Follow and the panel board plays each move as it happens in the video, with the best move, the evaluation bar
and the top engine lines ready whenever you glance at it. The whole move list is kept: step back with the arrow keys
and catch up again. Fast enough for blitz: a move shows up a fraction of a second after the piece lands, and moves too
quick to see are worked out from the position. Free: 10 minutes a day. Premium: as long as you like.

SNAPSHOT ANY BOARD, UNLIMITED
Press Snapshot and Pawnshot reads the position from wherever it is:
• videos: straight from the video picture, no screenshot needed
• chess.com and lichess analysis boards: exact, including whose move it is and castling
• any page, book, PDF or picture: from a screenshot, a file, or paste (Ctrl+V)

PRIVATE: IT ALL RUNS ON YOUR COMPUTER
The board reader is an on-device neural network and Stockfish 19 runs inside your browser. No picture or position is
uploaded. No account, no sign-up, no ads, no tracking.

PLAY THROUGH IDEAS
Drag pieces on the panel board, step back and forth, fix any square in the edit mode, then open the position on the
Lichess or Chess.com analysis board in one click. Minimize Pawnshot to a small pill that shows just the best move.

FAIR PLAY BUILT IN
Pawnshot is for learning, not cheating. It switches itself off while a game or a rated puzzle is in progress on
chess.com, chesskid.com or lichess, the same rule those sites use for their own analysis, and turns back on when the
game is over. It never reads a live camera or a screen share.

LIGHT ON YOUR COMPUTER
• Follow compares a small picture of the board and wakes the board reader only when it has to
• Works on modest laptops and Chromebooks: a lighter style and search are picked automatically
• Nothing runs while the panel is hidden

FREE AND PREMIUM
Free: the full analysis board, unlimited scans, chess.com and lichess boards, Follow a video 10 minutes a day, depth 20
with 3 lines.
Premium (one-time purchase, no subscription): Follow videos without a limit, depth 30 with 5 lines, extra board colours.

Open source (GPL-3.0). Uses Stockfish (GPL-3.0) and the chessimg2pos board reader (MIT).
Not affiliated with chess.com, lichess or YouTube.
```

Keep the "Fast enough for blitz" sentence only if it holds up on a real stream (section 7).

## 4. Privacy practices tab

- **Single purpose:** "Shows a chess analysis board on web pages: reads a chess position from the page, a video or a
  picture and analyses it with an on-device chess engine."
- **activeTab:** "To read the chess position or take a screenshot of the tab, only after the user clicks the toolbar
  icon on that tab."
- **scripting:** "To show the analysis panel on the tab the user opened it on, and to read the chess site's own board
  data there."
- **storage:** "To remember the user's settings and, on the free plan, how many minutes of video following were used
  today."
- **Optional host permissions (api.lemonsqueezy.com, api.gumroad.com):** "Requested only when the user activates a
  Premium license key, to check the key with the shop that sold it."
- **Remote code:** No. **Data collection:** tick nothing; certify the three disclosures.
- **Privacy policy URL:** `https://github.com/vaibhav2740/chrome-extensions/blob/main/board-analyzer/PRIVACY.md`

## 5. Screenshots, demo video and artwork (you)

Required: at least one screenshot, **1280×800** (or 640×400), PNG/JPEG. Upload 5. Small promo tile 440×280 is
recommended (needed to be featured). Shoot them in Chrome at 1280×800 with the panel on the right:

1. **Follow on a video (hero shot):** a playing game video with the panel next to it, the move list in step and the
   best-move arrow. Caption: "The board follows the video, move by move".
2. Snapshot of a board from a screenshot or a book page. Caption: "Scan any board: video, screenshot, picture".
3. The minimized pill showing "Nf3 +0.4" over the playing video. Caption: "Out of the way while you watch".
4. The fair-play lock card on a chess.com game ("Game in progress"). Caption: "Fair play: off during live games".
5. The settings page, Free vs Premium comparison. Caption: "Free to use. Pay once for unlimited Follow".

The listing also takes a YouTube video. A 30–60 second screen recording of Follow keeping up with a fast game is the
most convincing thing you can show, and it doubles as the post for section 6. Use a video you made (for example a
lichess game replayed on screen) or one you have permission for; someone else's channel and face in your advert can
get the listing reported.

Store the files in `store/` (not shipped in the zip).

## 6. How Pawnshot competes, and after publishing

Who is there (checked November 2026):
- **chessvision.ai**: the leader, about 100K users and 4.6★ from about 780 ratings. Its extension scans are free and
  unlimited: pause, scan, get the analysis. The picture is read on its server. It also has phone apps and an ebook
  reader; membership $5.99 a month or $45.99 a year (third-party figures).
- **ScanChess**: picture scans with credits, $4.99 a month or $29.99 a year, nothing for video.
- A few small ones (ChessRadarPro, which is paid; ChessInsights AI; ChessExpert).

Don't fight chessvision.ai on scanning: it has years of reviews and a reader trained on far more real pictures. Win
where it is not:
1. **Follows a video by itself, move by move.** None of the others say they do. Lead with it everywhere: the name, the
   first screenshot, the demo video, every post.
2. **Private and offline.** Nothing uploaded, no account.
3. **Pay once.** No subscription.
4. **Fair play built in**, which matters to communities that ban cheating tools.

Weak spots, and be upfront about them: new, with no reviews yet; no phone app or ebook reader; a 35 MB download; Follow
is tested on synthetic boards, not yet on many real videos.

After publishing:
- **Edge Add-ons** (free): https://partner.microsoft.com/dashboard/microsoftedge → upload the same zip. Fewer
  competitors there.
- **Reviews move the ranking most.** Ask the first users directly (friends, the people who reply to your posts).
- Post where learners are: r/chess and r/chessbeginners (as "I made a free tool that follows chess videos; it locks
  itself during live games"), chess Discord servers, and the demo video as a YouTube Short. Read each community's rules
  on self-promotion first.

## 7. Check on real pages before submitting (you)

These can only be checked in a real browser, which I don't drive for you:

- **Fair-play lock** on chess.com: start a game vs a bot and a 1-minute game: the panel must show "Game in progress"
  and Snapshot must do nothing. After the game ends, the lock should lift (if it stays locked on chess.com's
  end-of-game screen, send me that page's HTML around the clocks/result and I'll add the marker). Also check
  lichess: an ongoing game, a finished one, /analysis, a puzzle.
- **Video frames** on YouTube: Snapshot on a paused chess video should not blink the panel. On a site that forbids
  reading its video it falls back to a screenshot.
- **Follow video, normal speed**: a few minutes on a game-analysis video. Watch the moves arrive; going back in the
  video should go back in the move list. Full-screen the video too (needs Chrome 133+ for the panel to come along).
- **Follow video, blitz and bullet**: a streamer's screen with a big board, for a few minutes. Count missed or wrong
  moves. A wrong move should fix itself within a few seconds (the reader double-checks in quiet moments). Note
  whether the laptop gets hot. Send me what goes wrong, with the time in the video.
- **Small board in a broadcast**: on a tournament stream with the board small among the cameras, if Follow says no
  board was found, press Snapshot, then **Select board** and draw the box. Follow should then watch that area.
- **Free minutes**: on the free plan, Follow a video and check that the plan line counts down and that Follow stops
  with the Premium sheet when the 10 minutes are used.
- **Licence**: one real (100%-discounted) purchase, activate, remove, activate again.
- **Low-end check**: if you have an old laptop or Chromebook, open the panel on a playing video with Basic style and
  Follow on.
