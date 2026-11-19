// Panel-side handle on the board reader. Starts the worker on the first scan and shuts it down when idle, so the
// ~130 MB the models need is only held while someone is actually scanning.
// If the worker cannot start, the same code runs on the page instead (slower UI, same result).

export const IDLE_MS = 2 * 60 * 1000;

export function createScanner({
  makeWorker = () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }),
  makeInPage = async (onStage) => {
    const [ort, { createRunner }] = await Promise.all([import('./ort/ort.wasm.min.mjs'), import('./runner.js')]);
    const base = new URL('./', import.meta.url);
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = new URL('ort/', base).href;
    return createRunner({ ort, base, onStage });
  },
  idleMs = IDLE_MS,
  readyMs = 20000,
  onStage = () => {},
} = {}) {
  let worker = null;
  let inPage = null;
  let starting = null; // promise for the worker's first 'ready'
  let nextId = 1;
  const waiting = new Map(); // id -> { resolve, reject }
  let idleTimer = null;
  let useInPage = false;

  function failAll(message) {
    for (const [, w] of waiting) w.reject(new Error(message));
    waiting.clear();
  }

  function stopWorker() {
    if (worker) { try { worker.terminate(); } catch (e) { /* already gone */ } }
    worker = null;
    starting = null;
  }

  function startWorker() {
    if (starting) return starting;
    starting = new Promise((resolve, reject) => {
      let w;
      try { w = makeWorker(); } catch (e) { reject(e); return; }
      worker = w;
      const timer = setTimeout(() => {
        stopWorker();
        reject(new Error('the reader took too long to start'));
      }, readyMs);
      w.onmessage = (ev) => {
        const m = ev.data || {};
        if (m.type === 'ready') { clearTimeout(timer); resolve(); return; }
        const p = waiting.get(m.id);
        if (m.type === 'stage') { onStage(m.stage); return; }
        if (!p) return;
        waiting.delete(m.id);
        if (m.type === 'result') p.resolve(m.result);
        else p.reject(new Error(m.message || 'The board reader failed'));
      };
      w.onerror = (ev) => {
        const msg = (ev && ev.message) || 'the reader could not start';
        clearTimeout(timer);
        stopWorker();
        failAll(msg);
        reject(new Error(msg));
      };
    });
    starting.catch(() => { starting = null; });
    return starting;
  }

  function touchIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(dispose, idleMs);
  }

  async function dispose() {
    clearTimeout(idleTimer);
    if (waiting.size) { touchIdle(); return; } // never cut a scan short
    stopWorker();
    if (inPage) { try { await inPage.release(); } catch (e) { /* nothing loaded */ } inPage = null; }
  }

  async function scanInPage(blob, crop) {
    if (!inPage) inPage = await makeInPage(onStage);
    return inPage.scan(blob, crop);
  }

  return {
    // blob: image file/Blob. crop: optional [x0,y0,x1,y1] in the picture's pixels.
    async scan(blob, crop = null) {
      clearTimeout(idleTimer);
      try {
        if (!useInPage) {
          try {
            await startWorker();
          } catch (e) {
            useInPage = true; // worker unavailable here: stay on the page from now on
          }
        }
        if (useInPage) return await scanInPage(blob, crop);
        const id = nextId++;
        return await new Promise((resolve, reject) => {
          waiting.set(id, { resolve, reject });
          worker.postMessage({ type: 'scan', id, blob, crop });
        });
      } finally {
        touchIdle();
      }
    },
    dispose,
    get mode() { return useInPage ? 'page' : worker ? 'worker' : 'idle'; },
  };
}
