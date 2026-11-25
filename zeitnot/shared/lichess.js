// A tiny Lichess fetch client: timeouts, a clear error type, and a cool-down after HTTP 429.
//
// `cache: 'no-cache'` makes Chrome revalidate with If-Modified-Since / ETag for us, so an unchanged broadcast is a
// cheap 304 and the `Age` header (how stale Lichess' CDN copy is) stays accurate, which the live clocks depend on.

export class LichessError extends Error {
  constructor(message, { status = 0, retryAfterMs = 0 } = {}) {
    super(message);
    this.name = 'LichessError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export function createLichessClient({ fetchFn = (...args) => fetch(...args), now = () => Date.now(), timeoutMs = 8000 } = {}) {
  let blockedUntil = 0;

  async function request(url, kind, timeout = timeoutMs) {
    if (now() < blockedUntil) {
      throw new LichessError('Lichess asked us to slow down', { status: 429, retryAfterMs: blockedUntil - now() });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let res;
    try {
      res = await fetchFn(url, { cache: 'no-cache', signal: controller.signal });
    } catch (err) {
      throw new LichessError(err && err.name === 'AbortError' ? 'Lichess timed out' : `Network error: ${err && err.message}`);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after'));
      const waitMs = (Number.isFinite(retry) && retry > 0 ? retry : 60) * 1000;
      blockedUntil = now() + waitMs;
      throw new LichessError('Lichess asked us to slow down', { status: 429, retryAfterMs: waitMs });
    }
    if (!res.ok) throw new LichessError(`Lichess answered HTTP ${res.status}`, { status: res.status });
    const age = Number(res.headers.get('age'));
    const ageMs = Number.isFinite(age) && age > 0 ? age * 1000 : 0;
    const body = kind === 'json' ? await res.json() : await res.text();
    return { body, ageMs };
  }

  return {
    json: (url, timeout) => request(url, 'json', timeout),
    text: (url, timeout) => request(url, 'text', timeout),
    get blockedUntil() {
      return blockedUntil;
    },
  };
}
