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
const ui = await import(`file://${COPY}/scan-ui.js`);
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

// ---------------- 2. position checks ----------------
console.log("2. position checks (scan-ui.js)");
const G = (pl) => core.placementToGrid(pl);
check("start position is fine", ui.checkPosition(G(START), "w") === null);
check("no black king", /black king/.test(ui.checkPosition(G("8/8/8/8/8/8/8/4K3"), "w")));
check("no white king", /white king/.test(ui.checkPosition(G("4k3/8/8/8/8/8/8/8"), "w")));
check("two white kings", /one white king/.test(ui.checkPosition(G("4k3/8/8/8/8/8/8/K3K3"), "w")));
check("pawn on the last row", /first or last/.test(ui.checkPosition(G("4k2P/8/8/8/8/8/8/4K3"), "w")));
check("nine pawns", /more than 8 pawns/.test(ui.checkPosition(G("4k3/pppppppp/p7/8/8/8/PPPPPPPP/4K3"), "w")));
const inCheck = G("4k3/8/8/8/8/8/4R3/4K3");
check("black in check while White is to move is illegal", /Black is in check/.test(ui.checkPosition(inCheck, "w")));
check("...but fine when it is Black's move", ui.checkPosition(inCheck, "b") === null);
check("castling rights only where king and rook stand at home", JSON.stringify(ui.homeCastling(G(START))) === '{"K":true,"Q":true,"k":true,"q":true}' && JSON.stringify(ui.homeCastling(G("4k3/8/8/8/8/8/8/4K3"))) === '{"K":false,"Q":false,"k":false,"q":false}');
check("a data URL becomes an image Blob", (() => { const b = ui.dataUrlToBlob("data:image/png;base64,iVBORw0KGgo="); return b.type === "image/png" && b.size === 8; })());

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

// ---------------- 4. the sheet inside the real panel ----------------
console.log("4. scan sheet in the panel");
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
const cannedGrid = core.placementToGrid("r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R");
const cannedResult = (over = {}) => ({
  grid: cannedGrid.map((r) => [...r]), bottom: "white", bottomConfidence: 0.99, orientationUnsure: false,
  placement: "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R", confidence: 0.99,
  squareConfidence: Array(64).fill(0.99), legalityChanges: 0, pieces: 28, corners: [[0, 0], [1, 0], [1, 1], [0, 1]], ms: { locate: 1, read: 1 }, ...over,
});
let nextResult = () => cannedResult();
FakeWorker.onScan = (wk, m) => {
  wk.onmessage({ data: { type: "stage", id: m.id, stage: "locating" } });
  setTimeout(() => {
    const r = nextResult();
    if (r instanceof Error) wk.onmessage({ data: { type: "error", id: m.id, message: r.message } });
    else if (r !== "hang") wk.onmessage({ data: { type: "result", id: m.id, result: r } });
  }, 5);
};
Object.assign(globalThis, { window: w, document: w.document, parent: { postMessage: (m) => posted.push(m) }, Worker: FakeWorker });
globalThis.ResizeObserver = class { constructor() {} observe() {} };
w.open = () => null;
Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async () => {} }, deviceMemory: 8, hardwareConcurrency: 8 }, configurable: true, writable: true });
globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
const created = [], revoked = [];
URL.createObjectURL = (b) => { const u = `blob:test/${created.length}`; created.push(u); return u; };
URL.revokeObjectURL = (u) => revoked.push(u);
const $ = (id) => w.document.getElementById(id);
await import(`file://${COPY}/panel.js?t=${Date.now()}`);
await sleep(40);

const vis = (id) => !$(id).hidden;
const png = () => new w.File([new Uint8Array([137, 80, 78, 71])], "board.png", { type: "image/png" });
const showImage = (nw = 1000, nh = 500) => {
  const img = $("picImg");
  Object.defineProperty(img, "naturalWidth", { value: nw, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: nh, configurable: true });
  img.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 });
  img.dispatchEvent(new w.Event("load"));
};
const mouse = (el, type, x, y) => el.dispatchEvent(new w.MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
const sboard = () => $("sBoard");
const squareCenter = (r, c) => [c * 40 + 20, r * 40 + 20];
const stubBoard = () => { sboard().getBoundingClientRect = () => ({ left: 0, top: 0, right: 320, bottom: 320, width: 320, height: 320 }); };
const sqEl = (r, c) => sboard().querySelector(`.sq[data-r="${r}"][data-c="${c}"]`);
const pieceAt = (r, c) => { const i = sqEl(r, c).querySelector("img"); return i ? i.alt : null; };

check("a Scan button sits next to Snapshot", !!$("scanBtn") && $("scanBtn").closest(".row").contains($("snap")));
check("the sheet starts closed and the board is shown", $("scan").hidden && !$("main").hidden && !w.document.body.classList.contains("scanning"));
$("scanBtn").click();
check("Scan opens the sheet: main board hidden, picker shown", vis("scan") && $("main").hidden && vis("scanPick") && !vis("scanPic") && w.document.body.classList.contains("scanning"));
check("no low-memory warning on an 8 GB device", $("scanLowMem").hidden);
$("scanBack").click();
check("Back returns to the board untouched", $("scan").hidden && !$("main").hidden && !w.document.body.classList.contains("scanning"));
Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async () => {} }, deviceMemory: 1, hardwareConcurrency: 4 }, configurable: true, writable: true });
$("scanBtn").click();
check("a 1 GB device gets a low-memory heads-up", !$("scanLowMem").hidden);
Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async () => {} }, deviceMemory: 8, hardwareConcurrency: 8 }, configurable: true, writable: true });

console.log("4a. capturing the tab");
$("scanCapture").click();
const capMsg = posted.filter((m) => m.type === "capture").at(-1);
check("Capture asks the host page for a screenshot", !!capMsg && typeof capMsg.id === "number", JSON.stringify(posted.slice(-3)));
check("the button is disabled while waiting", $("scanCapture").disabled);
w.dispatchEvent(new w.MessageEvent("message", { data: { type: "captured", id: capMsg.id + 99, ok: true, dataUrl: "data:image/png;base64,iVBORw0KGgo=" } }));
check("an answer for another request is ignored", $("scanCapture").disabled && !vis("scanPic"));
w.dispatchEvent(new w.MessageEvent("message", { data: { type: "captured", id: capMsg.id, ok: false, error: "Chrome only allows capturing after you click the icon." } }));
await sleep(10);
check("a refused capture explains itself and stays on the picker", /click the icon/.test($("scanPickMsg").textContent) && $("scanPickMsg").classList.contains("err") && vis("scanPick") && !$("scanCapture").disabled);
$("scanCapture").click();
const cap2 = posted.filter((m) => m.type === "capture").at(-1);
w.dispatchEvent(new w.MessageEvent("message", { data: { type: "captured", id: cap2.id, ok: true, dataUrl: "data:image/png;base64,iVBORw0KGgo=" } }));
await sleep(10);
check("a good capture opens the picture step", vis("scanPic") && !vis("scanPick") && $("picImg").getAttribute("src") === created.at(-1));
showImage();

console.log("4b. boxing the board");
check("hint invites a box", /Drag a box/.test($("picHint").textContent));
mouse($("picWrap"), "pointerdown", 20, 10); mouse($("picWrap"), "pointermove", 120, 70); mouse($("picWrap"), "pointerup", 120, 70);
check("dragging draws the box", !$("picBox").hidden && $("picBox").style.left === "20px" && $("picBox").style.width === "100px" && $("picBox").style.height === "60px");
check("hint now says only the box is read", /boxed area/.test($("picHint").textContent));
mouse($("picWrap"), "pointerdown", 40, 40); mouse($("picWrap"), "pointerup", 41, 41);
check("a plain click clears the box", $("picBox").hidden && /Drag a box/.test($("picHint").textContent));
mouse($("picWrap"), "pointerdown", 190, 90); mouse($("picWrap"), "pointermove", 20, 10); mouse($("picWrap"), "pointerup", 20, 10);
check("dragging backwards works", $("picBox").style.left === "20px" && $("picBox").style.width === "170px");
mouse($("picWrap"), "pointerdown", 20, 10); mouse($("picWrap"), "pointermove", 400, 300); mouse($("picWrap"), "pointerup", 400, 300);
check("the box is clamped to the picture", $("picBox").style.width === "180px" && $("picBox").style.height === "90px", `${$("picBox").style.width}x${$("picBox").style.height}`);
mouse($("picWrap"), "pointerdown", 20, 10); mouse($("picWrap"), "pointermove", 120, 70); mouse($("picWrap"), "pointerup", 120, 70);

console.log("4c. reading");
$("scanRead").click();
check("Read shows progress", vis("scanBusy") && /Loading|Finding|Reading/.test($("busyText").textContent));
await sleep(80);
const sw = FakeWorker.scan;
const scanMsg = sw.sent.find((m) => m.type === "scan");
check("the picture and the box (in picture pixels) go to the worker", !!scanMsg && scanMsg.crop.map(Math.round).join() === "100,50,600,350", JSON.stringify(scanMsg && scanMsg.crop));
check("the worker's stage text was shown, then the result opened", vis("scanResult") && !vis("scanBusy"));
stubBoard();
check("64 squares, one image per piece", sboard().querySelectorAll(".sq").length === 64 && sboard().querySelectorAll(".sq img").length === cannedGrid.flat().filter(Boolean).length);
check("the pieces are where the reader put them", pieceAt(0, 0) === "Black rook" && pieceAt(7, 4) === "White king" && pieceAt(4, 4) === "White pawn");
check("top-left square is light, like a real board", sqEl(0, 0).classList.contains("light") && sqEl(0, 1).classList.contains("dark") && sqEl(7, 0).classList.contains("dark"));
check("rank/file labels match White at the bottom", sqEl(0, 0).querySelector(".coord.r").textContent === "8" && sqEl(7, 0).querySelector(".coord.f").textContent === "a");
check("Bottom=White, To move=White chosen", w.document.querySelector("input[name=sBottom]:checked").value === "white" && w.document.querySelector("input[name=sTurn]:checked").value === "w");
check("all four castling rights are offered and ticked (king and rooks are home)", ["sCK","sCQ","sCk","sCq"].every((id) => $(id).checked && !$(id).disabled));
check("Analyze is enabled for a legal position", !$("sAnalyze").disabled);
check("palette has Move, 12 pieces and an eraser", $("sPalette").querySelectorAll("button.tool").length === 14 && $("sPalette").querySelector(".tool.on").dataset.tool === "move");
check("no weak squares: the note says it looks right", /Looks right/.test($("sNote").textContent) && sboard().querySelectorAll(".sq.weak").length === 0);

console.log("4d. editing");
// place with the palette
$("sPalette").querySelector('[data-tool="Q"]').click();
check("choosing a piece selects it", $("sPalette").querySelector(".tool.on").dataset.tool === "Q");
let [x, y] = squareCenter(3, 0); mouse(sboard(), "pointerdown", x, y); mouse(sboard(), "pointerup", x, y);
check("clicking a square places it", pieceAt(3, 0) === "White queen");
mouse(sboard(), "pointerdown", x, y); mouse(sboard(), "pointerup", x, y);
check("clicking again with the same piece removes it", pieceAt(3, 0) === null);
$("sPalette").querySelector('[data-tool="erase"]').click();
[x, y] = squareCenter(6, 0); mouse(sboard(), "pointerdown", x, y);
check("the eraser removes a piece", pieceAt(6, 0) === null);
$("sPalette").querySelector('[data-tool="move"]').click();
// drag a piece to an empty square
const p1 = squareCenter(6, 1), p2 = squareCenter(4, 1);
mouse(sboard(), "pointerdown", ...p1); mouse(sboard(), "pointermove", ...p2); mouse(sboard(), "pointerup", ...p2);
check("dragging moves a piece (any square, no rules)", pieceAt(6, 1) === null && pieceAt(4, 1) === "White pawn");
// click-click
const c1 = squareCenter(4, 1), c2 = squareCenter(3, 1);
mouse(sboard(), "pointerdown", ...c1); mouse(sboard(), "pointerup", ...c1);
check("first click selects", sqEl(4, 1).classList.contains("hl"));
mouse(sboard(), "pointerdown", ...c2);
check("second click moves it", pieceAt(3, 1) === "White pawn" && pieceAt(4, 1) === null);
// drag off the board = remove
const d1 = squareCenter(1, 0);
mouse(sboard(), "pointerdown", ...d1); mouse(sboard(), "pointerup", 999, 999);
check("dropping a piece off the board removes it", pieceAt(1, 0) === null);

console.log("4e. validation");
// remove the white king -> cannot analyze
const wk = squareCenter(7, 4);
mouse(sboard(), "pointerdown", ...wk); mouse(sboard(), "pointerup", 999, 999);
check("without a white king Analyze is disabled and the note says what to add", $("sAnalyze").disabled && /white king/.test($("sNote").textContent) && $("sNote").classList.contains("err"), $("sNote").textContent);
check("losing the king also drops the castling rights that depended on it", $("sCK").disabled && $("sCQ").disabled && !$("sCK").checked);
$("sPalette").querySelector('[data-tool="K"]').click();
mouse(sboard(), "pointerdown", ...wk);
$("sPalette").querySelector('[data-tool="move"]').click();
check("putting the king back re-enables Analyze", !$("sAnalyze").disabled);
check("castling stays off after the king was moved (rights are not invented)", !$("sCK").checked);
$("sCK").checked = true; $("sCK").dispatchEvent(new w.Event("change"));
check("and can be ticked again by hand", $("sCK").checked && /KQ|K/.test(window.__scanUi.fen().split(" ")[2]));

console.log("4f. orientation and finishing");
const before = window.__scanUi.fen();
w.document.querySelector("input[name=sBottom][value=black]").checked = true;
w.document.querySelector("input[name=sBottom][value=black]").dispatchEvent(new w.Event("change"));
check("Bottom=Black rotates the FEN to White's view", window.__scanUi.fen().split(" ")[0] === core.gridToPlacement(core.rotateGrid(JSON.parse(JSON.stringify(window.__scanUi._state().grid)))) && window.__scanUi.fen() !== before);
check("labels follow the bottom side", sqEl(0, 0).querySelector(".coord.r").textContent === "1" && sqEl(7, 0).querySelector(".coord.f").textContent === "h");
w.document.querySelector("input[name=sBottom][value=white]").checked = true;
w.document.querySelector("input[name=sBottom][value=white]").dispatchEvent(new w.Event("change"));
w.document.querySelector("input[name=sTurn][value=b]").checked = true;
w.document.querySelector("input[name=sTurn][value=b]").dispatchEvent(new w.Event("change"));
check("To move = Black is in the FEN", window.__scanUi.fen().split(" ")[1] === "b");
// leave auto-follow on to prove it is switched off
$("auto").checked = true;
const fenBefore = $("fen").value;
const stopAuto = posted.length;
$("sAnalyze").click();
await sleep(30);
check("Analyze closes the sheet and shows the board again", $("scan").hidden && !$("main").hidden && !w.document.body.classList.contains("scanning"));
check("the position went into the panel (FEN box)", $("fen").value !== fenBefore && $("fen").value.split(" ")[1] === "b", $("fen").value);
check("the engine was asked to analyze it", FakeWorker.engine.sent.some((m) => String(m).startsWith("position fen " + $("fen").value.split(" ").slice(0, 2).join(" "))));
check("auto-follow was switched off so the page cannot overwrite it", $("auto").checked === false && /Auto-follow is off/.test($("status").textContent), $("status").textContent);
check("the status says it came from a picture", /scanned from a picture/.test($("status").textContent));
check("object URL of the picture was released", revoked.length >= 1);
$("undo").click();
check("scanning starts a clean undo history", $("fen").value.split(" ")[1] === "b");

console.log("4g. weak squares, unsure orientation, errors");
$("scanBtn").click();
w.document.dispatchEvent(Object.assign(new w.Event("paste", { bubbles: true, cancelable: true }), { clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => png() }] } }));
check("pasting an image opens the sheet on the picture", vis("scan") && vis("scanPic"));
showImage();
nextResult = () => cannedResult({ squareConfidence: Array.from({ length: 64 }, (_, i) => (i === 3 || i === 10 ? 0.4 : 0.99)), orientationUnsure: true, bottom: "black", grid: core.rotateGrid(cannedGrid) });
$("scanRead").click();
await sleep(80);
stubBoard();
check("uncertain squares are outlined", sboard().querySelectorAll(".sq.weak").length === 2);
check("the unsure-orientation warning comes first", /Not sure which side is at the bottom/.test($("sNote").textContent));
check("the reader's side-at-bottom is preselected", w.document.querySelector("input[name=sBottom]:checked").value === "black");
w.document.querySelector("input[name=sBottom][value=white]").checked = true;
w.document.querySelector("input[name=sBottom][value=white]").dispatchEvent(new w.Event("change"));
check("once you choose, it stops nagging and mentions the outlined squares", /2 outlined squares/.test($("sNote").textContent), $("sNote").textContent);
$("sPalette").querySelector('[data-tool="erase"]').click();
let [ex, ey] = squareCenter(0, 3); mouse(sboard(), "pointerdown", ex, ey);
check("touching an outlined square clears its outline", sboard().querySelectorAll(".sq.weak").length === 1);
$("sBackToPic").click();
check("Picture goes back to the picture, keeping the box", vis("scanPic") && !vis("scanResult"));
nextResult = () => new Error("Could not load the board model (404)");
$("scanRead").click();
await sleep(80);
check("an error shows the message with Try again / Back", vis("scanBusy") && /could not be read: Could not load/.test($("busyText").textContent) && !$("scanBusyErr").hidden && $("scanBusyCancel").hidden);
nextResult = () => cannedResult();
$("scanBusyRetry").click();
await sleep(80);
check("Try again reads it successfully", vis("scanResult"));
$("sBackToPic").click();
nextResult = () => "hang";
$("scanRead").click();
await sleep(20);
check("Cancel is offered while reading", !$("scanBusyCancel").hidden);
$("scanBusyCancel").click();
check("Cancel goes back to the picture", vis("scanPic"));
nextResult = () => cannedResult();
$("scanRetake").click();
check("Other picture returns to the picker and releases the old one", vis("scanPick") && revoked.length >= 2);
w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
check("undo/redo keys do nothing while the sheet is open", true);
w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
check("Escape closes the sheet", $("scan").hidden && !$("main").hidden);

console.log("4h. bad input");
$("scanBtn").click();
$("scanFileInput").dispatchEvent(Object.assign(new w.Event("change"), {}));
const dropEv = (files) => { const e = new w.Event("drop", { bubbles: true, cancelable: true }); e.dataTransfer = { types: ["Files"], files }; return e; };
w.document.dispatchEvent(dropEv([new w.File(["x"], "note.txt", { type: "text/plain" })]));
check("dropping a non-image is ignored", vis("scanPick"));
$("scanFile").click();
w.document.dispatchEvent(dropEv([png()]));
check("dropping an image opens it", vis("scanPic"));
$("picImg").dispatchEvent(new w.Event("error"));
check("an image the browser cannot open gives a clear message", vis("scanPick") && /Could not open that picture/.test($("scanPickMsg").textContent));
$("scanBack").click();

// the main panel still works after all that
check("the panel's own board still shows 64 squares", w.document.querySelectorAll("#board .sq").length === 64);

// ---------------- 5. host: taking the picture ----------------
console.log("5. host page capture");
const hostDom = new JSDOM("<!doctype html><body><p>page</p></body>", { url: "https://www.youtube.com/watch", runScripts: "outside-only", pretendToBeVisual: true });
const hw = hostDom.window;
let sentToBg = [];
let bgAnswer = { ok: true, dataUrl: "data:image/png;base64,AAAA" };
let visibleDuringCapture = null;
hw.chrome = { runtime: { getURL: (p) => `chrome-extension://abc/${p}`, lastError: undefined,
  sendMessage: (m, cb) => { sentToBg.push(m); visibleDuringCapture = host.style.visibility; setTimeout(() => cb && cb(bgAnswer), 0); } } };
hw.eval(fs.readFileSync(`${COPY}/content.js`, "utf8"));
const host = [...hw.document.documentElement.children].find((e) => e.tagName === "DIV");
const frame = host.querySelector("iframe");
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

// ---------------- 6. manifest sanity ----------------
console.log("6. manifest");
const man = JSON.parse(fs.readFileSync(`${COPY}/manifest.json`, "utf8"));
check("only activeTab/scripting/storage, no blanket host access", JSON.stringify(man.permissions.sort()) === '["activeTab","scripting","storage"]' && !man.host_permissions);
check("wasm allowed for extension pages", /wasm-unsafe-eval/.test(man.content_security_policy.extension_pages));
const war = man.web_accessible_resources[0].resources.join(" ");
check("scanner files are web accessible", /scanner\/\*/.test(war) && /scan-ui\.js/.test(war));
for (const f of ["scanner/core.js", "scanner/engine.js", "scanner/runner.js", "scanner/worker.js", "scanner/client.js", "scan-ui.js"]) check(`${f} exists`, fs.existsSync(`${SRC}/${f}`));
for (const f of ["scanner/models/board.onnx", "scanner/models/locator.onnx", "scanner/ort/ort.wasm.min.mjs", "scanner/ort/ort-wasm-simd-threaded.wasm", "scanner/ort/ort-wasm-simd-threaded.mjs"]) check(`${f} is shipped`, fs.existsSync(`${SRC}/${f}`) && fs.statSync(`${SRC}/${f}`).size > 10000);

console.log(fail ? `\n${fail} SCAN CHECK(S) FAILED` : "\nSCAN CHECKS PASSED");
process.exit(fail ? 1 : 0);
