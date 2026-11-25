// The one place that says which championship Zeitnot follows. For the next match, change this file only:
// the Lichess broadcast id and the two players. Everything else is read from the broadcast itself.

export const EVENT = {
  tourId: 'qfkdt8mn',
  fallbackName: 'FIDE World Chess Championship 2026',
  fallbackLocation: 'Geneva, Switzerland',
  // Classical games, and the score that wins the match outright (7.5 of 14).
  games: 14,
  target: 7.5,
  // Who has White in game 1 (an index into `players`). Only a fallback for rounds whose pairing is not published yet.
  firstWhiteIndex: 1,
  // Index 0 is shown on the left everywhere (the defending champion), index 1 on the right.
  // `form` and `rapid` are subjective rating nudges (Elo points) for the odds model; `fideId` and `match` identify the player.
  players: [
    { key: 'gukesh', fideId: 46616543, name: 'Gukesh', fullName: 'Gukesh D', fed: 'IND', title: 'GM', elo: 2710, form: -10, rapid: 0, match: ['gukesh'] },
    { key: 'sindarov', fideId: 14205483, name: 'Sindarov', fullName: 'Sindarov, Javokhir', fed: 'UZB', title: 'GM', elo: 2782, form: 25, rapid: 35, match: ['sindarov'] },
  ],
};

export const TOUR_URL = `https://lichess.org/api/broadcast/${EVENT.tourId}`;
export const TOUR_PGN_URL = `${TOUR_URL}.pgn`;
export const roundJsonUrl = (roundId) => `https://lichess.org/api/broadcast/-/-/${roundId}`;
export const roundPgnUrl = (roundId) => `https://lichess.org/api/broadcast/round/${roundId}.pgn`;
export const cloudEvalUrl = (fen) => `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}`;
export const FALLBACK_TOUR_PAGE = `https://lichess.org/broadcast/fide-world-chess-championship-2026/${EVENT.tourId}`;

/** Which configured player a name (or FIDE id) is. Returns the player's index in EVENT.players, or -1. */
export function playerIndex(name, fideId = null) {
  if (fideId != null) {
    const byId = EVENT.players.findIndex((p) => p.fideId === Number(fideId));
    if (byId !== -1) return byId;
  }
  const lower = String(name || '').toLowerCase();
  return EVENT.players.findIndex((p) => p.match.some((m) => lower.includes(m)));
}

export function playerByKey(key) {
  return EVENT.players.find((p) => p.key === key) || null;
}
