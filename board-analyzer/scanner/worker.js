// Module worker: loads onnxruntime-web and reads boards off the UI thread.
// Protocol: in  { type:'scan', id, blob, crop }   out { type:'stage'|'result'|'error', id, ... }
//           in  { type:'release' }                frees the models

import * as ort from './ort/ort.wasm.min.mjs';
import { createRunner } from './runner.js';

const base = new URL('./', import.meta.url);
// One thread: extension pages are not cross-origin isolated, so the multi-threaded runtime is unavailable.
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false; // we already are in a worker; ORT's own proxy worker would need a blob: URL
ort.env.wasm.wasmPaths = new URL('ort/', base).href;

let currentId = null;
const runner = createRunner({ ort, base, onStage: (stage) => postMessage({ type: 'stage', id: currentId, stage }) });

self.onmessage = async (e) => {
  const m = e.data || {};
  if (m.type === 'release') { await runner.release(); return; }
  if (m.type !== 'scan') return;
  currentId = m.id;
  try {
    const result = await runner.scan(m.blob, m.crop || null);
    postMessage({ type: 'result', id: m.id, result });
  } catch (err) {
    postMessage({ type: 'error', id: m.id, message: String((err && err.message) || err) });
  }
};

postMessage({ type: 'ready' });
