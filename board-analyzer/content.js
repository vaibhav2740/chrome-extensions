(() => {
  if (window.__pawnshot) {
    window.__pawnshot.toggle();
    return;
  }
  // A panel left on the page by an earlier copy of the extension (it was reloaded or updated) is dead: remove it.
  for (const old of document.querySelectorAll('[data-pawnshot-host]')) old.remove();

  // ---------- fair play ----------
  // fairplay.js is injected just before this file. Without it, chess sites stay locked (fail closed).
  function fairPlay() {
    const fp = globalThis.__pawnshotFairPlay;
    if (fp) return fp.check(location, document);
    const chessSite = /(^|\.)(chess\.com|chesskid\.com|lichess\.org)$/i.test(location.hostname);
    return { site: null, locked: chessSite, kind: chessSite ? 'game' : null, reason: chessSite ? 'Pawnshot could not check this page for a live game, so it stays off here.' : '' };
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
    return { grid, justMoved, src: 'chess.com board' };
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
    return { grid, justMoved, src: 'lichess board' };
  }

  const hasBoard = () => !!document.querySelector('wc-chess-board, chess-board, cg-board');

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

  // Follow asks several times a second. The page's own game object is read through the background (a round trip),
  // so only do that when the pieces on screen have changed; otherwise the last answer is still right.
  let lastRead = null; // { domFen, result }
  async function snapshot(auto) {
    const dom = readChessCom() || readLichess();
    const domFen = dom ? gridToFen(dom) : null;
    if (auto && lastRead && lastRead.domFen === domFen) return lastRead.result;
    let result = null;
    const main = await mainFen();
    if (main && main.fen) {
      const f = main.fen.trim().split(/\s+/);
      while (f.length < 6) f.push(['w', '-', '-', '0', '1'][f.length - 1]);
      const full = f.join(' ');
      // Prefer the displayed board (DOM) for piece placement; use the game object for
      // turn/castling/en-passant only when it agrees with what is on screen.
      if (!domFen || placement(full) === placement(domFen)) result = { fen: full, src: main.src };
    }
    if (!result) result = domFen ? { fen: domFen, src: dom.src + ' (turn/castling guessed)' } : { fen: null, src: 'no board found on this page' };
    lastRead = { domFen, result };
    return result;
  }

  // ---------- videos (YouTube and other players) ----------
  // A frame straight from the <video> element is sharper than a screenshot, has no player buttons or captions on it,
  // needs no screenshot permission and does not make the panel blink. Some sites forbid reading their video
  // ("tainted" canvas); then the panel falls back to a screenshot.

  function findVideo() {
    let best = null, bestArea = 0;
    for (const v of document.querySelectorAll('video')) {
      if (!v.videoWidth || !v.videoHeight || v.readyState < 2) continue;
      // A camera or a shared screen (a live MediaStream) is not a video someone published. Reading one could follow
      // the reader's own game from another window, so Pawnshot leaves those alone.
      if (typeof MediaStream === 'function' && v.srcObject instanceof MediaStream) continue;
      const r = v.getBoundingClientRect();
      const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
      const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
      if (w < 200 || h < 150) continue; // thumbnails and previews
      if (w * h > bestArea) { best = v; bestArea = w * h; }
    }
    return best;
  }

  // region: [x0, y0, x1, y1] as fractions of the video picture, or null for all of it.
  function videoRect(v, region) {
    const W = v.videoWidth, H = v.videoHeight;
    const [x0, y0, x1, y1] = region || [0, 0, 1, 1];
    return { sx: x0 * W, sy: y0 * H, sw: Math.max(1, (x1 - x0) * W), sh: Math.max(1, (y1 - y0) * H) };
  }

  const TAINTED = 'This video does not let other programs read its picture.';
  function grabVideo(v, region, maxEdge) {
    const { sx, sy, sw, sh } = videoRect(v, region);
    const scale = Math.min(1, maxEdge / Math.max(sw, sh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * scale));
    c.height = Math.max(1, Math.round(sh * scale));
    return new Promise((resolve) => {
      try {
        c.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
        c.toBlob((b) => resolve(b ? { ok: true, blob: b, size: [c.width, c.height] } : { ok: false, error: 'Could not read the video picture.' }), 'image/jpeg', 0.92);
      } catch (e) {
        resolve({ ok: false, tainted: true, error: TAINTED });
      }
    });
  }

  // ---------- Follow a video ----------
  // Several times a second a small thumbnail of the board area (the board plus a margin, REGION px square) is taken
  // from the video. Once it has changed and then held still (the move is over), it goes to the panel, which usually
  // finds the move from it alone in about a millisecond. When it cannot, or now and then to make sure, the panel asks
  // for a sharp picture of the area for the neural reader (followGrab). One sharp picture at a time; the panel says
  // when it is done and how long the computer should rest before the next.
  const REGION = 160;
  const MOVED = 60; // thumbnail pixels that changed clearly: a piece moving changes a few hundred, video noise a few
  const STILL = 40;
  const slowDevice = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  const follow = {
    board: null, region: null, box: null, timer: null, seq: 0, sent: null, prev: null, changedAt: 0,
    want: false, wantAt: 0, inflight: 0, gap: 0, lastFrame: 0, cost: 0,
  };

  let thumbCanvas = null;
  function thumbnail(v, region) {
    if (!thumbCanvas) { thumbCanvas = document.createElement('canvas'); thumbCanvas.width = thumbCanvas.height = REGION; }
    const g = thumbCanvas.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high'; // a smooth shrink, so every pixel stands for its whole patch of the board
    const { sx, sy, sw, sh } = videoRect(v, region);
    g.drawImage(v, sx, sy, sw, sh, 0, 0, REGION, REGION);
    const d = g.getImageData(0, 0, REGION, REGION).data; // throws on a tainted video
    const rgb = new Uint8Array(REGION * REGION * 3);
    for (let i = 0, j = 0; j < rgb.length; i += 4, j += 3) { rgb[j] = d[i]; rgb[j + 1] = d[i + 1]; rgb[j + 2] = d[i + 2]; }
    return rgb;
  }
  function changed(a, b) {
    let n = 0;
    for (let j = 0; j < a.length; j += 3) {
      const d = (a[j] - b[j]) * 0.3 + (a[j + 1] - b[j + 1]) * 0.59 + (a[j + 2] - b[j + 2]) * 0.11;
      if (d > 28 || d < -28) n++;
    }
    return n;
  }

  function expand(b, m) {
    const w = b[2] - b[0], h = b[3] - b[1];
    return [Math.max(0, b[0] - w * m), Math.max(0, b[1] - h * m), Math.min(1, b[2] + w * m), Math.min(1, b[3] + h * m)];
  }

  function startFollow(board) {
    stopFollow();
    follow.board = board;
    follow.region = expand(board, 0.06);
    const [rx0, ry0, rx1, ry1] = follow.region;
    // where the board sits inside the region, as fractions of the region (the panel turns it into pixels)
    follow.box = [(board[0] - rx0) / (rx1 - rx0), (board[1] - ry0) / (ry1 - ry0), (board[2] - rx0) / (rx1 - rx0), (board[3] - ry0) / (ry1 - ry0)];
    const v = findVideo();
    try { follow.sent = v ? thumbnail(v, follow.region) : null; } catch (e) { follow.sent = null; }
    follow.prev = follow.sent;
    follow.want = true; // one sharp picture first, so the panel learns what this board looks like
    follow.wantAt = Date.now();
    schedule(0);
  }

  function stopFollow() {
    clearTimeout(follow.timer);
    Object.assign(follow, { board: null, region: null, box: null, timer: null, sent: null, prev: null, changedAt: 0, want: false, inflight: 0 });
  }

  function schedule(ms) { clearTimeout(follow.timer); follow.timer = setTimeout(tick, ms); }

  // How long to wait before the next look: about 9 a second, less on a slow computer or when looking takes long,
  // and slowly while a paused video shows nothing new.
  function nextLook(v, still) {
    let ms = slowDevice ? 180 : 110;
    ms = Math.max(ms, follow.cost * 12);
    if (still && v && v.paused) ms = Math.max(ms, 400);
    return Math.min(1000, Math.round(ms));
  }

  async function sendFrame(v, px) {
    follow.want = false;
    follow.inflight = Date.now();
    const g = await grabVideo(v, follow.region, 1024);
    if (!follow.board) return;
    if (!g.ok) {
      follow.inflight = 0;
      if (g.tainted) { stopFollow(); toPanel({ type: 'followError', error: g.error }); }
      return;
    }
    // the thumbnail goes along: it is what the next thumbnails are compared with once this picture is read
    toPanel({ type: 'followFrame', seq: follow.seq, blob: g.blob, size: g.size, box: follow.box, px, pxSize: REGION });
  }

  async function tick() {
    follow.timer = null;
    if (!follow.board) return;
    if (follow.inflight && Date.now() - follow.inflight > 15000) follow.inflight = 0; // the panel never answered
    const v = findVideo();
    if (!v || document.hidden || host.style.display === 'none' || fairPlay().locked) { schedule(500); return; }
    const t0 = performance.now();
    let px;
    try { px = thumbnail(v, follow.region); } catch (e) {
      stopFollow();
      toPanel({ type: 'followError', error: TAINTED });
      return;
    }
    follow.cost = follow.cost * 0.8 + (performance.now() - t0) * 0.2;
    const still = !!follow.prev && changed(px, follow.prev) <= STILL;
    follow.prev = px;
    const moved = !follow.sent || changed(px, follow.sent) >= MOVED;
    if (moved && !follow.changedAt) follow.changedAt = Date.now();
    // the move is over: send what the board shows now (a picture that never settles goes after a second anyway)
    if (moved && (still || Date.now() - follow.changedAt > 1000)) {
      follow.sent = px;
      follow.changedAt = 0;
      toPanel({ type: 'followTiles', seq: ++follow.seq, px, size: REGION });
    }
    // a sharp picture is taken when the board is still (a busy picture that never settles: after 1.5 s anyway)
    const ready = still || Date.now() - follow.wantAt > 1500;
    if (follow.want && ready && !follow.inflight && Date.now() - follow.lastFrame >= follow.gap) await sendFrame(v, px);
    if (follow.board && !follow.timer) schedule(nextLook(v, still));
  }

  const onSeek = () => { if (follow.board) { follow.want = true; follow.wantAt = Date.now(); schedule(60); } };
  document.addEventListener('seeked', onSeek, true);

  // ---------- panel UI ----------

  // The host is the glass shell; the panel iframe is transparent so the blur shows through.
  // The whole shell lives in a shadow root and the host starts from `all: initial`, so the page's own CSS (an `img`
  // margin, a `div` transition, a `* { box-sizing }`...) cannot reach it and it looks the same on every site.
  const host = document.createElement('div');
  host.setAttribute('data-pawnshot-host', '');
  host.style.cssText = 'all:initial;display:block;position:fixed;top:24px;right:16px;z-index:2147483647;box-sizing:border-box;overflow:hidden;' +
    'font:12px/1.35 -apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",system-ui,sans-serif;' +
    'border:1px solid rgba(255,255,255,.16);';

  const bar = document.createElement('div');
  bar.title = 'Drag to move · double-click to minimize';
  bar.style.cssText = 'display:flex;align-items:center;gap:10px;height:46px;padding:0 10px 0 18px;box-sizing:border-box;' +
    'cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;' +
    'background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,0));';
  const logo = document.createElement('img');
  logo.src = chrome.runtime.getURL('icons/48.png');
  logo.alt = '';
  logo.draggable = false;
  logo.style.cssText = 'width:24px;height:24px;display:block;flex:none;margin:0;padding:0;border:0;max-width:none;filter:drop-shadow(0 2px 5px rgba(0,0,0,.35));';
  const title = document.createElement('span');
  title.textContent = 'Pawnshot';
  title.style.cssText = 'font-size:13px;font-weight:650;letter-spacing:-.01em;color:rgba(255,255,255,.94);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;font-variant-numeric:tabular-nums;';

  const ICON_MIN = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" style="display:block;fill:currentColor"><rect x="3" y="7.2" width="10" height="1.6" rx=".8"/></svg>';
  const ICON_RESTORE = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" style="display:block;fill:currentColor"><path d="M7.2 3h1.6v4.2H13v1.6H8.8V13H7.2V8.8H3V7.2h4.2z"/></svg>';
  const ICON_CLOSE = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" style="display:block;fill:currentColor"><path d="M4.2 3 8 6.8 11.8 3 13 4.2 9.2 8l3.8 3.8-1.2 1.2L8 9.2 4.2 13 3 11.8 6.8 8 3 4.2z"/></svg>';
  const SVG_STROKE = 'viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" style="display:block;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round"';
  // corner brackets pointing inward = switch to compact; outward = back to the full panel
  const ICON_COMPACT = '<svg ' + SVG_STROKE + '><path d="M5.5 1.8v3.7H1.8M10.5 1.8v3.7h3.7M5.5 14.2v-3.7H1.8M10.5 14.2v-3.7h3.7"/></svg>';
  const ICON_FULL = '<svg ' + SVG_STROKE + '><path d="M1.8 5.5V1.8h3.7M14.2 5.5V1.8h-3.7M1.8 10.5v3.7h3.7M14.2 10.5v3.7h-3.7"/></svg>';
  function headerButton(html, label, hoverBg, hoverColor) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = html;
    b.title = label;
    b.setAttribute('aria-label', label);
    const idle = 'rgba(235,238,255,.6)';
    b.style.cssText = 'all:unset;box-sizing:border-box;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;' +
      'border-radius:50%;cursor:pointer;flex:none;color:' + idle + ';transition:background .16s,color .16s;';
    b.addEventListener('mouseenter', () => { b.style.background = hoverBg; b.style.color = hoverColor; });
    b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; b.style.color = idle; });
    return b;
  }
  const compactBtn = headerButton(ICON_COMPACT, 'Compact view', 'rgba(255,255,255,.14)', '#fff');
  const minBtn = headerButton(ICON_MIN, 'Minimize', 'rgba(255,255,255,.14)', '#fff');
  const closeBtn = headerButton(ICON_CLOSE, 'Hide (click the extension icon to show again)', 'rgba(255,69,58,.22)', '#ff6961');
  const actions = document.createElement('div');
  actions.style.cssText = 'margin-left:auto;display:flex;align-items:center;gap:2px;flex:none;';
  actions.append(compactBtn, minBtn, closeBtn);
  bar.append(logo, title, actions);

  const frame = document.createElement('iframe');
  frame.src = chrome.runtime.getURL('panel.html');
  frame.title = 'Pawnshot';
  // color-scheme must match the panel document's, otherwise the browser paints the frame opaque and kills the glass.
  frame.style.cssText = 'width:100%;height:600px;border:0;display:block;background:transparent;color-scheme:normal;';
  frame.setAttribute('allowtransparency', 'true');
  frame.allow = 'clipboard-write'; // lets the panel's "Copy FEN" use the async clipboard from inside a cross-origin frame
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.append(bar, frame);
  document.documentElement.appendChild(host);

  const panelOrigin = new URL(frame.src).origin;
  const toPanel = (msg, transfer) => { try { frame.contentWindow.postMessage(msg, panelOrigin, transfer); } catch (e) { /* panel not ready */ } };

  // ---- shell appearance: glass (blur) or basic (solid), minimized or open ----
  // Backdrop blur is re-computed whenever the content behind it changes (a playing video, an animated board), which is
  // the expensive case on weak GPUs. So: a modest blur radius, no blur at all while dragging, and a basic-style fallback.
  const GLASS_BG = 'linear-gradient(180deg,rgba(46,50,70,.70),rgba(22,24,36,.74))';
  const GLASS_DRAG_BG = 'linear-gradient(180deg,rgba(46,50,70,.90),rgba(22,24,36,.92))';
  const BASIC_BG = '#1e212d';
  function autoGlass() {
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-transparency: reduce)').matches) return false;
      if (navigator.deviceMemory && navigator.deviceMemory <= 2) return false;
      if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) return false;
    } catch (e) { /* unknown: assume capable */ }
    return true;
  }
  let glassOn = autoGlass();
  let minimized = false;
  let dragging = false;
  let compactOn = false;
  let summary = '';           // best move and eval, shown in the slim pill while minimized
  let baseWidth = 374;        // panel width + border, reported by the panel (differs in compact view)
  let lastPanelHeight = 600;
  // Keep the whole panel on screen: cap the frame to the viewport and slide the panel up if its bottom would be cut off.
  const HEADER_H = 46, BORDER = 2, MARGIN = 12;
  function frameMax() { return Math.max(200, innerHeight - HEADER_H - BORDER - 2 * MARGIN); }
  function hostHeight() { return minimized ? HEADER_H + BORDER : HEADER_H + BORDER + (parseFloat(frame.style.height) || 0); }
  function fitIntoView() {
    frame.style.height = Math.max(200, Math.min(lastPanelHeight, frameMax())) + 'px';
    const maxTop = Math.max(MARGIN, innerHeight - hostHeight() - MARGIN);
    const top = parseFloat(host.style.top) || MARGIN;
    host.style.top = Math.max(MARGIN, Math.min(top, maxTop)) + 'px';
    if (host.style.left) {
      const maxLeft = Math.max(0, innerWidth - 60);
      host.style.left = Math.max(0, Math.min(parseFloat(host.style.left) || 0, maxLeft)) + 'px';
    }
  }
  window.addEventListener('resize', fitIntoView);

  function applyShell() {
    const blur = glassOn && !dragging ? 'blur(20px) saturate(160%)' : 'none';
    host.style.backdropFilter = blur;
    host.style.webkitBackdropFilter = blur;
    host.style.background = !glassOn ? BASIC_BG : dragging ? GLASS_DRAG_BG : GLASS_BG;
    host.style.boxShadow = glassOn
      ? '0 26px 64px rgba(0,0,0,.45),0 4px 14px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.24)'
      : '0 10px 28px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.10)';
    host.style.borderRadius = minimized ? '999px' : '32px';
    host.style.width = (minimized ? 248 : baseWidth) + 'px';
    frame.style.display = minimized ? 'none' : 'block';
    bar.style.borderBottom = minimized ? '0' : '1px solid rgba(255,255,255,.07)';
    title.textContent = minimized && summary ? summary : 'Pawnshot';
    compactBtn.style.display = minimized ? 'none' : 'inline-flex';
    compactBtn.innerHTML = compactOn ? ICON_FULL : ICON_COMPACT;
    const clabel = compactOn ? 'Full view' : 'Compact view';
    compactBtn.title = clabel;
    compactBtn.setAttribute('aria-label', clabel);
    minBtn.innerHTML = minimized ? ICON_RESTORE : ICON_MIN;
    const label = minimized ? 'Restore' : 'Minimize';
    minBtn.title = label;
    minBtn.setAttribute('aria-label', label);
    host.dataset.glass = glassOn ? 'on' : 'off';
    host.dataset.minimized = minimized ? 'true' : 'false';
    host.dataset.compact = compactOn ? 'true' : 'false';
    fitIntoView();
  }

  // The panel pauses its engine and stops following while it is hidden, so it costs nothing in the background.
  // Minimized is not hidden: the slim pill keeps showing the best move (handy while a video plays).
  let lastShown = null;
  function reportShown() {
    const shown = host.style.display !== 'none';
    if (shown === lastShown) return;
    lastShown = shown;
    toPanel({ type: 'shown', visible: shown });
  }
  function setMinimized(v) { minimized = v; applyShell(); }
  function setHidden(v) {
    host.style.display = v ? 'none' : 'block';
    if (v) stopFollow();
    reportShown();
  }
  applyShell();

  minBtn.addEventListener('click', () => setMinimized(!minimized));
  compactBtn.addEventListener('click', () => toPanel({ type: 'toggleCompact' }));
  closeBtn.addEventListener('click', () => setHidden(true));
  bar.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) setMinimized(!minimized); });

  // drag (pointer capture keeps events flowing even over the iframe)
  let drag = null;
  bar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return; // buttons are clicks, not drag handles
    dragging = true;
    bar.style.cursor = 'grabbing';
    applyShell();
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
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    dragging = false;
    bar.style.cursor = 'grab';
    applyShell();
  };
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);

  // Full-screen video hides everything outside the full-screen element, the panel included. Move the panel into it
  // (and back out afterwards). moveBefore keeps the panel's frame alive; without it the panel just stays outside.
  document.addEventListener('fullscreenchange', () => {
    const fs = document.fullscreenElement;
    const target = fs && fs.tagName !== 'VIDEO' && fs !== document.documentElement ? fs : document.documentElement;
    if (host.parentNode === target || typeof target.moveBefore !== 'function') return;
    try { target.moveBefore(host, null); fitIntoView(); } catch (e) { /* stays where it is */ }
  });

  // Picture of the visible page for the scanner. The panel hides itself first so it is not in the picture; the
  // background does the capture (Chrome only allows it after the person clicked the toolbar icon on this tab).
  async function captureVisibleTab() {
    const was = host.style.visibility;
    host.style.visibility = 'hidden';
    try {
      // let the page repaint without the panel before the screenshot is taken
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 80))));
      const res = await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ type: 'capture' }, (r) => {
            const err = chrome.runtime.lastError;
            resolve(r || { ok: false, error: err ? err.message : 'No answer from the extension.' });
          });
        } catch (e) { resolve({ ok: false, error: String((e && e.message) || e) }); }
      });
      return res;
    } finally {
      host.style.visibility = was;
    }
  }

  // ---- what the panel should know about this page: a chess site, a live game (locked), a video to read ----
  let lastInfo = '';
  function pageInfo() {
    const fp = fairPlay();
    return { site: fp.site, locked: fp.locked, kind: fp.kind, reason: fp.reason, board: hasBoard(), video: !!findVideo() };
  }
  function reportPage(force) {
    const info = pageInfo();
    const key = JSON.stringify(info);
    if (!force && key === lastInfo) return;
    lastInfo = key;
    if (info.locked) stopFollow();
    toPanel({ type: 'page', ...info });
  }
  setInterval(() => { if (host.style.display !== 'none' && !document.hidden) reportPage(false); }, 1500);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) reportPage(false); });

  window.addEventListener('message', async (e) => {
    if (e.origin !== panelOrigin || e.source !== frame.contentWindow) return;
    const d = e.data || {};
    if (d.type === 'hello') {
      reportPage(true);
      lastShown = null;
      reportShown();
    } else if (d.type === 'snapshot') {
      const fp = fairPlay();
      if (fp.locked) { toPanel({ type: 'snapshot', fen: null, locked: true, reason: fp.reason, auto: !!d.auto, id: d.id }); reportPage(false); return; }
      const s = await snapshot(!!d.auto);
      toPanel({ type: 'snapshot', ...s, auto: !!d.auto, id: d.id });
    } else if (d.type === 'capture') {
      const fp = fairPlay();
      if (fp.locked) { toPanel({ type: 'captured', id: d.id, ok: false, locked: true, error: fp.reason }); return; }
      const res = await captureVisibleTab();
      toPanel({ type: 'captured', id: d.id, ...res });
    } else if (d.type === 'videoFrame') {
      const fp = fairPlay();
      const v = !fp.locked && findVideo();
      if (fp.locked) { toPanel({ type: 'videoFrame', id: d.id, ok: false, locked: true, error: fp.reason }); return; }
      if (!v) { toPanel({ type: 'videoFrame', id: d.id, ok: false, error: 'No video on this page.' }); return; }
      const g = await grabVideo(v, null, 1920);
      toPanel({ type: 'videoFrame', id: d.id, ...g });
    } else if (d.type === 'followStart') {
      if (!fairPlay().locked && Array.isArray(d.board) && d.board.length === 4) startFollow(d.board.map(Number));
    } else if (d.type === 'followStop') {
      stopFollow();
    } else if (d.type === 'followGrab') {
      if (follow.board) { if (!follow.want) follow.wantAt = Date.now(); follow.want = true; if (!follow.timer) schedule(0); }
    } else if (d.type === 'followDone') {
      follow.inflight = 0;
      follow.lastFrame = Date.now();
      follow.gap = Math.max(0, Math.min(3000, +d.gap || 0));
    } else if (d.type === 'followBox') {
      // the panel lined its grid up with the board: cut the sharp pictures for the reader the same way
      if (follow.board && Array.isArray(d.box) && d.box.length === 4 && d.box.every((x) => Number.isFinite(+x))) follow.box = d.box.map(Number);
    } else if (d.type === 'summary') {
      summary = String(d.text || '').slice(0, 40);
      if (minimized) applyShell();
    } else if (d.type === 'close') {
      setHidden(true);
    } else if (d.type === 'glass') {
      glassOn = !!d.on;
      applyShell();
    } else if (d.type === 'layout') {
      compactOn = !!d.compact;
      baseWidth = (Number(d.width) || 372) + BORDER;
      applyShell();
    } else if (d.type === 'height') {
      lastPanelHeight = d.height;
      fitIntoView();
    }
  });

  window.__pawnshot = {
    toggle() {
      setHidden(host.style.display !== 'none');
      if (host.style.display !== 'none') reportPage(true);
    },
  };
})();
