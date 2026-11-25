// Small pure formatters shared by the popup, the badge and the notifications.

/** Parses H:MM:SS, M:SS or either with a fractional second ("0:00:09.5"). Returns seconds, or null if it is not a clock. */
export function tryParseClockSeconds(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  const m = /^(?:(\d{1,2}):)?(\d{1,3}):(\d{1,2})(\.\d+)?$/.exec(text);
  if (!m) return null;
  const hasHours = m[1] !== undefined;
  const hours = hasHours ? parseInt(m[1], 10) : 0;
  const mins = parseInt(m[2], 10);
  const secs = parseInt(m[3], 10) + (m[4] ? parseFloat(m[4]) : 0);
  if (secs >= 60) return null;
  if (hasHours && mins >= 60) return null;
  return hours * 3600 + mins * 60 + secs;
}

export function formatClockSeconds(totalSec) {
  const sec = Math.max(0, Math.floor(Number(totalSec) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const pad2 = (n) => String(n).padStart(2, '0');

/** "2d 4h 05m", "3h 12m 08s", "7m 05s". `startedLabel` is what to show once the time has passed. */
export function formatCountdown(msRemaining, startedLabel = 'Starting now') {
  if (!(msRemaining > 0)) return startedLabel;
  const totalSec = Math.floor(msRemaining / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h ${pad2(mins)}m`;
  if (hours > 0) return `${hours}h ${pad2(mins)}m ${pad2(secs)}s`;
  return `${mins}m ${pad2(secs)}s`;
}

/** Compact countdown for tight spaces: "2d 4h", "3h 12m", "7m". */
export function formatCountdownShort(msRemaining) {
  if (!(msRemaining > 0)) return 'now';
  const totalMin = Math.ceil(msRemaining / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${pad2(mins)}m`;
  return `${mins}m`;
}

/** "+0.42", "-1.10", "0.00", "#3", "-#2". `null`/`undefined` pawns with no mate means no eval: "—". */
export function formatEval(pawns, mate = null) {
  if (mate !== null && mate !== undefined) return mate > 0 ? `#${mate}` : `-#${Math.abs(mate)}`;
  if (pawns === null || pawns === undefined || Number.isNaN(Number(pawns))) return '—';
  const v = Number(pawns);
  if (Math.abs(v) < 0.005) return '0.00';
  return `${v > 0 ? '+' : '-'}${Math.abs(v).toFixed(2)}`;
}

export function formatResult(result) {
  if (result === '1/2-1/2') return '½–½';
  if (result === '1-0' || result === '0-1') return result.replace('-', '–');
  return '*';
}

export function formatPoints(points) {
  const whole = Math.floor(points);
  const half = points - whole >= 0.25;
  if (!half) return String(whole);
  return whole === 0 ? '½' : `${whole}½`;
}

export function formatPercent(p, digits = 0) {
  return `${(Math.max(0, Math.min(1, p)) * 100).toFixed(digits)}%`;
}

/** Local time of a round start: "Today 3:30 PM", "Tomorrow 3:30 PM", "Nov 28, 3:30 PM". */
export function formatStartTime(ms, now = Date.now(), locale = undefined) {
  if (!ms) return 'Time to be announced';
  const d = new Date(ms);
  const time = d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  const dayKey = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const today = new Date(now);
  if (dayKey(d) === dayKey(today)) return `Today ${time}`;
  // Calendar arithmetic, not +24 h, so the two clock-change days of the year are still right.
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (dayKey(d) === dayKey(tomorrow)) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString(locale, { month: 'short', day: 'numeric' })}, ${time}`;
}

/** "just now", "12s ago", "4m ago", "2h ago". */
export function formatAgo(ms) {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}
