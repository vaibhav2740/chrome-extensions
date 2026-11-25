// What the toolbar badge and its tooltip say. Pure: (snapshot, live detail, settings, now) -> { text, color, title }.
// Chrome shows about four characters. Colours are dark enough for the white badge text.

import { formatClockSeconds, formatCountdown, formatPoints } from './format.js';
import { deriveGame, titleOddsFor } from './live.js';

export const BADGE_COLORS = {
  idle: '#4f46e5',
  live: '#15803d',
  good: '#15803d',
  bad: '#b91c1c',
  even: '#6d28d9',
  white: '#0369a1',
  black: '#475569',
  soon: '#b45309',
  done: '#b45309',
};

const SOON_MS = 60 * 60 * 1000;

function scoreLine(snapshot) {
  const [a, b] = snapshot.players;
  return `${a.name} ${formatPoints(snapshot.score.a)}–${formatPoints(snapshot.score.b)} ${b.name}`;
}

function evalBadge(snapshot, detail, follow) {
  const ev = detail.eval;
  if (!ev) return null;
  const followedIsWhite = follow !== 'none' && detail.white.key === follow;
  const followedIsBlack = follow !== 'none' && detail.black.key === follow;
  const sign = followedIsBlack ? -1 : 1; // White's point of view unless following the player with Black
  const perspective = followedIsWhite || followedIsBlack;
  let text;
  let signed;
  if (ev.mate !== null && ev.mate !== undefined) {
    const m = ev.mate * sign;
    text = m > 0 ? `#${m}` : `-#${Math.abs(m)}`;
    signed = m > 0 ? 12 : -12;
  } else {
    signed = ev.pawns * sign;
    text = Math.abs(signed) < 0.05 ? '0.0' : `${signed > 0 ? '+' : '-'}${Math.min(9.9, Math.abs(signed)).toFixed(1)}`;
  }
  let color;
  if (perspective) color = signed >= 0.4 ? BADGE_COLORS.good : signed <= -0.4 ? BADGE_COLORS.bad : BADGE_COLORS.even;
  else color = signed >= 0.4 ? BADGE_COLORS.white : signed <= -0.4 ? BADGE_COLORS.black : BADGE_COLORS.even;
  return { text, color };
}

export function computeBadgeSpec(snapshot, detail, settings, now = Date.now()) {
  if (!snapshot) return { text: '', color: BADGE_COLORS.idle, title: 'Zeitnot' };
  const shield = settings.spoilerShield;
  const [a, b] = snapshot.players;
  const withScore = (head) => (shield ? head : `${head} · ${scoreLine(snapshot)}`);

  const odds = snapshot.odds;
  if (odds && odds.decided && !shield) {
    const winner = snapshot.players.find((p) => p.key === odds.winnerKey);
    return { text: winner.name.slice(0, 3).toUpperCase(), color: BADGE_COLORS.done, title: `${winner.fullName} wins the match · ${scoreLine(snapshot)}` };
  }

  if (snapshot.liveRoundId && detail && detail.id === snapshot.liveRoundId && detail.status === 'LIVE') {
    const game = deriveGame(snapshot, detail, now);
    const clocks = `${detail.white.name} ${formatClockSeconds(game.whiteSec)} – ${detail.black.name} ${formatClockSeconds(game.blackSec)}`;
    const base = `Game ${detail.n} live · ${clocks}`;
    const follow = settings.follow;

    if (shield || settings.badge === 'off') return { text: 'LIVE', color: BADGE_COLORS.live, title: shield ? `Zeitnot · ${base}` : withScore(base) };

    if (settings.badge === 'odds') {
      const key = follow !== 'none' ? follow : odds.a >= odds.b ? a.key : b.key;
      const mine = titleOddsFor(snapshot, odds, key);
      const who = snapshot.players.find((p) => p.key === key).name;
      const text = `${Math.round(mine * 100)}%`;
      const color = follow !== 'none' ? (mine >= 0.5 ? BADGE_COLORS.good : BADGE_COLORS.bad) : BADGE_COLORS.even;
      return { text, color, title: `${withScore(base)} · ${who} title odds ${text}` };
    }

    const badge = evalBadge(snapshot, detail, follow);
    if (!badge) return { text: 'LIVE', color: BADGE_COLORS.live, title: `${withScore(base)} · no engine eval yet` };
    return { ...badge, title: `${withScore(base)} · eval ${badge.text}${follow !== 'none' ? ` for ${snapshot.players.find((p) => p.key === follow).name}` : ' (White)'}` };
  }

  const next = snapshot.rounds.find((r) => r.id === snapshot.nextRoundId);
  if (next && next.startsAt) {
    const ms = next.startsAt - now;
    if (ms > 0 && ms <= SOON_MS) {
      return { text: `${Math.ceil(ms / 60000)}m`, color: BADGE_COLORS.soon, title: withScore(`${next.name} starts in ${formatCountdown(ms)}`) };
    }
    if (ms <= 0 && ms > -30 * 60 * 1000) return { text: 'NOW', color: BADGE_COLORS.soon, title: withScore(`${next.name} is about to start`) };
    if (ms > 0) return { text: '', color: BADGE_COLORS.idle, title: withScore(`${next.name} in ${formatCountdown(ms)}`) };
  }
  return { text: '', color: BADGE_COLORS.idle, title: shield ? 'Zeitnot' : scoreLine(snapshot) };
}
