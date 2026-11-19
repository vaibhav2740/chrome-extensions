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
- Under $10 is an impulse buy. Gumroad keeps about 10% + 50¢, so $6.99 leaves you about $5.80 before payout fees.
- Don't start with a subscription: a monthly fee for a tool that costs nothing to run invites "greedy" 1-star reviews,
  and renewals and refunds add work. For a launch push, use a discount code (say 30% off for the first week) rather
  than changing the price.
- Honest expectations: browser extensions usually convert 1–3% of active users to paid. At 5,000 weekly users and 2%,
  that is about 100 sales, around $600, then a trickle as new people install. More than pocket money needs tens of
  thousands of users, and those come from a good demo and reviews (section 6), not from the price.

**Honest caveat:** Pawnshot is GPL-3.0 (it has to be, because it ships Stockfish) and the repo is public, so anyone may
build a copy without the paywall. That is allowed and normal for GPL software; people pay for the convenience of the
store version, updates and support. Don't add licence terms that forbid redistribution (the GPL doesn't allow that).

## 2. Payments: Gumroad (done)

Premium is sold on Gumroad (Lemon Squeezy was not taking new sign-ups): https://vaibhavster44.gumroad.com/l/pawnshot,
$6.99 one-time, licence keys on. `premium-config.js` holds the checkout link and the product ID, and the manifest's
only optional host permission is `https://api.gumroad.com/*`. Gumroad is the merchant of record (it charges sales
tax / VAT for you) and keeps about 10% + 50¢ a sale; check its pricing page.

Good to know about Gumroad keys:
- Every activation uses up one of the key's uses, and removing a key from a browser does not give it back (Gumroad
  has no per-browser slots). `maxActivations` is 5 so that a buyer who reinstalls a couple of times is not locked out.
  If someone does run out, the simple fix is a fresh key: a 100%-off code for a new "purchase".
- Checking a key by hand with Gumroad's verify API also uses one up, unless the request sends
  `increment_uses_count=false`.
- Never put a real key in the repo, the listing, a screenshot or a public post. For the store's reviewers, make a
  separate key (section 3, Test instructions).

How it works for a buyer: ★ Premium in the panel → settings page → **Get Premium** (opens the Gumroad page) → the key
arrives by email → paste it → Chrome asks once for permission to talk to api.gumroad.com → Premium is on. The key is
re-checked about weekly; offline use keeps working for 30 days. A refunded or disabled key turns Premium off at the
next check. For testing features without a key, the settings page of an **unpacked** copy has a
"Developer: turn on Premium" switch (it does nothing in a store install).

## 3. Chrome Web Store dashboard, tab by tab (you)

One-time developer registration fee: **$5** (done). Edge Add-ons is free to publish on.

**Package:** `npm test` (every suite must pass), then `npm run pack` → `../pawnshot-2.0.1.zip` (~35 MB). Upload it to
replace the draft's 2.0.0: 2.0.1 drops the unused Lemon Squeezy permission and has the store-style icon.

**Store listing:**

| Field | What to put |
|---|---|
| Title, Summary | come from the package; nothing to type |
| Description | paste all of `store/description.txt` (keep the "Fast enough for blitz" sentence only if section 7 bears it out) |
| Category | **Education** (it is a learning tool, which also fits the fair-play story); Tools if you prefer |
| Language | English |
| Store icon | `store/icon-128.png` |
| Global promo video | the YouTube link of the demo (section 5) |
| Screenshots | `store/screenshots/1-…5-….png`, in that order (section 5) |
| Small promo tile | `store/promo-small-440x280.png` (items without one are listed after items that have one) |
| Marquee promo tile | `store/promo-marquee-1400x560.png` (only used if Google features the item) |
| Official URL | leave empty: it needs a website you have verified in Google Search Console |
| Homepage URL | `https://github.com/vaibhav2740/chrome-extensions/tree/main/board-analyzer` |
| Support URL | `https://github.com/vaibhav2740/chrome-extensions/issues` |
| Mature content | No |

**Privacy:** section 4.

**Distribution:** Visibility **Public**, **All regions**.

**Test instructions** (optional, but Google suggests it for paid features, so the reviewer can try Premium):

```
No account is needed. Click the toolbar icon on any page to open the panel.
Free features: Snapshot on a chess video or picture, the analysis board, chess.com / lichess boards.
Premium (unlimited Follow on a video, depth 30, 5 lines, more board colours) is unlocked with a Gumroad licence key:
panel gear icon -> settings page -> "Plan" -> paste the key -> Activate. Chrome then asks once for permission
to contact api.gumroad.com, which checks the key.
Test key: <a separate key made for the reviewers, not your own>
Fair play: the panel locks itself on a chess.com or lichess game in progress ("Game in progress"); that is intended.
```

**Account → trader status (EU):** you declared Non-Trader. The EU rule says a trader is someone acting "for purposes
relating to [their] trade, business, craft or profession", and Pawnshot sells Premium, so the safer reading is
Trader. A trader's name, phone number and address are verified and shown to EU users on the listing, which is the
privacy cost. The purchase itself happens on Gumroad (the merchant of record), so the case is not clear-cut either
way; Google leaves the declaration to you. Decide before submitting: switching later is allowed.

## 4. Privacy tab

- **Single purpose:** "Shows a chess analysis board on web pages: reads a chess position from the page, a video or a
  picture and analyses it with an on-device chess engine."
- **activeTab:** "To read the chess position or take a screenshot of the tab, only after the user clicks the toolbar
  icon on that tab."
- **scripting:** "To show the analysis panel on the tab the user opened it on, and to read the chess site's own board
  data there."
- **storage:** "To remember the user's settings, the Premium licence status and, on the free plan, how many minutes
  of video following were used today."
- **Host permission (optional, api.gumroad.com):** "Requested only when the user activates a Premium licence key, to
  check the key with Gumroad, the shop that sold it."
- **Remote code:** No.
- **Data usage:** Google counts data that is only processed on the device too, so tick:
  - **Website content**: the board on the page, the video picture or a screenshot is read to find the position
    (on the device; nothing is sent anywhere);
  - **Authentication information**: the Premium licence key, sent only to Gumroad to check it;
  - **Personally identifiable information**: the buyer's email address that Gumroad returns with a valid key, shown
    on the settings page and kept only on the device.
  Nothing else. Then tick the three certifications (not sold, not used for unrelated purposes, not used for credit).
- **Privacy policy URL:** `https://github.com/vaibhav2740/chrome-extensions/blob/main/board-analyzer/PRIVACY.md`

## 5. Screenshots, demo video and artwork (you)

Ready in `store/` (redo them with `python3 scripts/store-art.py`): `icon-128.png` (also the package icon now:
96 px of artwork with 16 px clear around it, as the store asks), `promo-small-440x280.png`,
`promo-marquee-1400x560.png`. They show the Opera game just before Morphy's Qb8+.

**Screenshots** (5, 1280×800, no transparency). `scripts/store-shot.py` sizes the Chrome window, captures it at the
exact size and adds a caption band over Chrome's tab bar:

1. Load the unpacked folder (the same code as the zip) and pin the icon. Use a **new Chrome window with one tab**
   (other tabs' titles would show) and hide the bookmarks bar (Cmd+Shift+B).
2. `python3 scripts/store-shot.py size` once, then set up each scene below and run its line. Chrome comes to the
   front and the picture is taken 4 seconds later (`--delay 8` for more time).
3. Never show your own licence key or email (the settings page shows the email once a key is active): take shot 5
   on the free plan.

| # | Scene | Command |
|---|---|---|
| 1 | A game video playing, panel open on the right, Follow on and a few moves in: move list, eval bar and best-move arrow visible | `python3 scripts/store-shot.py 1-follow "The board follows the video, move by move"` |
| 2 | A page or picture with a board (an article, a puzzle image, a paused video), panel just after Snapshot with the lines showing | `python3 scripts/store-shot.py 2-snapshot "Scan any board: videos, screenshots, pictures"` |
| 3 | The minimized pill (best move + eval) over the playing video | `python3 scripts/store-shot.py 3-pill "Out of the way while you watch"` |
| 4 | A chess.com game against a bot, in progress, with the panel showing "Game in progress" | `python3 scripts/store-shot.py 4-fairplay "Fair play: off during live games"` |
| 5 | The settings page (gear icon), Free vs Premium | `python3 scripts/store-shot.py 5-plans "Free to use. Pay once for unlimited Follow"` |

Which video: someone else's channel and face in your advert can get the listing reported. The clean way is your own:
open a famous game on lichess, step through it with → while recording the screen (Cmd+Shift+5), with a few quick
moves in a row, and upload it to YouTube. That video also proves Follow on fast moves.

**Demo video** (worth doing: it is the most convincing thing on the page). 30–60 s, uploaded to YouTube as Public,
then the link goes in "Global promo video". `python3 scripts/store-shot.py video 60` records the same window (with
clicks shown) to `store/demo.mov`; Cmd+Shift+5 works too. A running order:
1. A chess video playing; click the Pawnshot icon, the panel appears (0–5 s).
2. Snapshot: the position and the best move appear (5–10 s).
3. Follow on: moves arrive with the video, including a quick run (10–35 s).
4. ← to look back, → to catch up; minimize to the pill (35–45 s).
5. A chess.com game vs a bot: "Game in progress" (45–55 s).

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
