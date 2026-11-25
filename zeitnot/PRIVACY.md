# Zeitnot privacy

Zeitnot collects nothing. There is no account, no analytics, no tracking and no server of ours.

- **What it contacts:** only `lichess.org` (the public broadcast of the match and, for a position, the public cloud-eval
  endpoint) and, to show a player's photo, `image.lichess.org`. Requests carry no personal data; Lichess sees an ordinary
  browser request from your IP address, as for any website.
- **What it stores:** on your device, in `chrome.storage.local`: the last data fetched (so the popup opens instantly and works
  offline) and your settings (who you follow, spoiler shield, badge mode, stream delay, notification choices). Nothing leaves
  your browser.
- **Permissions:** `storage` and `alarms` (to refresh in the background), access to `lichess.org`, and, only if you switch
  notifications on, Chrome's optional `notifications` permission.

Zeitnot is not affiliated with FIDE or Lichess.
