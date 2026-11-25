// Test helpers: real captured Lichess responses served through a fake fetch.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
export const fixture = (name) => fs.readFileSync(path.join(dir, name), 'utf8');
export const fixtureJson = (name) => JSON.parse(fixture(name));

export function response(body, { status = 200, headers = {} } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => lower[k.toLowerCase()] ?? null },
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

/**
 * A fake fetch. `routes` maps a URL fragment to a body, a {status, body, headers}, or a function(url) -> either.
 * Every requested URL is pushed onto `log`. An unmatched URL answers 404.
 */
export function makeFetch(routes, log = []) {
  const fn = async (url, opts = {}) => {
    log.push(url.replace('https://lichess.org/api/', ''));
    for (const [fragment, handler] of Object.entries(routes)) {
      if (!url.includes(fragment)) continue;
      const out = typeof handler === 'function' ? await handler(url, opts) : handler;
      if (out && typeof out === 'object' && 'body' in out) {
        return response(out.body, out);
      }
      return response(out);
    }
    return response('not found', { status: 404 });
  };
  fn.log = log;
  return fn;
}

/** The standard routes for "Game 2 is live" from the fixtures. */
export function liveRoutes(overrides = {}) {
  return {
    'broadcast/qfkdt8mn.pgn': fixture('tour.pgn'),
    'broadcast/qfkdt8mn': { body: fixture('tour.json'), headers: { age: 2 } },
    'broadcast/-/-/L3j03TZq': { body: fixture('round-live.json'), headers: { age: 3 } },
    'broadcast/round/L3j03TZq.pgn': fixture('round-live.pgn'),
    'cloud-eval': fixture('cloud-eval.json'),
    ...overrides,
  };
}

import { createLichessClient } from '../shared/lichess.js';
import { syncTournament } from '../shared/tournament.js';

/** A real snapshot built from the fixtures. `mutate(tourJson)` can change the tour first. */
export async function liveSnapshot({ now = 1795617000000, mutate, routes = {} } = {}) {
  const tour = fixtureJson('tour.json');
  if (mutate) mutate(tour);
  const client = createLichessClient({ fetchFn: makeFetch(liveRoutes({ 'broadcast/qfkdt8mn': { body: tour }, ...routes })), now: () => now });
  const out = await syncTournament({ client, now });
  return { ...out, now };
}
