import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COPY = SRC; // package.json here says "type": "module", so the extension files import directly

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (n, c, x = "") => { console.log(`  ${c ? "✓" : "✗"} ${n} ${c ? "" : x}`); if (!c) fail++; };

const core = await import(`file://${COPY}/scanner/core.js`);
const ed = await import(`file://${COPY}/editor.js`);
const bv = await import(`file://${COPY}/board-view.js`);
const sf = await import(`file://${COPY}/scan-flow.js`);
const { createScanner } = await import(`file://${COPY}/scanner/client.js`);

// ---------------- 1. reader helpers ----------------
console.log("1. reader helpers (core.js)");
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
check("placement <-> grid round-trips", core.gridToPlacement(core.placementToGrid(START)) === START);
check("rotating the grid = seeing the board from the other side", core.gridToPlacement(core.rotateGrid(core.placementToGrid(START))) === "RNBKQBNR/PPPPPPPP/8/8/8/8/pppppppp/rnbkqbnr");
const solid = (w, h, rgb) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { d[4 * i] = rgb[0]; d[4 * i + 1] = rgb[1]; d[4 * i + 2] = rgb[2]; d[4 * i + 3] = 255; } return { width: w, height: h, data: d }; };
const small = core.resizeImage(solid(100, 60, [200, 100, 50]), 20, 20);
check("resizing a flat colour keeps the colour", small.data[0] === 200 && small.data[1] === 100 && small.data[2] === 50 && small.data[4 * 399] === 200);
const lb = core.resizeRegion(solid(100, 50, [255, 255, 255]), { x0: 0, y0: 0, w: 100, h: 50 }, 20, 20, 100, 100);
check("letterbox: the padded bottom half is black, the picture half is white", lb.data[4 * (2 * 20 + 5)] === 255 && lb.data[4 * (17 * 20 + 5)] === 0);
const oob = core.cropBoard(solid(40, 40, [255, 255, 255]), [-20, 0, 20, 40], 8);
check("cropping past the image edge fills black", oob.data[0] === 0 && oob.data[4 * 7] === 255);
const half = (() => { const d = new Uint8ClampedArray(8 * 8 * 4).fill(255); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const v = x < 4 ? 0 : 255; d.set([v, v, v, 255], 4 * (y * 8 + x)); } return { width: 8, height: 8, data: d }; })();
check("a 2:1 downscale averages neighbouring pixels", core.resizeImage(half, 4, 4).data[4 * 1] === 0 || core.resizeImage(half, 4, 4).data[0] === 0);
check("axis-aligned quad detected, skewed quad is not", core.isAxisAligned([[0, 0], [100, 0], [100, 100], [0, 100]]) && !core.isAxisAligned([[0, 0], [100, 0], [90, 100], [0, 100]]));
// legality step
const mk = (idxs) => idxs.map((c) => { const p = Array(13).fill(0.001); p[c] = 0.8; return p; });
{
  const two = Array(64).fill(0); two[10] = 1; two[20] = 1; // two white kings, both only 80% sure
  const P = mk(two); P[20][1] = 0.6; P[20][2] = 0.3; // the second king's runner-up is a queen
  const fixed = core.fixLegality(P);
  check("two kings: the less certain one is swapped for its next best piece", fixed.filter((c) => c === 1).length === 1 && fixed[20] === 2, JSON.stringify(fixed.filter((c) => c)));
  const sure = Array(64).fill(0); sure[10] = 1; sure[20] = 1;
  const Q = mk(sure); Q[10][1] = 0.99; Q[20][1] = 0.99;
  check("confident squares are never changed (studies with odd material survive)", core.fixLegality(Q).filter((c) => c === 1).length === 2);
  const pawnBack = Array(64).fill(0); pawnBack[3] = 6;
  const R = mk(pawnBack); R[3][6] = 0.6; R[3][2] = 0.3;
  check("a pawn on the back rank is demoted", core.fixLegality(R)[3] === 2);
}

// ---------------- 2. position checks and board helpers ----------------
console.log("2. position checks (editor.js) and board helpers (board-view.js)");
const G = (pl) => core.placementToGrid(pl);
check("start position is fine", ed.checkPosition(G(START), "w") === null);
check("no black king", /black king/.test(ed.checkPosition(G("8/8/8/8/8/8/8/4K3"), "w")));
check("no white king", /white king/.test(ed.checkPosition(G("4k3/8/8/8/8/8/8/8"), "w")));
check("two white kings", /one white king/.test(ed.checkPosition(G("4k3/8/8/8/8/8/8/K3K3"), "w")));
check("pawn on the last row", /first or last/.test(ed.checkPosition(G("4k2P/8/8/8/8/8/8/4K3"), "w")));
check("nine pawns", /more than 8 pawns/.test(ed.checkPosition(G("4k3/pppppppp/p7/8/8/8/PPPPPPPP/4K3"), "w")));
const inCheck = G("4k3/8/8/8/8/8/4R3/4K3");
check("black in check while White is to move is illegal", /Black is in check/.test(ed.checkPosition(inCheck, "w")));
check("...but fine when it is Black's move", ed.checkPosition(inCheck, "b") === null);
check("the side to move is guessed from who is in check", ed.guessTurn(inCheck) === "b" && ed.guessTurn(G(START)) === "w");
check("castling rights only where king and rook stand at home", JSON.stringify(ed.homeCastling(G(START))) === '{"K":true,"Q":true,"k":true,"q":true}' && JSON.stringify(ed.homeCastling(G("4k3/8/8/8/8/8/8/4K3"))) === '{"K":false,"Q":false,"k":false,"q":false}');
check("FEN is built from grid, turn and rights", ed.fenFrom({ grid: G(START), turn: "b", castle: { K: true, Q: false, k: false, q: true } }) === START + " b Kq - 0 1");
check("no rights gives '-'", ed.fenFrom({ grid: G(START), turn: "w", castle: {} }).split(" ")[2] === "-");
check("a data URL becomes an image Blob", (() => { const b = sf.dataUrlToBlob("data:image/png;base64,iVBORw0KGgo="); return b.type === "image/png" && b.size === 8; })());
check("square names <-> grid positions", bv.squareName(0, 0) === "a8" && bv.squareName(7, 7) === "h1" && bv.squarePos("e4").join() === "4,4");

// ---------------- 3. client: worker, fallback, idle ----------------
console.log("3. scanner client");
const okResult = { placement: "8/8/8/8/8/8/8/8" };
const mkWorker = (opts = {}) => {
  const w = { sent: [], terminated: false, postMessage(m) { this.sent.push(m); if (opts.onScan) opts.onScan(w, m); else setTimeout(() => w.onmessage({ data: { type: "result", id: m.id, result: okResult } }), 0); }, terminate() { this.terminated = true; } };
  if (!opts.silent) setTimeout(() => w.onmessage && w.onmessage({ data: { type: "ready" } }), 0);
  return w;
};
{
  const made = [];
  const stages = [];
  const sc = createScanner({ makeWorker: () => { const w = mkWorker({ onScan: (w2, m) => { w2.onmessage({ data: { type: "stage", id: m.id, stage: "reading" } }); w2.onmessage({ data: { type: "result", id: m.id, result: okResult } }); } }); made.push(w); return w; }, idleMs: 60, onStage: (s) => stages.push(s) });
  const r = await sc.scan(new Blob(["x"]), [1, 2, 3, 4]);
  check("a scan goes through the worker and returns its result", r === okResult && made.length === 1 && made[0].sent[0].type === "scan" && made[0].sent[0].crop.join() === "1,2,3,4");
  check("progress stages reach the UI", stages.includes("reading"));
  await sc.scan(new Blob(["y"]));
  check("the worker is reused for the next scan", made.length === 1 && sc.mode === "worker");
  await sleep(120);
  check("after the idle time the worker is terminated (frees the model memory)", made[0].terminated && sc.mode === "idle");
  await sc.scan(new Blob(["z"]));
  check("and a later scan starts a fresh one", made.length === 2);
  sc.dispose();
}
{
  let inPageUsed = 0;
  const sc = createScanner({ makeWorker: () => { const w = mkWorker({ silent: true }); setTimeout(() => w.onerror({ message: "Failed to load module" }), 0); return w; }, makeInPage: async () => ({ scan: async () => { inPageUsed++; return okResult; }, release: async () => {} }), idleMs: 1000 });
  const r = await sc.scan(new Blob(["x"]));
  check("if the worker cannot start the reader runs on the page instead", r === okResult && inPageUsed === 1 && sc.mode === "page");
  await sc.scan(new Blob(["x"]));
  check("and stays there (no repeated failing worker starts)", inPageUsed === 2);
  await sc.dispose();
}
{
  let made = 0;
  const sc = createScanner({ makeWorker: () => { made++; return mkWorker({ silent: true }); }, makeInPage: async () => ({ scan: async () => okResult, release: async () => {} }), readyMs: 40, idleMs: 1000 });
  const r = await sc.scan(new Blob(["x"]));
  check("a worker that never says ready times out and falls back", r === okResult && sc.mode === "page" && made === 1);
  await sc.dispose();
}
{
  let n = 0;
  const sc = createScanner({ makeWorker: () => mkWorker({ onScan: (w, m) => { n++; if (n === 1) w.onerror({ message: "out of memory" }); else w.onmessage({ data: { type: "result", id: m.id, result: okResult } }); } }), idleMs: 1000 });
  let err = null;
  try { await sc.scan(new Blob(["x"])); } catch (e) { err = e; }
  check("a worker that dies mid-scan rejects that scan with its message", err && /out of memory/.test(err.message), String(err));
  const r = await sc.scan(new Blob(["x"]));
  check("the next scan starts a new worker and works", r === okResult);
  await sc.dispose();
}
{
  const sc = createScanner({ makeWorker: () => mkWorker({ onScan: (w, m) => w.onmessage({ data: { type: "error", id: m.id, message: "Could not load the board model (404)" } }) }), idleMs: 1000 });
  let err = null;
  try { await sc.scan(new Blob(["x"])); } catch (e) { err = e; }
  check("a reader error comes back as a readable message", err && /404/.test(err.message));
  await sc.dispose();
}

// ---------------- 4. the panel: Snapshot, scans, editor ----------------
console.log("4. panel");
const html = fs.readFileSync(`${COPY}/panel.html`, "utf8").replace(/<script[^>]*><\/script>/, "").replace(/<link[^>]*>/, "");
const dom = new JSDOM(html, { url: "chrome-extension://abc/panel.html", pretendToBeVisual: true });
const w = dom.window;
const posted = [];
class FakeWorker {
  constructor(url) {
    this.url = String(url);
    this.sent = [];
    this.kind = /scanner\/worker\.js$/.test(this.url) ? "scan" : "engine";
    if (this.kind === "scan") { FakeWorker.scan = this; setTimeout(() => this.onmessage && this.onmessage({ data: { type: "ready" } }), 0); }
    else FakeWorker.engine = this;
  }
  postMessage(m) {
    this.sent.push(m);
    if (this.kind === "engine") queueMicrotask(() => { if (m === "uci") this.onmessage({ data: "uciok" }); if (m === "isready") this.onmessage({ data: "readyok" }); });
    else if (m && m.type === "scan") FakeWorker.onScan(this, m);
  }
  terminate() { this.terminated = true; }
}
const START_FEN = START + " w KQkq - 0 1";
const ITALIAN = "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R";
const cannedGrid = core.placementToGrid(ITALIAN);
const result = (over = {}) => ({
  grid: cannedGrid.map((r) => [...r]), bottom: "white", bottomConfidence: 0.99, orientationUnsure: false,
  placement: ITALIAN, confidence: 0.99, squareConfidence: Array(64).fill(0.99), legalityChanges: 0, pieces: 28,
  corners: [[0, 0], [1, 0], [1, 1], [0, 1]], ms: { locate: 1, read: 1 }, ...over,
});
let nextResult = () => result();
FakeWorker.onScan = (wk, m) => {
  wk.onmessage({ data: { type: "stage", id: m.id, stage: "locating" } });
  setTimeout(() => {
    const r = nextResult(m);
    if (r instanceof Error) wk.onmessage({ data: { type: "error", id: m.id, message: r.message } });
    else if (r !== "hang") wk.onmessage({ data: { type: "result", id: m.id, result: r } });
  }, 5);
};
Object.assign(globalThis, { window: w, document: w.document, parent: { postMessage: (m) => posted.push(m) }, Worker: FakeWorker });
globalThis.ResizeObserver = class { constructor() {} observe() {} };
w.open = () => null;
const setNav = (o) => Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async () => {} }, deviceMemory: 8, hardwareConcurrency: 8, ...o }, configurable: true, writable: true });
setNav({});
// Premium (a developer licence in an unpacked copy), so the daily free-scan allowance does not get in the way of
// these reader tests; the allowance itself is tested in premium.test.mjs.
globalThis.chrome = { runtime: { getManifest: () => ({ version: "test" }) }, storage: { local: { get: async (k) => (k === "license" ? { license: { status: "dev" } } : {}), set: async () => {} } } };
const created = [], revoked = [];
URL.createObjectURL = () => { const u = `blob:test/${created.length}`; created.push(u); return u; };
URL.revokeObjectURL = (u) => revoked.push(u);
const $ = (id) => w.document.getElementById(id);
await import(`file://${COPY}/panel.js?t=${Date.now()}`);
await sleep(40);
const P = w.__panel;

const boardEl = $("board");
boardEl.getBoundingClientRect = () => ({ left: 0, top: 0, right: 320, bottom: 320, width: 320, height: 320 });
boardEl.setPointerCapture = () => {};
const mouse = (el, type, x, y) => el.dispatchEvent(new w.MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
const at = (sq) => { const f = "abcdefgh".indexOf(sq[0]), r = +sq[1]; return [f * 40 + 20, (8 - r) * 40 + 20]; };
const press = (sq) => { mouse(boardEl, "pointerdown", ...at(sq)); mouse(boardEl, "pointerup", ...at(sq)); };
const fenNow = () => $("fen").value;
const sqEl = (n) => boardEl.querySelector(`.sq[data-sq="${n}"]`);
const pieceAt = (n) => { const i = sqEl(n).querySelector("img"); return i ? i.alt : null; };
const weakNow = () => [...boardEl.querySelectorAll(".sq.weak")].map((d) => d.dataset.sq).sort().join();
const waitFor = async (fn, ms = 1500) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(10); } return false; };
const idle = () => !$("snap").classList.contains("busy");
const asks = () => posted.filter((m) => m.type === "snapshot" && m.auto === false);
const caps = () => posted.filter((m) => m.type === "capture");
const reply = (data) => w.dispatchEvent(new w.MessageEvent("message", { data }));
const PNG_URL = "data:image/png;base64,iVBORw0KGgo=";
const png = () => new w.File([new Uint8Array([137, 80, 78, 71])], "board.png", { type: "image/png" });
// Take a snapshot on a page without a chess board, answering the host's questions like the real host would.
async function screenSnapshot({ shift = false } = {}) {
  const asked = asks().length, capped = caps().length;
  $("snap").dispatchEvent(new w.MouseEvent("click", { bubbles: true, shiftKey: shift }));
  if (!shift) { await waitFor(() => asks().length === asked + 1); reply({ type: "snapshot", fen: null, src: "none", auto: false, id: asks().at(-1).id }); }
  await waitFor(() => caps().length === capped + 1);
  reply({ type: "captured", id: caps().at(-1).id, ok: true, dataUrl: PNG_URL });
  await waitFor(idle, 3000);
}
const resetBoard = async () => {
  $("noteClose").click();
  $("snap").click(); const a = asks().at(-1); reply({ type: "snapshot", fen: START_FEN, src: "t", auto: false, id: a.id }); await sleep(10);
};
const noteActions = () => [...$("noteActions").querySelectorAll("button")].map((b) => b.textContent);
const clickAction = (label) => [...$("noteActions").querySelectorAll("button")].find((b) => b.textContent === label).click();

console.log("4a. one button reads the page, or else the screen");
check("the toolbar has Snapshot, Edit and a side button for pictures", !!$("snap") && !!$("editBtn") && !!$("pictureBtn") && $("snap").closest(".row").contains($("editBtn")) && $("snap").closest(".row").contains($("pictureBtn")));
check("undo, redo and flip sit next to Follow", $("auto").closest(".row").contains($("undo")) && $("auto").closest(".row").contains($("flip")));
check("there is no scan sheet any more", !$("scan") && !$("scanBtn"));
$("snap").click();
const first = asks().at(-1);
check("Snapshot first asks the page for its own board data", !!first && typeof first.id === "number" && caps().length === 0);
reply({ type: "snapshot", fen: ITALIAN + " w - - 0 1", src: "chess.com board DOM", auto: false, id: first.id });
await sleep(10);
check("a chess site answers: exact position, no picture taken", fenNow().startsWith(ITALIAN) && caps().length === 0 && $("status").textContent === "Source: chess.com board DOM" && idle());
check("an answer for an old request is ignored", (() => { const f = fenNow(); reply({ type: "snapshot", fen: START_FEN, src: "x", auto: false, id: 999999 }); return fenNow() === f; })());

await screenSnapshot();
check("no board on the page: the screen is captured automatically", caps().length === 1);
const scanMsg = FakeWorker.scan.sent.at(-1);
check("the whole picture goes to the reader (no box)", scanMsg.type === "scan" && scanMsg.crop === null && scanMsg.blob.type === "image/png");
check("the position is analysed straight away: no confirmation step", fenNow().startsWith(ITALIAN + " w") && /scanned from the screen/.test($("status").textContent) && !w.document.body.classList.contains("editing") && !w.document.body.classList.contains("cropping"));
check("the engine was asked to analyse it", FakeWorker.engine.sent.some((m) => String(m).startsWith("position fen " + ITALIAN)));
check("a calm note says what happened, with Edit", !$("scanNote").hidden && !$("scanNote").classList.contains("warn") && /Scanned from the screen · White to move/.test($("noteText").textContent) && noteActions().join() === "Edit", $("noteText").textContent);
check("no outlines when the reader is sure", weakNow() === "");
check("the board shows the pieces", pieceAt("e1") === "White king" && pieceAt("a8") === "Black rook" && pieceAt("e4") === "White pawn");
check("button label followed the stages and is back to normal", idle() && $("snapLabel").textContent === "Snapshot");

console.log("4b. shift+click, cancel, progress");
await resetBoard();
const askedBefore = asks().length;
await screenSnapshot({ shift: true });
check("Shift+click skips the page and reads the screen", asks().length === askedBefore && caps().length === 2);
await resetBoard();
nextResult = () => "hang";
$("snap").dispatchEvent(new w.MouseEvent("click", { bubbles: true, shiftKey: true }));
await waitFor(() => caps().length === 3);
reply({ type: "captured", id: caps().at(-1).id, ok: true, dataUrl: PNG_URL });
await waitFor(() => /Finding board/.test($("snapLabel").textContent));
check("the button shows the stage while reading", /Finding board/.test($("snapLabel").textContent) && $("snap").classList.contains("busy") && $("snap").getAttribute("aria-busy") === "true");
$("snap").click();
check("clicking again cancels", idle() && /Cancelled/.test($("status").textContent));
nextResult = () => result();
await sleep(30);
check("a late answer after cancelling is dropped", fenNow().startsWith(START) && $("scanNote").hidden);

console.log("4c. what the note says when the reader is unsure");
await resetBoard();
nextResult = () => result({ squareConfidence: Array.from({ length: 64 }, (_, i) => (i === 3 || i === 10 ? 0.4 : 0.99)) });
await screenSnapshot({ shift: true });
check("uncertain squares are outlined on the board itself (white at the bottom: d8, c7)", weakNow() === "c7,d8", weakNow());
check("the note warns and offers Edit and Select board", $("scanNote").classList.contains("warn") && /2 uncertain squares outlined/.test($("noteText").textContent) && noteActions().join() === "Edit,Select board…", noteActions().join());
await resetBoard();
nextResult = () => result({ bottom: "black", grid: core.rotateGrid(cannedGrid), squareConfidence: Array.from({ length: 64 }, (_, i) => (i === 3 || i === 10 ? 0.4 : 0.99)) });
await screenSnapshot({ shift: true });
check("black at the bottom: board shows Black's side and the FEN is still White's view", fenNow().startsWith(ITALIAN) && bv.squareName(0, 0) && boardEl.querySelector(".sq").dataset.sq === "h1", boardEl.querySelector(".sq").dataset.sq);
check("outlines land on the right squares after the rotation (e1, f2)", weakNow() === "e1,f2", weakNow());
await resetBoard();
nextResult = () => result({ orientationUnsure: true });
await screenSnapshot({ shift: true });
check("unsure which side is at the bottom: says so and offers 'Wrong way up'", /Not sure which side is at the bottom/.test($("noteText").textContent) && noteActions().includes("Wrong way up"));
clickAction("Wrong way up");
check("it turns the position around: pieces rotated, board flipped", fenNow().startsWith(core.gridToPlacement(core.rotateGrid(cannedGrid))) && boardEl.querySelector(".sq").dataset.sq === "h1");
check("and the note confirms, without nagging again", /Turned around/.test($("noteText").textContent) && !noteActions().includes("Wrong way up"));
await resetBoard();
$("noteClose").click();

nextResult = () => result({ squareConfidence: Array.from({ length: 64 }, (_, i) => (i === 3 ? 0.4 : 0.99)) });
await screenSnapshot({ shift: true });
check("before dismissing: outlined", weakNow() === "d8");
$("noteClose").click();
check("dismissing the note also clears the outlines", $("scanNote").hidden && weakNow() === "");
nextResult = () => result();

console.log("4d. reads that cannot be a real position");
await resetBoard();
const noKing = core.placementToGrid("r1bq3r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ3R");
nextResult = () => result({ grid: noKing });
await screenSnapshot({ shift: true });
check("missing king: the editor opens on what was read, with the reason", w.document.body.classList.contains("editing") && /Add the (white|black) king/.test($("eNote").textContent) && $("eDone").disabled, $("eNote").textContent);
check("the board shows the read pieces for fixing", pieceAt("d8") === "Black queen" && pieceAt("e1") === null);
check("nothing was analysed yet", !fenNow().includes("R1BQ3R"));
$("ePalette").querySelector('[data-tool="K"]').click(); press("e1");
$("ePalette").querySelector('[data-tool="k"]').click(); press("e8");
check("fixing both kings enables Done", !$("eDone").disabled);
$("eDone").click(); await sleep(20);
check("Done analyses it", !w.document.body.classList.contains("editing") && fenNow().startsWith("r1bqk2r/") && fenNow().includes("R1BQK2R") && /edited on the panel/.test($("status").textContent));
await resetBoard();
nextResult = () => result({ grid: core.placementToGrid("8/8/8/8/8/8/8/8"), pieces: 0, confidence: 0.2 });
await screenSnapshot({ shift: true });
check("nothing board-like found: a clear message instead of an empty editor", !w.document.body.classList.contains("editing") && $("scanNote").classList.contains("err") && /could not find a chess board/.test($("noteText").textContent) && noteActions().includes("Select board…") && noteActions().includes("Choose a picture…"), $("noteText").textContent);
nextResult = () => result();

console.log("4e. failures say what to do");
await resetBoard();
{
  const asked = asks().length, capped = caps().length;
  $("snap").dispatchEvent(new w.MouseEvent("click", { bubbles: true, shiftKey: true }));
  await waitFor(() => caps().length === capped + 1);
  reply({ type: "captured", id: caps().at(-1).id, ok: false, error: "Chrome only allows capturing after you click the icon." });
  await waitFor(idle);
  check("capture refused: explained, and a picture can be chosen instead", $("scanNote").classList.contains("err") && /click the icon/.test($("noteText").textContent) && noteActions().join() === "Choose a picture…");
}
await resetBoard();
nextResult = () => new Error("Could not load the board model (404)");
await screenSnapshot({ shift: true });
check("reader error: shown with Try again, Select board and Choose a picture", $("scanNote").classList.contains("err") && /could not be read: Could not load/.test($("noteText").textContent) && noteActions().join() === "Try again,Select board…,Choose a picture…", noteActions().join());
nextResult = () => result();
clickAction("Try again");
await waitFor(idle, 3000);
check("Try again reads the same picture successfully", fenNow().startsWith(ITALIAN) && !$("scanNote").classList.contains("err"));

console.log("4f. selecting the board on the picture");
await resetBoard();
nextResult = () => result({ squareConfidence: Array.from({ length: 64 }, (_, i) => (i === 3 ? 0.4 : 0.99)) });
await screenSnapshot({ shift: true });
clickAction("Select board…");
check("opens the crop view on the last picture", w.document.body.classList.contains("cropping") && $("cropImg").getAttribute("src") === created.at(-1));
const img = $("cropImg");
Object.defineProperty(img, "naturalWidth", { value: 1000, configurable: true });
Object.defineProperty(img, "naturalHeight", { value: 500, configurable: true });
img.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 });
img.dispatchEvent(new w.Event("load"));
check("the hint invites a box", /Drag a box/.test($("cropHint").textContent));
const cm = (t, x, y) => mouse($("cropWrap"), t, x, y);
cm("pointerdown", 20, 10); cm("pointermove", 120, 70); cm("pointerup", 120, 70);
check("dragging draws the box", !$("cropBox").hidden && $("cropBox").style.left === "20px" && $("cropBox").style.width === "100px" && $("cropBox").style.height === "60px");
cm("pointerdown", 40, 40); cm("pointerup", 41, 41);
check("a plain click clears the box", $("cropBox").hidden);
cm("pointerdown", 190, 90); cm("pointermove", 20, 10); cm("pointerup", 20, 10);
check("dragging backwards works", $("cropBox").style.left === "20px" && $("cropBox").style.width === "170px");
cm("pointerdown", 20, 10); cm("pointermove", 400, 300); cm("pointerup", 400, 300);
check("the box is clamped to the picture", $("cropBox").style.width === "180px" && $("cropBox").style.height === "90px");
cm("pointerdown", 20, 10); cm("pointermove", 120, 70); cm("pointerup", 120, 70);
nextResult = () => result();
$("cropRead").click();
check("Read closes the view and reads", !w.document.body.classList.contains("cropping") && $("snap").classList.contains("busy"));
await waitFor(idle, 3000);
const cropMsg = FakeWorker.scan.sent.at(-1);
check("only the boxed part is read (box in picture pixels)", cropMsg.crop.map(Math.round).join() === "100,50,600,350", JSON.stringify(cropMsg.crop));
check("and the new result is on the board with no outlines", weakNow() === "" && fenNow().startsWith(ITALIAN));
await resetBoard();
nextResult = () => result({ squareConfidence: Array.from({ length: 64 }, (_, i) => (i === 3 ? 0.4 : 0.99)) });
await screenSnapshot({ shift: true });
clickAction("Select board…");
$("cropCancel").click();
check("Cancel leaves everything as it was", !w.document.body.classList.contains("cropping") && weakNow() === "d8");
nextResult = () => result();

console.log("4g. pictures from a file, the clipboard, drag-and-drop");
await resetBoard();
Object.defineProperty($("pictureInput"), "files", { value: [png()], configurable: true });
$("pictureInput").dispatchEvent(new w.Event("change"));
await waitFor(idle, 3000);
check("choosing a file reads it straight away", fenNow().startsWith(ITALIAN) && /scanned from the picture/.test($("status").textContent) && /Scanned from the picture/.test($("noteText").textContent));
await resetBoard();
Object.defineProperty($("pictureInput"), "files", { value: [new w.File(["x"], "note.txt", { type: "text/plain" })], configurable: true });
$("pictureInput").dispatchEvent(new w.Event("change"));
check("a file that is not a picture is refused politely", $("scanNote").classList.contains("err") && /not a picture/.test($("noteText").textContent) && fenNow().startsWith(START));
await resetBoard();
w.document.dispatchEvent(Object.assign(new w.Event("paste", { bubbles: true, cancelable: true }), { clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => png() }] } }));
await waitFor(idle, 3000);
check("pasting an image anywhere reads it", fenNow().startsWith(ITALIAN) && /picture/.test($("status").textContent));
await resetBoard();
const dropEv = (files) => { const e = new w.Event("drop", { bubbles: true, cancelable: true }); e.dataTransfer = { types: ["Files"], files }; return e; };
w.document.dispatchEvent(dropEv([png()]));
await waitFor(idle, 3000);
check("dropping an image anywhere reads it", fenNow().startsWith(ITALIAN));
await resetBoard();
w.document.dispatchEvent(Object.assign(new w.Event("paste", { bubbles: true, cancelable: true }), { clipboardData: { items: [{ kind: "string", type: "text/plain", getAsFile: () => null }] } }));
check("pasting text is left alone (FEN box works as usual)", idle() && fenNow().startsWith(START));
$("pictureBtn").click();
check("the side button just opens the file chooser (no extra screens)", !w.document.body.classList.contains("cropping") && !w.document.body.classList.contains("editing"));
setNav({ deviceMemory: 1 });
nextResult = () => "hang";
$("snap").dispatchEvent(new w.MouseEvent("click", { bubbles: true, shiftKey: true }));
await waitFor(() => caps().length > 0 && /Capturing/.test($("snapLabel").textContent));
check("a 1 GB device is told reading may be slow while it works", /slow side/.test($("status").textContent), $("status").textContent);
$("snap").click();
nextResult = () => result();
setNav({});

console.log("4h. editing any position on the board itself");
await resetBoard();
reply({ type: "page", site: "lichess", locked: false, board: true, video: false });
$("auto").checked = true; $("auto").onchange();
const stops = FakeWorker.engine.sent.filter((m) => m === "stop").length;
$("editBtn").click();
check("Edit makes the same board editable (no separate screen)", w.document.body.classList.contains("editing") && P.editor.isOpen() && boardEl.querySelectorAll(".sq").length === 64 && pieceAt("e1") === "White king");
check("the engine stops thinking about the old position", FakeWorker.engine.sent.filter((m) => m === "stop").length > stops);
check("the palette has Move, 12 pieces and an eraser", $("ePalette").querySelectorAll("button.tool").length === 14 && $("ePalette").querySelector(".tool.on").dataset.tool === "move");
check("turn and castling start from the position (White to move, all four rights)", w.document.querySelector("input[name=eTurn]:checked").value === "w" && ["eCK", "eCQ", "eCk", "eCq"].every((id) => $(id).checked && !$(id).disabled));
check("Done is available for a legal position", !$("eDone").disabled);
await reply({ type: "snapshot", fen: ITALIAN + " b - - 0 1", src: "page", auto: true });
check("Follow ticks are ignored while editing", fenNow().startsWith(START));
$("ePalette").querySelector('[data-tool="Q"]').click();
press("e5");
check("palette + tap places a piece", pieceAt("e5") === "White queen");
press("e5");
check("tapping again with the same piece removes it", pieceAt("e5") === null);
$("ePalette").querySelector('[data-tool="erase"]').click();
press("a2");
check("the eraser removes a piece", pieceAt("a2") === null);
$("ePalette").querySelector('[data-tool="move"]').click();
mouse(boardEl, "pointerdown", ...at("b2")); mouse(boardEl, "pointermove", ...at("b4")); mouse(boardEl, "pointerup", ...at("b4"));
check("dragging moves a piece anywhere (no chess rules)", pieceAt("b2") === null && pieceAt("b4") === "White pawn");
press("b4"); mouse(boardEl, "pointerdown", ...at("b5"));
check("click then click moves it too", pieceAt("b5") === "White pawn" && pieceAt("b4") === null);
mouse(boardEl, "pointerdown", ...at("c2")); mouse(boardEl, "pointerup", 999, 999);
check("dropping a piece off the board removes it", pieceAt("c2") === null);
mouse(boardEl, "pointerdown", ...at("e1")); mouse(boardEl, "pointerup", 999, 999);
check("without the white king Done is disabled and the note says why", $("eDone").disabled && /white king/.test($("eNote").textContent) && $("eNote").classList.contains("err"));
check("castling rights that depended on it are dropped", $("eCK").disabled && !$("eCK").checked);
$("ePalette").querySelector('[data-tool="K"]').click(); press("e1");
$("ePalette").querySelector('[data-tool="move"]').click();
check("the king back: Done is available again", !$("eDone").disabled);
$("eCK").checked = true; $("eCK").dispatchEvent(new w.Event("change"));
w.document.querySelector("input[name=eTurn][value=b]").checked = true;
w.document.querySelector("input[name=eTurn][value=b]").dispatchEvent(new w.Event("change"));
$("eFlip").click();
check("the board can be flipped while editing", boardEl.querySelector(".sq").dataset.sq === "h1");
const beforeEdit = fenNow();
$("eDone").click(); await sleep(30);
check("Done: the edited position is on the board and being analysed", !w.document.body.classList.contains("editing") && fenNow().split(" ")[1] === "b" && fenNow().split(" ")[2].includes("K") && pieceAt("b5") === "White pawn" && pieceAt("c2") === null && FakeWorker.engine.sent.some((m) => String(m).startsWith("position fen " + fenNow().split(" ").slice(0, 2).join(" "))), fenNow());
check("the view stays the way it was flipped", boardEl.querySelector(".sq").dataset.sq === "h1");
check("Follow was switched off so the page cannot overwrite the edit", $("auto").checked === false && /Follow is off/.test($("status").textContent), $("status").textContent);
$("undo").click(); await sleep(20);
check("Undo goes back to the position before the edit", fenNow() === beforeEdit);
$("flip").click();
$("editBtn").click();
$("ePalette").querySelector('[data-tool="erase"]').click(); press("d8");
$("eCancel").click(); await sleep(20);
check("Cancel discards the changes", !w.document.body.classList.contains("editing") && fenNow() === beforeEdit && pieceAt("d8") === "Black queen");
check("and the engine resumes on the real position", FakeWorker.engine.sent.filter((m) => String(m).startsWith("position fen " + beforeEdit.split(" ").slice(0, 2).join(" "))).length >= 2);
$("editBtn").click();
w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
check("Escape cancels the editor", !w.document.body.classList.contains("editing"));
$("editBtn").click();
w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
check("undo/redo keys do nothing while editing", w.document.body.classList.contains("editing"));
$("eClear").click();
check("Clear empties the board", boardEl.querySelectorAll(".sq img").length === 0 && $("eDone").disabled);
$("eCancel").click();

check("the panel's own board still plays moves after all that", (() => { press("e2"); press("e4"); return fenNow().includes("4P3") || fenNow().includes("/4P3/"); })());

// ---------------- 5. host: taking the picture ----------------
console.log("5. host page capture");
const hostDom = new JSDOM("<!doctype html><body><p>page</p></body>", { url: "https://www.youtube.com/watch", runScripts: "outside-only", pretendToBeVisual: true });
const hw = hostDom.window;
let sentToBg = [];
let bgAnswer = { ok: true, dataUrl: "data:image/png;base64,AAAA" };
let visibleDuringCapture = null;
hw.chrome = { runtime: { getURL: (p) => `chrome-extension://abc/${p}`, lastError: undefined,
  sendMessage: (m, cb) => { sentToBg.push(m); if (m.type === "capture") visibleDuringCapture = host.style.visibility; setTimeout(() => cb && cb(m.type === "capture" ? bgAnswer : null), 0); } } };
hw.eval(fs.readFileSync(`${COPY}/content.js`, "utf8"));
const host = [...hw.document.documentElement.children].find((e) => e.tagName === "DIV");
const frame = host.shadowRoot.querySelector("iframe");
// jsdom gives no window to an iframe inside a shadow root (Chrome does), so stand one in for the panel
Object.defineProperty(frame, "contentWindow", { value: {}, configurable: true });
const panelOrigin = new hw.URL(frame.src).origin;
const toPanel = [];
frame.contentWindow.postMessage = (...a) => toPanel.push(a[0]);
const fromPanel = (data) => hw.dispatchEvent(new hw.MessageEvent("message", { data, origin: panelOrigin, source: frame.contentWindow }));
fromPanel({ type: "capture", id: 7 });
await sleep(250);
check("the host asks the background for the screenshot", sentToBg.some((m) => m.type === "capture"));
check("the panel is hidden while the picture is taken (so it is not in the picture)", visibleDuringCapture === "hidden", String(visibleDuringCapture));
check("and visible again afterwards", host.style.visibility !== "hidden");
check("the panel gets the picture back with the same id", toPanel.some((m) => m.type === "captured" && m.id === 7 && m.ok && m.dataUrl.startsWith("data:image/png")), JSON.stringify(toPanel));
bgAnswer = { ok: false, error: "Click the icon first" };
toPanel.length = 0;
fromPanel({ type: "capture", id: 8 });
await sleep(250);
check("a refused capture is reported, and the panel is restored", toPanel.some((m) => m.type === "captured" && m.id === 8 && !m.ok && /Click the icon/.test(m.error)) && host.style.visibility !== "hidden");
hw.chrome.runtime.sendMessage = (m, cb) => { hw.chrome.runtime.lastError = { message: "Extension context invalidated." }; cb(undefined); hw.chrome.runtime.lastError = undefined; };
toPanel.length = 0;
fromPanel({ type: "capture", id: 9 });
await sleep(250);
check("no answer from the extension -> readable error", toPanel.some((m) => m.id === 9 && !m.ok && /context invalidated/.test(m.error)));
hw.dispatchEvent(new hw.MessageEvent("message", { data: { type: "capture", id: 10 }, origin: "https://evil.example", source: frame.contentWindow }));
await sleep(150);
check("capture requests from other origins are ignored", !toPanel.some((m) => m.id === 10));

fromPanel({ type: "snapshot", auto: false, id: 41 });
await sleep(100);
check("a Snapshot request is answered with the same id (so the panel can match it)", toPanel.some((m) => m.type === "snapshot" && m.id === 41 && m.auto === false), JSON.stringify(toPanel.slice(-2)));
toPanel.length = 0;
fromPanel({ type: "snapshot", auto: true });
await sleep(100);
check("Follow requests carry no id", toPanel.some((m) => m.type === "snapshot" && m.auto === true && m.id === undefined));

// ---------------- 6. manifest sanity ----------------
console.log("6. manifest");
const man = JSON.parse(fs.readFileSync(`${COPY}/manifest.json`, "utf8"));
check("only activeTab/scripting/storage, no blanket host access", JSON.stringify(man.permissions.sort()) === '["activeTab","scripting","storage"]' && !man.host_permissions);
check("the licence server is optional (asked for only when a key is activated), and only the shop in use is listed", JSON.stringify(man.optional_host_permissions) === '["https://api.gumroad.com/*"]');
check("wasm allowed for extension pages", /wasm-unsafe-eval/.test(man.content_security_policy.extension_pages));
const war = man.web_accessible_resources[0].resources.join(" ");
check("only the panel page and the icons are web accessible (pages cannot probe the engine, models or code)", war === "panel.html icons/*", war);
for (const f of ["scanner/core.js", "scanner/engine.js", "scanner/runner.js", "scanner/worker.js", "scanner/client.js", "board-view.js", "editor.js", "scan-flow.js", "crop-ui.js", "engine-client.js", "links.js", "notation.js", "settings.js"]) check(`${f} exists`, fs.existsSync(`${SRC}/${f}`));
for (const f of ["scanner/models/board.onnx", "scanner/models/locator.onnx", "scanner/ort/ort.wasm.min.mjs", "scanner/ort/ort-wasm-simd-threaded.wasm", "scanner/ort/ort-wasm-simd-threaded.mjs"]) check(`${f} is shipped`, fs.existsSync(`${SRC}/${f}`) && fs.statSync(`${SRC}/${f}`).size > 10000);

console.log(fail ? `\n${fail} SCAN CHECK(S) FAILED` : "\nSCAN CHECKS PASSED");
process.exit(fail ? 1 : 0);
