// Boots the real popup (popup.html + popup.js) and the real service worker (background.js) in jsdom, wired together
// through the chrome mock, with a fake Lichess behind them. Each test file calls this once (module state is per process).
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

import { makeChrome } from './chrome-mock.mjs';
import { liveRoutes, makeFetch } from './helpers.mjs';

export async function bootPopup({ routes = liveRoutes(), chromeOptions = {}, preload } = {}) {
  const mock = makeChrome(chromeOptions);
  const html = fs.readFileSync(new URL('../popup/popup.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'chrome-extension://zeitnot/popup/popup.html', pretendToBeVisual: true });
  const { window } = dom;
  const env = { routes, log: [], tickers: [], clipboard: [], mock, window, document: window.document };

  globalThis.chrome = mock.chrome;
  globalThis.document = window.document;
  globalThis.window = window;
  globalThis.HTMLInputElement = window.HTMLInputElement;
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (t) => { env.clipboard.push(t); } } }, configurable: true });
  globalThis.fetch = (url, opts) => makeFetch(env.routes, env.log)(url, opts);
  // The popup's 1 s ticker must not keep the test process alive: capture it and drive it by hand.
  globalThis.setInterval = (fn) => { env.tickers.push(fn); return env.tickers.length; };

  if (preload) await preload(env);
  await import('../background.js');
  env.popupModule = await import('../popup/popup.js');

  env.$ = (id) => window.document.getElementById(id);
  env.click = (node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
  env.key = (key) => window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
  env.tick = () => env.tickers.forEach((f) => f());
  env.until = async (cond, ms = 2000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (cond()) return;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`timed out waiting for: ${cond}`);
  };
  env.settle = () => new Promise((r) => setTimeout(r, 30));
  return env;
}
