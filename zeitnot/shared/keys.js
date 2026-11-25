// Storage keys and message names, shared by the service worker and the popup.

export const SNAPSHOT_KEY = 'zeitnot:v3:snapshot'; // the latest snapshot (see tournament.js)
export const DETAILS_KEY = 'zeitnot:v3:details'; // { [roundId]: round detail }
export const CACHE_KEY = 'zeitnot:v3:cache'; // pairings, finished results, last cloud eval: what never needs fetching twice
export const META_KEY = 'zeitnot:v3:meta'; // { failures, lastError, lastAttemptAt, blockedUntil, notified }

export const MSG_SYNC = 'zeitnot:sync';
export const MSG_ROUND = 'zeitnot:round';

export const DEFAULT_META = Object.freeze({ failures: 0, lastError: null, lastAttemptAt: 0, blockedUntil: 0, notified: [] });
