import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COPY = SRC; // package.json here says "type": "module", so the extension files import directly

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (n, c, x = "") => { console.log(`  ${c ? "✓" : "✗"} ${n} ${c ? "" : x}`); if (!c) fail++; };

// ---------------- Part A: panel.js ----------------
const html = fs.readFileSync(`${COPY}/panel.html`, "utf8").replace(/<script[^>]*><\/script>/, "").replace(/<link[^>]*>/, "");
const dom = new JSDOM(html, { url: "chrome-extension://abc/panel.html", pretendToBeVisual: true });
const w = dom.window;
const posted = [];
let roCallbacks = [];
class FakeWorker {
  constructor() { FakeWorker.last = this; this.sent = []; }
  postMessage(m) {
    this.sent.push(m);
    queueMicrotask(() => {
      if (m === "uci") this.onmessage({ data: "uciok" });
      if (m === "isready") this.onmessage({ data: "readyok" });
    });
  }
  emit(line) { this.onmessage({ data: line }); }
}
Object.assign(globalThis, { window: w, document: w.document, parent: { postMessage: (m) => posted.push(m) }, Worker: FakeWorker });
globalThis.ResizeObserver = class { constructor(cb) { roCallbacks.push(cb); } observe() {} };
const opened = [];
w.open = (...a) => { opened.push(a); return null; };
let copied = null;
const storeLocal = { glassMode: "off" }; // user previously chose Basic
Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (t) => { copied = t; } }, deviceMemory: 8, hardwareConcurrency: 8 }, configurable: true, writable: true });
globalThis.chrome = { storage: { local: { get: async () => ({ ...storeLocal }), set: async (o) => { Object.assign(storeLocal, o); } } } };
const $ = (id) => w.document.getElementById(id);
// Snapshot now asks the host with an id and waits for the answer carrying the same id.
const lastAsk = () => posted.filter((m) => m.type === "snapshot" && m.auto === false).at(-1);
const snap = async (fen, src = "t") => { $("snap").click(); const ask = lastAsk(); w.dispatchEvent(new w.MessageEvent("message", { data: { type: "snapshot", fen, src, auto: false, id: ask.id } })); await sleep(10); return ask; };

console.log("A1. panel boots on the redesigned markup");
await import(`file://${COPY}/panel.js?t=${Date.now()}`);
await sleep(50);
check("every element panel.js needs exists", ["board", "arrows", "evalbar", "evalfill", "bestMove", "bestEval", "depth", "lines", "snap", "auto", "undo", "redo", "promo", "flip", "fen", "go", "turn", "depthMax", "multipv", "status"].every((id) => $(id)));
check("64 squares + 32 pieces rendered", w.document.querySelectorAll("#board .sq").length === 64 && w.document.querySelectorAll("#board .sq img").length === 32);
check("start FEN in the box", $("fen").value.startsWith("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w"));
check("engine started and searched the start position", FakeWorker.last.sent.includes("uci") && FakeWorker.last.sent.some((m) => String(m).startsWith("position fen rnbqkbnr")) && FakeWorker.last.sent.some((m) => /^go depth 20/.test(String(m))), JSON.stringify(FakeWorker.last.sent));

console.log("A2. engine output is rendered");
const wk = FakeWorker.last;
wk.emit("info depth 14 seldepth 18 multipv 1 score cp 31 nodes 1 pv e2e4 e7e5 g1f3 b8c6");
wk.emit("info depth 14 multipv 2 score cp 20 pv d2d4 d7d5 c2c4");
wk.emit("info depth 14 multipv 3 score cp -12 pv c2c4 e7e5");
check("engine lines are drawn once per frame, not once per line", w.document.querySelectorAll("#lines .line").length === 0);
await sleep(40);
check("best move in SAN + eval + depth", $("bestMove").textContent === "e4" && $("bestEval").textContent === "+0.31" && $("depth").textContent === "depth 14", `${$("bestMove").textContent}|${$("bestEval").textContent}|${$("depth").textContent}`);
const lines = [...w.document.querySelectorAll("#lines .line")];
check("3 lines with sign-colored scores", lines.length === 3 && lines[0].querySelector("b").className === "pos" && lines[2].querySelector("b").className === "neg", lines.map((l) => l.innerHTML).join(" || "));
check("arrows drawn for each line", ($("arrows").innerHTML.match(/<g /g) || []).length === 3);
check("eval bar moved above 50%", parseFloat($("evalfill").style.height) > 50, $("evalfill").style.height);
check("best move squares highlighted", w.document.querySelectorAll("#board .sq.hl").length === 2);

console.log("A3. height reporting keeps the glass frame fitted");
check("height reported at load", posted.some((m) => m.type === "height" && typeof m.height === "number"));
const before = posted.filter((m) => m.type === "height").length;
w.document.body.getBoundingClientRect = () => ({ height: 700 });
roCallbacks.forEach((cb) => cb());
const last = posted.filter((m) => m.type === "height").at(-1);
check("re-reports when content grows (ResizeObserver)", posted.filter((m) => m.type === "height").length === before + 1 && last.height === 704, JSON.stringify(last));
roCallbacks.forEach((cb) => cb());
check("no duplicate message when unchanged", posted.filter((m) => m.type === "height").length === before + 1);

console.log("A4. controls");
const firstSq = () => w.document.querySelector("#board .sq").dataset.sq;
check("board starts white-at-bottom", firstSq() === "a8");
$("flip").click(); check("flip -> h1 at top-left", firstSq() === "h1"); $("flip").click(); check("flip back", firstSq() === "a8");
$("fen").value = "total garbage"; $("go").click();
check("invalid FEN shows an error", $("status").className === "err" && /Invalid/.test($("status").textContent), $("status").textContent);
$("fen").value = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"; $("go").click();
check("valid FEN clears the error", $("status").className === "");
$("turn").value = "b"; $("turn").onchange();
check("turn override applies to the FEN", /^\S+ b /.test($("fen").value), $("fen").value);
$("turn").value = "auto"; $("turn").onchange();
check("panel no longer has a duplicate close button (header owns Hide/Minimize)", !$("close"));
check("the Play toggle is gone: moving is always on", !$("play"));
$("snap").click();
const ask = lastAsk();
check("snapshot requests a read from the host, with an id to match the answer", !!ask && typeof ask.id === "number");
check("the button shows it is working and offers to cancel", $("snap").classList.contains("busy") && /Reading/.test($("snapLabel").textContent) && /cancel/i.test($("snap").title));
w.dispatchEvent(new w.MessageEvent("message", { data: { type: "snapshot", fen: "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1", src: "test source", auto: false, id: ask.id } }));
await sleep(10);
check("snapshot reply loads the position", $("fen").value.startsWith("4k3/8/8/8/8/8/4P3/4K3") && $("status").textContent === "Source: test source", $("status").textContent);
check("and the button is back to normal", !$("snap").classList.contains("busy") && $("snapLabel").textContent === "Snapshot");
$("snap").click();
const ask2 = lastAsk();
const capsBefore = posted.filter((m) => m.type === "capture").length;
w.dispatchEvent(new w.MessageEvent("message", { data: { type: "snapshot", fen: null, src: "none", auto: false, id: ask2.id } }));
await sleep(10);
check("no board on the page: it takes a picture of the screen instead (no dead end)", posted.filter((m) => m.type === "capture").length === capsBefore + 1 && /Capturing/.test($("snapLabel").textContent));
const cap = posted.filter((m) => m.type === "capture").at(-1);
w.dispatchEvent(new w.MessageEvent("message", { data: { type: "captured", id: cap.id, ok: false, error: "Click the icon first" } }));
await sleep(10);
check("a refused capture is explained under the board", !$("scanNote").hidden && $("scanNote").classList.contains("err") && /Click the icon/.test($("noteText").textContent) && !$("snap").classList.contains("busy"));
$("noteClose").click();

console.log("A5. moving pieces (always on, like an analysis board)");
$("fen").value = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"; $("go").click();
const boardEl = $("board");
boardEl.getBoundingClientRect = () => ({ left: 0, top: 0, right: 320, bottom: 320, width: 320, height: 320 });
boardEl.setPointerCapture = () => {};
const ev = (type, x, y) => boardEl.dispatchEvent(new w.MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
const at = (sq) => { const f = "abcdefgh".indexOf(sq[0]), r = +sq[1]; return [f * 40 + 20, (8 - r) * 40 + 20]; };
const drag = (from, to) => { ev("pointerdown", ...at(from)); ev("pointerup", ...at(to)); };
const click = (sq) => { ev("pointerdown", ...at(sq)); ev("pointerup", ...at(sq)); };
const fenNow = () => $("fen").value;
drag("e2", "e4"); await sleep(30);
check("drag e2-e4 works without enabling anything", fenNow().startsWith("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b"), fenNow());
check("status names the move", /played on panel: e4/.test($("status").textContent), $("status").textContent);
check("the move is highlighted on exactly its from and to squares", [...w.document.querySelectorAll("#board .sq.last")].map((e) => e.dataset.sq).sort().join() === "e2,e4");
click("e7"); 
const dots = () => w.document.querySelectorAll("#board .sq.dot, #board .sq.cap").length;
check("clicking a piece shows its legal moves as dots", dots() === 2 && w.document.querySelector('#board .sq[data-sq="e6"]').classList.contains("dot") && w.document.querySelector('#board .sq[data-sq="e5"]').classList.contains("dot"), String(dots()));
click("e5"); await sleep(30);
check("click-then-click plays the move", fenNow().startsWith("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w"), fenNow());
drag("e2", "e5"); await sleep(10);
check("illegal drops are rejected and leave the position alone", fenNow().startsWith("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w"), fenNow());

console.log("   either side can move (the turn follows)");
$("fen").value = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1"; $("go").click(); await sleep(20);
drag("e2", "e4"); await sleep(30);
check("White pieces move even when the FEN says Black to move", fenNow().startsWith("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b"), fenNow());
$("fen").value = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"; $("go").click(); await sleep(20);
drag("g8", "f6"); await sleep(30);
check("Black pieces move even when it is White's turn, and the turn becomes White's", fenNow().startsWith("rnbqkb1r/pppppppp/5n2/8/8/8/PPPPPPPP/RNBQKBNR w"), fenNow());

console.log("   undo / redo");
$("fen").value = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"; $("go").click(); await sleep(20);
await snap("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
drag("e2", "e4"); await sleep(20); drag("e7", "e5"); await sleep(20);
check("two moves played", fenNow().startsWith("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w"), fenNow());
$("undo").click(); await sleep(20);
check("undo goes back one move", fenNow().startsWith("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b"), fenNow());
$("redo").click(); await sleep(20);
check("redo replays it", fenNow().startsWith("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w"), fenNow());
w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
await sleep(20);
check("← key undoes", fenNow().startsWith("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b"), fenNow());
w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
await sleep(20);
check("→ key redoes", fenNow().startsWith("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w"), fenNow());
$("fen").focus(); 
$("fen").dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
await sleep(20);
check("arrow keys are ignored while typing in the FEN box", fenNow().startsWith("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w"), fenNow());
$("redo").click(); $("redo").click();
check("redo with nothing to redo is harmless", fenNow().startsWith("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w"));

console.log("   promotion picker");
$("fen").value = "8/P6k/8/8/8/8/8/K7 w - - 0 1"; $("go").click(); await sleep(20);
drag("a7", "a8"); await sleep(20);
check("reaching the last rank opens the picker instead of auto-queening", !$("promo").hidden && $("promo").querySelectorAll(".promo-btn").length === 4 && fenNow().startsWith("8/P6k/"), `${$("promo").hidden} ${fenNow()}`);
$("promo").querySelector('.promo-btn[data-piece="n"]').click(); await sleep(30);
check("choosing Knight promotes to a knight", /^N7\/7k\/8/.test(fenNow()) && $("promo").hidden, fenNow());
$("fen").value = "8/P6k/8/8/8/8/8/K7 w - - 0 1"; $("go").click(); await sleep(20);
drag("a7", "a8"); await sleep(20);
$("promo").querySelector('.promo-btn[data-piece="q"]').click(); await sleep(30);
check("choosing Queen promotes to a queen", /^Q7\/7k\/8/.test(fenNow()), fenNow());
$("fen").value = "8/P6k/8/8/8/8/8/K7 w - - 0 1"; $("go").click(); await sleep(20);
drag("a7", "a8"); await sleep(20);
w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(20);
check("Esc cancels the picker and leaves the pawn alone", $("promo").hidden && fenNow().startsWith("8/P6k/"), fenNow());

console.log("   special moves");
$("fen").value = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"; $("go").click(); await sleep(20);
drag("e1", "g1"); await sleep(30);
check("castling by dragging the king", fenNow().startsWith("r3k2r/8/8/8/8/8/8/R4RK1 b"), fenNow());
$("fen").value = "8/8/8/3pP3/8/8/8/K6k w - d6 0 1"; $("go").click(); await sleep(20);
drag("e5", "d6"); await sleep(30);
check("en passant capture", fenNow().startsWith("8/8/3P4/8/8/8/8/K6k b") || /^8\/8\/3P4\/8\//.test(fenNow()), fenNow());

console.log("   Auto-follow pauses itself when you play a move");
$("fen").value = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"; $("go").click(); await sleep(20);
$("auto").checked = true; $("auto").onchange();
drag("e2", "e4"); await sleep(30);
check("Auto-follow switched off", $("auto").checked === false);
check("and the user is told why", /Auto-follow paused/.test($("status").textContent), $("status").textContent);
const pollsAfter = posted.filter((m) => m.type === "snapshot" && m.auto === true).length;
await sleep(1000);
check("polling really stopped (your line is not overwritten)", posted.filter((m) => m.type === "snapshot" && m.auto === true).length === pollsAfter);
await snap("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
check("a fresh Snapshot resets the move history", (() => { const b = fenNow(); $("undo").click(); return fenNow() === b; })());

console.log("   compact view");
const layouts = () => posted.filter((m) => m.type === "layout");
await sleep(40);
check("panel announces its full-size layout at load", layouts().length >= 1 && layouts().at(-1).compact === false && layouts().at(-1).width === 372, JSON.stringify(layouts().at(-1)));
w.dispatchEvent(new w.MessageEvent("message", { data: { type: "toggleCompact" } }));
check("toggleCompact from the host switches to the compact layout", w.document.body.classList.contains("compact") && layouts().at(-1).compact === true && layouts().at(-1).width === 296, JSON.stringify(layouts().at(-1)));
check("and persists the choice", storeLocal.compactMode === true, JSON.stringify(storeLocal));
w.dispatchEvent(new w.MessageEvent("message", { data: { type: "toggleCompact" } }));
check("toggling again returns to full view", !w.document.body.classList.contains("compact") && layouts().at(-1).compact === false && storeLocal.compactMode === false);
// the stylesheet must keep the essentials visible in compact and hide the rest
const css = fs.readFileSync(`${COPY}/panel.css`, "utf8");
const compactRules = css.slice(css.indexOf("body.compact {"));
check("compact CSS hides the FEN row, engine lines, settings and secondary links", /body\.compact #lines[\s\S]*?body\.compact \.fenrow[\s\S]*?body\.compact \.row\.small[\s\S]*?body\.compact #openChesscom[\s\S]*?body\.compact #copyFen[\s\S]*?display: none/.test(compactRules));
check("and does NOT hide the board, best move, Snapshot, Auto-follow, flip or Lichess", !/body\.compact[^{]*(#board\b|#best\b|#snap|#auto|#flip|#openLichess|\.chip)[^{]*\{[^}]*display:\s*none/.test(compactRules));

console.log("A6. auto-follow polling");
const snapsBefore = posted.filter((m) => m.type === "snapshot" && m.auto === true).length;
$("auto").checked = true; $("auto").onchange();
await sleep(1800);
const polled = posted.filter((m) => m.type === "snapshot" && m.auto === true).length - snapsBefore;
check("polls the page repeatedly while on", polled >= 3, String(polled));
$("auto").checked = false; $("auto").onchange();
const stopAt = posted.length; await sleep(1000);
check("stops polling when off", posted.length === stopAt);


console.log("A7. open this position elsewhere");
const { lichessUrl, chesscomUrl } = await import(`file://${COPY}/panel.js?t=${Date.now()}x`).catch(() => ({}));
$("fen").value = "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"; $("go").click();
$("openLichess").click();
check("lichess link: FEN in the path, spaces as underscores", opened.at(-1)?.[0] === "https://lichess.org/analysis/r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R_w_KQkq_-_4_4", JSON.stringify(opened.at(-1)));
check("opens in a new tab without leaking opener/referrer", opened.at(-1)?.[1] === "_blank" && /noopener/.test(opened.at(-1)?.[2]) && /noreferrer/.test(opened.at(-1)?.[2]));
$("openChesscom").click();
check("chess.com link: URL-encoded FEN + orientation", opened.at(-1)?.[0] === "https://www.chess.com/analysis?fen=r1bqkb1r%2Fpppp1ppp%2F2n2n2%2F4p3%2F2B1P3%2F5N2%2FPPPP1PPP%2FRNBQK2R%20w%20KQkq%20-%204%204&flip=false", opened.at(-1)?.[0]);
$("flip").click();
$("openLichess").click(); const li = opened.at(-1)[0];
$("openChesscom").click(); const cc = opened.at(-1)[0];
check("flipped board is passed on (lichess ?color=black, chess.com flip=true)", li.endsWith("?color=black") && cc.endsWith("&flip=true"), `${li} | ${cc}`);
$("flip").click();
$("turn").value = "b"; $("turn").onchange(); $("openLichess").click();
check("turn override is reflected in the link", /RNBQK2R_b_/.test(opened.at(-1)[0]), opened.at(-1)[0]);
$("turn").value = "auto"; $("turn").onchange();
await $("copyFen").onclick();
check("Copy FEN puts the current FEN on the clipboard", copied === $("fen").value && /^r1bqkb1r/.test(copied), String(copied));
check("and confirms it", /FEN copied/.test($("status").textContent), $("status").textContent);
const savedNav = globalThis.navigator;
Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async () => { throw new Error("denied"); } } }, configurable: true, writable: true });
w.document.execCommand = () => true;
await $("copyFen").onclick();
check("falls back to the textarea copy when the async clipboard is blocked", /FEN copied/.test($("status").textContent), $("status").textContent);
Object.defineProperty(globalThis, "navigator", { value: savedNav, configurable: true, writable: true });
if (typeof lichessUrl === "function") {
  check("URL helpers are pure and exported", lichessUrl("8/8/8/8/8/8/8/K6k w - - 0 1", false) === "https://lichess.org/analysis/8/8/8/8/8/8/8/K6k_w_-_-_0_1" && chesscomUrl("8/8/8/8/8/8/8/K6k w - - 0 1", true).endsWith("&flip=true"));
}

console.log("A8. glass vs basic style setting");
const glassMsgs = () => posted.filter((m) => m.type === "glass");
await sleep(30);
check("saved preference (Basic) is restored into the selector", $("glass").value === "off", $("glass").value);
check("and told to the host as glass:off", glassMsgs().length >= 1 && glassMsgs().at(-1).on === false, JSON.stringify(glassMsgs()));
$("glass").value = "on"; $("glass").onchange();
check("choosing Glass tells the host glass:on and saves it", glassMsgs().at(-1).on === true && storeLocal.glassMode === "on", JSON.stringify([glassMsgs().at(-1), storeLocal]));
Object.defineProperty(globalThis, "navigator", { value: { deviceMemory: 2, hardwareConcurrency: 8 }, configurable: true, writable: true });
$("glass").value = "auto"; $("glass").onchange();
check("Auto on a 2GB device -> Basic", glassMsgs().at(-1).on === false && storeLocal.glassMode === "auto");
Object.defineProperty(globalThis, "navigator", { value: { deviceMemory: 8, hardwareConcurrency: 1 }, configurable: true, writable: true });
$("glass").onchange();
check("Auto on a 1-core device -> Basic", glassMsgs().at(-1).on === false);
Object.defineProperty(globalThis, "navigator", { value: { deviceMemory: 8, hardwareConcurrency: 8 }, configurable: true, writable: true });
$("glass").onchange();
check("Auto on a normal device -> Glass", glassMsgs().at(-1).on === true);
w.matchMedia = (q) => ({ matches: /reduced-transparency/.test(q) });
$("glass").onchange();
check("Auto respects the OS 'reduce transparency' setting", glassMsgs().at(-1).on === false);
w.matchMedia = undefined;
Object.defineProperty(globalThis, "navigator", { value: { deviceMemory: 2, hardwareConcurrency: 1 }, configurable: true, writable: true });
$("glass").value = "on"; $("glass").onchange();
check("explicit Glass overrides Auto even on a weak device", glassMsgs().at(-1).on === true);
$("glass").value = "auto"; $("glass").onchange();

// ---------------- Part B: host shell (content.js) ----------------
console.log("B. host shell");
const hostDom = new JSDOM("<!doctype html><body><p>page</p></body>", { url: "https://www.chess.com/play", runScripts: "outside-only", pretendToBeVisual: true });
const hw = hostDom.window;
hw.chrome = { runtime: { getURL: (p) => `chrome-extension://abc/${p}`, sendMessage: (m, cb) => cb && cb(null), lastError: undefined } };
const code = fs.readFileSync(`${COPY}/content.js`, "utf8");
hw.eval(code);
const host = [...hw.document.documentElement.children].find((e) => e.tagName === "DIV");
const frame = host.querySelector("iframe");
const bar = host.firstElementChild;
check("glass shell mounted with the panel iframe", !!host && frame && frame.src === "chrome-extension://abc/panel.html");
check("shell is rounded (32px) and uses the lighter 20px blur (jsdom can't parse backdrop-filter, so check the source)", host.style.borderRadius === "32px" && /blur\(20px\) saturate\(160%\)/.test(code) && !/blur\(30px\)/.test(code));
check("iframe stays transparent (color-scheme matched)", /color-scheme:\s*normal/.test(frame.style.cssText) && /background:\s*transparent/.test(frame.style.cssText));
check("header shows the new icon + title", bar.querySelector("img").src.endsWith("icons/48.png") && /Board Analyzer/.test(bar.textContent));
const panelOrigin = new hw.URL(frame.src).origin; // jsdom reports "null" for extension URLs; Chrome reports the real origin
const fromPanel = (data) => hw.dispatchEvent(new hw.MessageEvent("message", { data, origin: panelOrigin, source: frame.contentWindow }));
fromPanel({ type: "height", height: 700 });
check("height message resizes the frame (capped so the whole panel fits the viewport)", frame.style.height === `${Math.min(700, hw.innerHeight - 46 - 2 - 24)}px`, frame.style.height);
fromPanel({ type: "height", height: 120 });
check("never collapses below a usable height", frame.style.height === "200px", frame.style.height);
hw.dispatchEvent(new hw.MessageEvent("message", { data: { type: "close" }, origin: "https://evil.example", source: frame.contentWindow }));
check("messages from other origins are ignored", host.style.display !== "none");
const [compactBtn, minBtn, closeBtn] = bar.querySelectorAll("button");
check("header has Compact, Minimize and Close buttons (no decorative dash)", bar.querySelectorAll("button").length === 3 && /Compact/.test(compactBtn.title) && /Minimi/.test(minBtn.title) && /Hide/.test(closeBtn.title) && bar.querySelectorAll("span").length === 1);
check("starts open at full width, higher on screen than before (top 24px, was 80px)", host.dataset.minimized === "false" && frame.style.display === "block" && host.style.width === "374px" && parseFloat(host.style.top) <= 24, `${host.style.width} top=${host.style.top}`);
// ---- compact button ----
const toPanel = [];
frame.contentWindow.postMessage = (...a) => toPanel.push(a[0]);
compactBtn.click();
check("Compact button asks the panel to toggle (panel owns the state)", toPanel.some((m) => m.type === "toggleCompact"), JSON.stringify(toPanel));
fromPanel({ type: "layout", compact: true, width: 296 });
check("compact layout narrows the shell (296 + 2px border)", host.style.width === "298px" && host.dataset.compact === "true", `${host.style.width} ${host.dataset.compact}`);
check("button now says 'Full view'", /Full view/.test(compactBtn.title));
fromPanel({ type: "layout", compact: false, width: 372 });
check("back to the full width", host.style.width === "374px" && host.dataset.compact === "false" && /Compact view/.test(compactBtn.title));
fromPanel({ type: "layout", compact: true, width: 296 });
minBtn.click();
check("while minimized the compact button is hidden and the pill keeps its own width", compactBtn.style.display === "none" && host.style.width === "248px");
minBtn.click();
check("restoring brings back the compact width and the button", compactBtn.style.display !== "none" && host.style.width === "298px");
fromPanel({ type: "layout", compact: false, width: 372 });

// ---- stays fully on screen ----
fromPanel({ type: "height", height: 900 });
const hostH = () => 46 + 2 + parseFloat(frame.style.height);
check("a tall panel is capped and slid up so the bottom is not cut off", parseFloat(frame.style.height) === hw.innerHeight - 72 && parseFloat(host.style.top) + hostH() <= hw.innerHeight - 12 + 0.5 && parseFloat(host.style.top) >= 12, `top=${host.style.top} frame=${frame.style.height} vh=${hw.innerHeight}`);
Object.defineProperty(hw, "innerHeight", { value: 520, configurable: true, writable: true });
hw.dispatchEvent(new hw.Event("resize"));
check("shrinking the window re-fits the panel", parseFloat(frame.style.height) === 520 - 72 && parseFloat(host.style.top) + hostH() <= 520 - 12 + 0.5, `top=${host.style.top} frame=${frame.style.height}`);
Object.defineProperty(hw, "innerHeight", { value: 768, configurable: true, writable: true });
hw.dispatchEvent(new hw.Event("resize"));
fromPanel({ type: "height", height: 640 });
check("a short panel keeps a comfortable top margin", parseFloat(host.style.top) >= 12 && parseFloat(host.style.top) + hostH() <= 768 - 12 + 0.5);
minBtn.click();
check("Minimize collapses to a slim pill (frame hidden)", host.dataset.minimized === "true" && frame.style.display === "none" && host.style.width === "248px" && host.style.borderRadius === "999px", `${host.dataset.minimized} ${frame.style.display} ${host.style.width} ${host.style.borderRadius}`);
check("button now offers Restore", /Restore/.test(minBtn.title));
minBtn.click();
check("Restore brings the panel back", host.dataset.minimized === "false" && frame.style.display === "block" && host.style.borderRadius === "32px");
bar.dispatchEvent(new hw.MouseEvent("dblclick", { bubbles: true }));
check("double-clicking the header minimizes", host.dataset.minimized === "true");
bar.dispatchEvent(new hw.MouseEvent("dblclick", { bubbles: true }));
check("and restores", host.dataset.minimized === "false");
minBtn.dispatchEvent(new hw.MouseEvent("dblclick", { bubbles: true }));
check("double-clicking a button does not double-toggle", host.dataset.minimized === "false");
const leftBefore = host.style.left;
bar.setPointerCapture = () => {};
minBtn.dispatchEvent(new hw.MouseEvent("pointerdown", { clientX: 5, clientY: 5, bubbles: true }));
bar.dispatchEvent(new hw.MouseEvent("pointermove", { clientX: 400, clientY: 400, bubbles: true }));
bar.dispatchEvent(new hw.MouseEvent("pointerup", { bubbles: true }));
check("pressing a header button never starts a drag", host.style.left === leftBefore);
closeBtn.click();
check("Close hides the shell", host.style.display === "none");
hw.eval(code);
check("running again (toolbar icon) shows it again", host.style.display === "block");
fromPanel({ type: "close" });
check("panel's own close button still hides it", host.style.display === "none");
hw.eval(code);

// glass / basic
const gbg = host.style.background;
fromPanel({ type: "glass", on: false });
check("Basic style = solid panel, no blur", host.dataset.glass === "off" && host.style.background !== gbg && !/gradient/.test(host.style.background), host.style.background);
fromPanel({ type: "glass", on: true });
check("Glass style = translucent gradient again", host.dataset.glass === "on" && /gradient/.test(host.style.background));
bar.dispatchEvent(new hw.MouseEvent("pointerdown", { clientX: 10, clientY: 10, bubbles: true }));
check("blur is switched off while dragging (smoother on weak GPUs), panel stays readable", /rgba\(46,\s*50,\s*70,\s*0?\.9/.test(host.style.background), host.style.background);
bar.dispatchEvent(new hw.MouseEvent("pointerup", { bubbles: true }));
check("and restored after the drag", /rgba\(46,\s*50,\s*70,\s*0?\.7/.test(host.style.background) && host.dataset.glass === "on", host.style.background);
check("clipboard permission delegated to the panel frame", frame.allow === "clipboard-write");
fromPanel({ type: "close" });
hw.eval(code);
bar.setPointerCapture = () => {};
bar.dispatchEvent(new hw.MouseEvent("pointerdown", { clientX: 10, clientY: 10, bubbles: true }));
bar.dispatchEvent(new hw.MouseEvent("pointermove", { clientX: 60, clientY: 90, bubbles: true }));
bar.dispatchEvent(new hw.MouseEvent("pointerup", { bubbles: true }));
check("header drags the window", host.style.left !== "" && host.style.right === "auto", `${host.style.left}/${host.style.right}`);

console.log(fail ? `\n${fail} FAILED` : "\nCHESS CHECKS PASSED");
process.exit(fail ? 1 : 0);
