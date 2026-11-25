// How long the service worker waits before it syncs again. Lichess' CDN caches each response for 10 s, so the floor
// is Chrome's 30 s alarm minimum, used only while a game is on. Quiet days cost almost nothing.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export const MIN_DELAY_MS = 30 * SECOND;
export const MAX_BACKOFF_MS = 10 * MINUTE;

/** Delay until the next sync, from what the snapshot shows. */
export function baseDelayMs(snapshot, now = Date.now()) {
  if (!snapshot) return MINUTE;
  if (snapshot.liveRoundId) return 30 * SECOND;
  if (snapshot.odds && snapshot.odds.decided) return 12 * HOUR;
  const next = snapshot.rounds.find((r) => r.id === snapshot.nextRoundId);
  if (!next || !next.startsAt) return 30 * MINUTE;
  const ms = next.startsAt - now;
  if (ms <= 0) return ms > -45 * MINUTE ? 30 * SECOND : 5 * MINUTE; // it should be starting: look often, but not forever
  if (ms <= 70 * MINUTE) return MINUTE; // keeps the toolbar countdown right and catches the start
  if (ms <= 6 * HOUR) return 5 * MINUTE;
  return 30 * MINUTE;
}

/** Adds exponential backoff after failures and honours a rate-limit cool-down. */
export function nextPollDelayMs(snapshot, now, { failures = 0, blockedMs = 0 } = {}) {
  let delay = baseDelayMs(snapshot, now);
  if (failures > 0) delay = Math.max(delay, Math.min(MAX_BACKOFF_MS, MIN_DELAY_MS * 2 ** Math.min(failures, 8)));
  if (blockedMs > 0) delay = Math.max(delay, blockedMs);
  return Math.max(MIN_DELAY_MS, Math.round(delay));
}
