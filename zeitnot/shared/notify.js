// Decides which desktop notifications to show. Pure: it is told what changed and what has already been sent.
// Results are always recorded as "seen" even when notifications are off, so turning them on later never replays history.

import { formatPoints, formatResult } from './format.js';
import { clocksNow } from './live.js';

const SOON_MS = 10 * 60 * 1000;
const TIME_TROUBLE_SEC = 5 * 60;
const KEEP = 300;

function minutesSeconds(sec) {
  const whole = Math.max(0, Math.floor(sec));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function nameOf(snapshot, key) {
  return snapshot.players.find((p) => p.key === key)?.name || key;
}

function roundMatchup(snapshot, round) {
  const white = nameOf(snapshot, round.whiteKey);
  const black = snapshot.players.map((p) => p.name).find((n) => n !== white) || '';
  return { white, black };
}

/**
 * @returns {{ events: {id: string, title: string, message: string, url: string}[], notified: string[] }}
 *   `notified` is the new full list of ids to remember.
 */
export function detectEvents({ prev, next, detail, settings, notified = [], now = Date.now() }) {
  const seen = new Set(notified);
  const events = [];
  const emit = (e) => {
    seen.add(e.id);
    events.push(e);
  };
  const [a, b] = next.players;

  // Game starts soon
  const upcoming = next.rounds.find((r) => r.id === next.nextRoundId);
  if (settings.notify.soon && upcoming && upcoming.startsAt && !next.liveRoundId) {
    const ms = upcoming.startsAt - now;
    const id = `soon:${upcoming.id}`;
    if (ms > 0 && ms <= SOON_MS && !seen.has(id)) {
      const { white, black } = roundMatchup(next, upcoming);
      emit({ id, title: `${upcoming.name} starts in ${Math.max(1, Math.round(ms / 60000))} min`, message: `${white} (White) vs ${black}`, url: upcoming.url });
    }
  }

  // Game finished
  for (const round of next.rounds) {
    if (round.status !== 'FINISHED') continue;
    const id = `result:${round.id}`;
    if (seen.has(id)) continue;
    const wasFinished = prev ? prev.rounds.find((r) => r.id === round.id)?.status === 'FINISHED' : true;
    if (wasFinished) {
      seen.add(id); // already known: first run, or finished before we looked
      continue;
    }
    if (!settings.notify.result) {
      seen.add(id);
      continue;
    }
    const { white, black } = roundMatchup(next, round);
    const score = `${a.name} ${formatPoints(next.score.a)}–${formatPoints(next.score.b)} ${b.name}`;
    const odds = next.odds;
    if (settings.spoilerShield) {
      emit({ id, title: `${round.name} has finished`, message: 'Open Zeitnot to see the result.', url: round.url });
    } else if (odds && odds.decided) {
      const winner = next.players.find((p) => p.key === odds.winnerKey);
      emit({ id, title: `${winner.fullName} wins the World Championship`, message: `${round.name} ${formatResult(round.result)} · ${score}`, url: round.url });
    } else {
      const titleLine = odds ? ` · title odds ${a.name} ${Math.round(odds.a * 100)}% / ${b.name} ${Math.round(odds.b * 100)}%` : '';
      emit({ id, title: `${round.name}: ${formatResult(round.result)}`, message: `${white} vs ${black} · ${score}${titleLine}`, url: round.url });
    }
  }

  // Time trouble before move 40, with no increment
  if (settings.notify.zeitnot && detail && detail.status === 'LIVE' && detail.plyCount > 0 && detail.moveNumber <= 40) {
    const clocks = clocksNow(detail, now);
    for (const [side, sec, player] of [['w', clocks.whiteSec, detail.white], ['b', clocks.blackSec, detail.black]]) {
      const id = `zeit:${detail.id}:${side}`;
      if (sec > 0 && sec < TIME_TROUBLE_SEC && !seen.has(id)) {
        const left = Math.max(1, 41 - detail.moveNumber);
        emit({
          id,
          title: `Time trouble: ${player.name} has ${minutesSeconds(sec)} left`,
          message: `${left} move${left === 1 ? '' : 's'} to make before move 40, with no increment. ${detail.name}.`,
          url: detail.url,
        });
      }
    }
  }

  return { events, notified: [...seen].slice(-KEEP) };
}
