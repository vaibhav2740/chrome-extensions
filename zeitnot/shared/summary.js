// The text the popup's copy button puts on the clipboard: short, readable in a chat, no markup.

import { clocksNow, titleOddsFor } from './live.js';
import { formatClockSeconds, formatEval, formatPoints, formatResult } from './format.js';

/** @param odds the current title odds ({a, b, decided, winnerKey}) */
export function summaryText(snapshot, detail, odds, now = Date.now()) {
  const [a, b] = snapshot.players;
  const lines = [`Zeitnot · ${snapshot.event.name}`];
  lines.push(`${a.name} ${formatPoints(snapshot.score.a)}–${formatPoints(snapshot.score.b)} ${b.name} (first to ${formatPoints(snapshot.score.target)})`);

  if (detail) {
    if (detail.status === 'LIVE') {
      const { whiteSec, blackSec } = clocksNow(detail, now);
      const bits = [`${detail.name} live`, `move ${detail.moveNumber}`, `${detail.white.name} ${formatClockSeconds(whiteSec)} · ${detail.black.name} ${formatClockSeconds(blackSec)}`];
      if (detail.eval) bits.push(`eval ${formatEval(detail.eval.pawns, detail.eval.mate)}`);
      lines.push(bits.join(' · '));
    } else if (detail.status === 'FINISHED') {
      lines.push(`${detail.name}: ${detail.white.name} ${formatResult(detail.result)} ${detail.black.name}`);
    }
  }
  if (odds) {
    lines.push(odds.decided
      ? `${snapshot.players.find((p) => p.key === odds.winnerKey).fullName} wins the match`
      : `Title odds: ${a.name} ${Math.round(titleOddsFor(snapshot, odds, a.key) * 100)}% / ${b.name} ${Math.round(titleOddsFor(snapshot, odds, b.key) * 100)}%`);
  }
  return lines.join('\n');
}
