// Stockfish in a worker. analyse(fen) (re)starts the search; the engine's lines arrive through onLines.
//   lines[i] = { cp, mate, depth, pv: [uci...] } for the i-th best line, scores from White's point of view.

// deps: { getSettings() -> { multipv, depth }, onLines(lines), onError(message), hashMb }
// hashMb: the engine's table size. Smaller on weak devices (memory is what runs out first there).
export function createEngineClient({ getSettings, onLines, onError, hashMb = 64 }) {
  let worker = null;
  let ready = false;
  let pending = null; // search request waiting for the engine to be ready / flushed
  let searchId = 0;
  let active = false; // false while stopped: late output for an old position is ignored
  let sign = 1;       // +1 when White is to move in the searched position
  let lines = [];

  function start() {
    worker = new Worker(new URL('./engine/stockfish-19-lite-single.js', import.meta.url));
    worker.onmessage = (e) => onEngine(String(e.data));
    worker.onerror = (e) => onError('Engine error: ' + (e.message || 'failed to load'));
    worker.postMessage('uci');
  }

  function onEngine(line) {
    if (line === 'uciok') {
      worker.postMessage('setoption name Threads value 1');
      worker.postMessage('setoption name Hash value ' + hashMb);
      worker.postMessage('isready');
    } else if (line === 'readyok') {
      ready = true;
      if (pending) { const p = pending; pending = null; run(p); }
    } else if (ready && line.startsWith('info') && line.includes(' pv ')) {
      parseInfo(line);
    }
  }

  function parseInfo(line) {
    if (!active) return;
    const t = line.split(' ');
    const get = (k) => { const i = t.indexOf(k); return i >= 0 ? t[i + 1] : null; };
    const multipv = +(get('multipv') || 1);
    const depth = +get('depth');
    const si = t.indexOf('score');
    if (si < 0) return;
    const kind = t[si + 1], val = +t[si + 2];
    // "lowerbound"/"upperbound" lines are half-finished guesses; showing them makes the eval jump about.
    if (t[si + 3] === 'lowerbound' || t[si + 3] === 'upperbound') return;
    const pv = t.slice(t.indexOf('pv') + 1);
    // Stockfish scores are from the side to move; convert to White's perspective.
    lines[multipv - 1] = { cp: kind === 'cp' ? val * sign : null, mate: kind === 'mate' ? val * sign : null, depth, pv };
    onLines(lines);
  }

  function run(req) {
    if (req.id !== searchId) return;
    const { multipv, depth } = getSettings();
    worker.postMessage('setoption name MultiPV value ' + multipv);
    worker.postMessage('position fen ' + req.fen);
    worker.postMessage('go depth ' + depth);
  }

  return {
    get lines() { return lines; },

    analyse(fen) {
      const req = { fen, id: ++searchId };
      lines = [];
      active = true;
      sign = fen.split(' ')[1] === 'b' ? -1 : 1;
      if (!worker) start();
      if (!ready) { pending = req; return; }
      // stop any running search, then wait for readyok so stale output is flushed
      ready = false;
      pending = req;
      worker.postMessage('stop');
      worker.postMessage('isready');
    },

    // Stop thinking and forget the lines (the position is being edited, or it is already over).
    stop() {
      searchId++;
      pending = null;
      active = false;
      lines = [];
      if (worker && ready) worker.postMessage('stop');
    },
  };
}
