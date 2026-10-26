(() => {
  if (window.__boardAnalyzer) {
    window.__boardAnalyzer.toggle();
    return;
  }

  // ---------- position reading ----------

  const PIECE_FEN = { p: 'p', n: 'n', b: 'b', r: 'r', q: 'q', k: 'k' };

  function areaOf(el) {
    const r = el.getBoundingClientRect();
    return r.width * r.height;
  }

  // Returns { grid: 8x8 (rank 8 first) of FEN letters or null, justMoved: 'w'|'b'|null, src }
  function readChessCom() {
    const boards = [...document.querySelectorAll('wc-chess-board, chess-board')].filter((b) => areaOf(b) > 0);
    if (!boards.length) return null;
    boards.sort((a, b) => areaOf(b) - areaOf(a));
    const board = boards[0];
    const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
    const colorAt = {};
    let count = 0;
    for (const el of board.querySelectorAll('.piece')) {
      let color = null, type = null, file = null, rank = null;
      for (const c of el.classList) {
        let m;
        if ((m = /^([wb])([pnbrqk])$/.exec(c))) { color = m[1]; type = m[2]; }
        else if ((m = /^square-(\d)(\d)$/.exec(c))) { file = +m[1]; rank = +m[2]; }
      }
      if (!color || file == null || file < 1 || file > 8 || rank < 1 || rank > 8) continue;
      const letter = color === 'w' ? PIECE_FEN[type].toUpperCase() : PIECE_FEN[type];
      grid[8 - rank][file - 1] = letter;
      colorAt[`${file}${rank}`] = color;
      count++;
    }
    if (!count) return null;
    let justMoved = null;
    for (const h of board.querySelectorAll('.highlight')) {
      for (const c of h.classList) {
        const m = /^square-(\d\d)$/.exec(c);
        if (m && colorAt[m[1]]) { justMoved = colorAt[m[1]]; }
      }
    }
    return { grid, justMoved, src: 'chess.com board DOM' };
  }

  function readLichess() {
    const cgBoard = document.querySelector('cg-board');
    if (!cgBoard) return null;
    const rect = cgBoard.getBoundingClientRect();
    if (!rect.width) return null;
    const sq = rect.width / 8;
    const wrap = cgBoard.closest('.cg-wrap');
    const flipped = !!(wrap && wrap.classList.contains('orientation-black'));
    const pos = (el) => {
      const m = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/.exec(el.style.transform || '');
      if (!m) return null;
      let f = Math.round(+m[1] / sq), r = Math.round(+m[2] / sq); // r: 0 = top row
      if (flipped) { f = 7 - f; r = 7 - r; }
      return f >= 0 && f < 8 && r >= 0 && r < 8 ? [f, r] : null;
    };
    const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
    const names = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' };
    let count = 0;
    for (const el of cgBoard.querySelectorAll('piece')) {
      if (el.classList.contains('ghost')) continue;
      const cls = [...el.classList];
      const color = cls.includes('white') ? 'w' : cls.includes('black') ? 'b' : null;
      const type = cls.map((c) => names[c]).find(Boolean);
      const p = pos(el);
      if (!color || !type || !p) continue;
      grid[p[1]][p[0]] = color === 'w' ? type.toUpperCase() : type;
      count++;
    }
    if (!count) return null;
    let justMoved = null;
    for (const el of cgBoard.querySelectorAll('square.last-move')) {
      const p = pos(el);
      const letter = p && grid[p[1]][p[0]];
      if (letter) justMoved = letter === letter.toUpperCase() ? 'w' : 'b';
    }
    return { grid, justMoved, src: 'lichess board DOM' };
  }

  function gridToFen(read) {
    const { grid, justMoved } = read;
    const rows = grid.map((row) => {
      let s = '', empty = 0;
      for (const c of row) {
        if (!c) empty++;
        else { if (empty) { s += empty; empty = 0; } s += c; }
      }
      return s + (empty || '');
    });
    // castling rights guessed from pieces still on their home squares
    let castle = '';
    if (grid[7][4] === 'K') {
      if (grid[7][7] === 'R') castle += 'K';
      if (grid[7][0] === 'R') castle += 'Q';
    }
    if (grid[0][4] === 'k') {
      if (grid[0][7] === 'r') castle += 'k';
      if (grid[0][0] === 'r') castle += 'q';
    }
    const turn = justMoved === 'w' ? 'b' : 'w';
    return `${rows.join('/')} ${turn} ${castle || '-'} - 0 1`;
  }

  const placement = (fen) => fen.split(' ')[0];

  function mainFen() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'mainFen' }, (r) => {
          void chrome.runtime.lastError;
          resolve(r || null);
        });
      } catch (e) { resolve(null); }
    });
  }

  async function snapshot() {
    const dom = readChessCom() || readLichess();
    const domFen = dom ? gridToFen(dom) : null;
    const main = await mainFen();
    if (main && main.fen) {
      const f = main.fen.trim().split(/\s+/);
      while (f.length < 6) f.push(['w', '-', '-', '0', '1'][f.length - 1]);
      const full = f.join(' ');
      // Prefer the displayed board (DOM) for piece placement; use the game object for
      // turn/castling/en-passant only when it agrees with what is on screen.
      if (!domFen || placement(full) === placement(domFen)) return { fen: full, src: main.src };
    }
    if (domFen) return { fen: domFen, src: dom.src + ' (turn/castling guessed)' };
    return { fen: null, src: 'no board found on this page' };
  }

  // ---------- panel UI ----------

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:80px;right:16px;width:372px;z-index:2147483647;' +
    'box-shadow:0 8px 32px rgba(0,0,0,.45);border-radius:10px;overflow:hidden;background:#262421;' +
    'font:12px system-ui,sans-serif;';
  const bar = document.createElement('div');
  bar.textContent = '♞ Board Analyzer  — drag to move';
  bar.style.cssText = 'height:24px;line-height:24px;padding:0 10px;background:#161512;color:#aaa;' +
    'cursor:move;user-select:none;font-size:11px;';
  const frame = document.createElement('iframe');
  frame.src = chrome.runtime.getURL('panel.html');
  frame.style.cssText = 'width:100%;height:600px;border:0;display:block;background:#262421;';
  host.append(bar, frame);
  document.documentElement.appendChild(host);

  // drag (pointer capture keeps events flowing even over the iframe)
  let drag = null;
  bar.addEventListener('pointerdown', (e) => {
    const r = host.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    bar.setPointerCapture(e.pointerId);
  });
  bar.addEventListener('pointermove', (e) => {
    if (!drag) return;
    host.style.left = Math.max(0, Math.min(innerWidth - 60, e.clientX - drag.dx)) + 'px';
    host.style.top = Math.max(0, Math.min(innerHeight - 30, e.clientY - drag.dy)) + 'px';
    host.style.right = 'auto';
  });
  bar.addEventListener('pointerup', () => { drag = null; });

  const panelOrigin = new URL(frame.src).origin;
  window.addEventListener('message', async (e) => {
    if (e.origin !== panelOrigin || e.source !== frame.contentWindow) return;
    const d = e.data || {};
    if (d.type === 'snapshot') {
      const s = await snapshot();
      frame.contentWindow.postMessage({ type: 'snapshot', ...s, auto: !!d.auto }, panelOrigin);
    } else if (d.type === 'close') {
      host.style.display = 'none';
    } else if (d.type === 'height') {
      frame.style.height = Math.min(d.height, innerHeight - 40) + 'px';
    }
  });

  window.__boardAnalyzer = {
    toggle() {
      host.style.display = host.style.display === 'none' ? 'block' : 'none';
    },
  };
})();
