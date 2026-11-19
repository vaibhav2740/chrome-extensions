// Runs the two networks with ONNX Runtime and feeds them to the reader in core.js.
// `ort` is onnxruntime-web (or any build with the same API); `loadBytes(name)` returns a model file's bytes.
// Models are created on first use and kept until release(), so repeat scans are fast.

import { BOARD_SIZE, LOC_SIZE, readBoardBest } from './core.js';

export function createEngine({ ort, loadBytes, onStage = () => {} }) {
  const sessions = {};
  let queue = Promise.resolve();

  async function session(name) {
    if (!sessions[name]) {
      sessions[name] = (async () => {
        onStage('loading');
        const bytes = await loadBytes(name);
        return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      })();
      // a failed load must not poison later attempts
      sessions[name].catch(() => { delete sessions[name]; });
    }
    return sessions[name];
  }

  const tensor = (data, size) => new ort.Tensor('float32', data, [1, 3, size, size]);

  async function runLocator(data) {
    const s = await session('locator');
    onStage('locating');
    const r = await s.run({ image: tensor(data, LOC_SIZE) });
    return r.box.data;
  }

  async function runBoard(data) {
    const s = await session('board');
    onStage('reading');
    const r = await s.run({ board: tensor(data, BOARD_SIZE) });
    return { squares: r.squares.data, orientation: r.orientation.data };
  }

  return {
    // one scan at a time: two overlapping runs would double the memory for nothing
    read(image, opts = {}) {
      const run = queue.then(() => readBoardBest(image, { runLocator, runBoard, ...opts }));
      queue = run.catch(() => {});
      return run;
    },
    async release() {
      const all = Object.values(sessions);
      for (const k of Object.keys(sessions)) delete sessions[k];
      for (const p of all) {
        try { (await p).release(); } catch (e) { /* never loaded */ }
      }
    },
  };
}
