// Fair play (the lock during live games), Free vs Premium (licence keys, daily scans, gated features) and
// Follow on a video. Offline: jsdom pages, a fake scanner and a fake licence server.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { Chess } from "../lib/chess.js";
import { REGION } from "../video-track.js";
import { TRUE_BOX, frame as thumbOf, loadSet } from "./synth.mjs";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (n, c, x = "") => { console.log(`  ${c ? "✓" : "✗"} ${n} ${c ? "" : x}`); if (!c) fail++; };
const waitFor = async (fn, ms = 2000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(10); } return false; };

// ---------------- 1. fair play rules (fairplay.js) ----------------
console.log("1. fair play: which pages lock Pawnshot");
const fpCode = fs.readFileSync(`${SRC}/fairplay.js`, "utf8");
function fp(url, body = "") {
  const d = new JSDOM(`<!doctype html><body>${body}</body>`, { url, runScripts: "outside-only" });
  d.window.eval(fpCode);
  return d.window.__pawnshotFairPlay.check(d.window.location, d.window.document);
}
check("chess.com live game page is locked", fp("https://www.chess.com/game/live/123456", '<div class="clock-component clock-running"></div>').locked);
check("chess.com play page with no sign of the game being over is locked (fails closed)", fp("https://www.chess.com/play/online").locked);
check("chess.com bots and daily games are locked too", fp("https://www.chess.com/play/computer").locked && fp("https://www.chess.com/game/daily/987").locked);
check("chess.com finished game (result shown, no clock running) is open", !fp("https://www.chess.com/game/live/123456", '<div class="game-over-modal-content">You won</div>').locked);
check("a running clock wins over an old game-over dialog", fp("https://www.chess.com/game/live/2", '<div class="game-over-modal-content"></div><div class="clock-component clock-player-turn"></div>').locked);
check("chess.com rated puzzles and Puzzle Rush are locked", fp("https://www.chess.com/puzzles/rated").locked && fp("https://www.chess.com/puzzles/rush").kind === "puzzle");
check("chess.com analysis, game review, lessons, articles and the archive are open",
  ["https://www.chess.com/analysis", "https://www.chess.com/analysis/game/live/123?tab=review", "https://www.chess.com/lessons/x", "https://www.chess.com/article/view/x", "https://www.chess.com/games/archive"].every((u) => !fp(u).locked));
check("chesskid.com follows the same rules", fp("https://www.chesskid.com/play").locked && !fp("https://www.chesskid.com/analysis").locked);
check("lichess game in progress (clock running) is locked", fp("https://lichess.org/abcdEFGH", '<main class="round"><div class="rclock running"></div></main>').locked);
check("lichess game page with resign buttons is locked", fp("https://lichess.org/abcdEFGH1234", '<main class="round"><div class="rcontrols"><div class="ricons"></div></div></main>').locked);
check("lichess finished game is open", !fp("https://lichess.org/abcdEFGH", '<main class="round"><div class="result-wrap"><p class="result">1-0</p></div></main>').locked);
check("lichess game view without a clear result stays locked", fp("https://lichess.org/abcdEFGH", '<main class="round"></main>').locked);
check("lichess analysis, studies and broadcasts are open", !fp("https://lichess.org/analysis", '<main class="analyse"><cg-board></cg-board></main>').locked && !fp("https://lichess.org/study/x", '<main class="analyse"></main>').locked);
check("lichess puzzles, Streak, Storm and Racer are locked", ["https://lichess.org/training", "https://lichess.org/training/abc", "https://lichess.org/streak", "https://lichess.org/storm", "https://lichess.org/racer/x"].every((u) => fp(u).locked));
check("lichess-based sites are recognised by their page structure", fp("https://playstrategy.org/xyz", '<main class="round"><cg-board></cg-board><div class="rclock running"></div></main>').locked);
check("YouTube and other sites are never locked", !fp("https://www.youtube.com/watch?v=x").locked && !fp("https://example.com/").locked);
check("the reason is explained in plain words", /game is being played/.test(fp("https://www.chess.com/play/online").reason) && /puzzles/.test(fp("https://lichess.org/training").reason));

// ---------------- 2. licences (license.js) ----------------
console.log("2. licence keys");
const L = await import(`file://${SRC}/license.js`);
const LS_CONF = { provider: "lemonsqueezy", lemonsqueezy: { storeId: 42, productIds: [7] }, gumroad: { productId: "" }, maxActivations: 3 };
const GR_CONF = { provider: "gumroad", lemonsqueezy: { storeId: 0, productIds: [] }, gumroad: { productId: "prod_1" }, maxActivations: 3 };
const calls = [];
const fakeFetch = (handler) => async (url, init) => { const body = Object.fromEntries(new URLSearchParams(init.body)); calls.push({ url, body }); const [status, data] = handler(url, body); return { status, json: async () => data }; };
const NOW = 1_800_000_000_000;
const DAY = 24 * 3600 * 1000;

let r = await L.activateKey("ABCD-1234-EFGH", { config: LS_CONF, now: NOW, fetchFn: fakeFetch((u) => [200, { activated: true, instance: { id: "inst1" }, meta: { store_id: 42, product_id: 7, customer_email: "a@b.c" } }]) });
check("Lemon Squeezy: a key from our store activates", r.ok && r.record.status === "active" && r.record.instanceId === "inst1" && r.record.provider === "lemonsqueezy" && r.record.email === "a@b.c", JSON.stringify(r));
check("the activation call sends only the key and a browser label", calls.at(-1).url.endsWith("/v1/licenses/activate") && Object.keys(calls.at(-1).body).sort().join() === "instance_name,license_key");
calls.length = 0;
r = await L.activateKey("ABCD-1234-EFGH", { config: LS_CONF, now: NOW, fetchFn: fakeFetch((u) => [200, u.endsWith("activate") ? { activated: true, instance: { id: "x" }, meta: { store_id: 99, product_id: 7 } } : { deactivated: true }]) });
check("a key sold by another Lemon Squeezy store is refused, and its slot given back", !r.ok && /different product/.test(r.message) && calls.some((c) => c.url.endsWith("/deactivate")), JSON.stringify(r));
r = await L.activateKey("ABCD-1234-EFGH", { config: LS_CONF, now: NOW, fetchFn: fakeFetch(() => [400, { activated: false, error: "license_key not found." }]) });
check("an unknown key shows the shop's message", !r.ok && /not found/.test(r.message));
r = await L.activateKey("ABCD-1234-EFGH", { config: LS_CONF, now: NOW, fetchFn: async () => { throw new TypeError("Failed to fetch"); } });
check("offline: a clear message, nothing stored", !r.ok && /reach the license server/.test(r.message));
check("a too-short key is refused without asking the server", !(await L.activateKey("abc", { config: LS_CONF })).ok);
check("nothing is on sale while the provider is 'none'", /not on sale/.test((await L.activateKey("ABCD-1234-EFGH", { config: { ...LS_CONF, provider: "none" } })).message));

r = await L.activateKey("GUM-KEY-1234", { config: GR_CONF, now: NOW, fetchFn: fakeFetch(() => [200, { success: true, uses: 1, purchase: { email: "g@h.i" } }]) });
check("Gumroad: a good key activates (and counts one use)", r.ok && r.record.provider === "gumroad" && calls.at(-1).body.increment_uses_count === "true" && calls.at(-1).body.product_id === "prod_1");
r = await L.activateKey("GUM-KEY-1234", { config: GR_CONF, now: NOW, fetchFn: fakeFetch(() => [200, { success: true, uses: 1, purchase: { refunded: true } }]) });
check("a refunded Gumroad purchase is refused", !r.ok && /refunded/.test(r.message));
r = await L.activateKey("GUM-KEY-1234", { config: GR_CONF, now: NOW, fetchFn: fakeFetch(() => [200, { success: true, uses: 4, purchase: {} }]) });
check("a Gumroad key already used on 3 browsers is refused", !r.ok && /3 browsers/.test(r.message));

const rec = { key: "ABCD-1234-EFGH", provider: "lemonsqueezy", instanceId: "inst1", status: "active", checkedAt: NOW, okAt: NOW };
check("an active key is Premium", L.isPremium(rec, { now: NOW + DAY, config: LS_CONF }));
check("offline for 3 weeks: still Premium (grace period)", L.isPremium(rec, { now: NOW + 21 * DAY, config: LS_CONF }));
check("after 30 days without a successful check it lapses", !L.isPremium(rec, { now: NOW + 31 * DAY, config: LS_CONF }));
check("a key for a different provider than the one configured does not count", !L.isPremium(rec, { now: NOW, config: GR_CONF }));
check("the developer switch counts only in an unpacked copy", L.isPremium({ status: "dev" }, { unpacked: true }) && !L.isPremium({ status: "dev" }, { unpacked: false }));
check("checked again after a week, not before", !L.needsCheck(rec, NOW + 6 * DAY) && L.needsCheck(rec, NOW + 8 * DAY));
let next = await L.revalidate(rec, { config: LS_CONF, now: NOW + 8 * DAY, fetchFn: fakeFetch(() => [200, { valid: true, meta: { store_id: 42, product_id: 7 } }]) });
check("weekly check OK: the grace clock restarts", next.status === "active" && next.okAt === NOW + 8 * DAY);
next = await L.revalidate(rec, { config: LS_CONF, now: NOW + 8 * DAY, fetchFn: fakeFetch(() => [200, { valid: false, error: "license_key has been disabled." }]) });
check("a disabled or refunded key turns Premium off, with the reason", next.status === "invalid" && /disabled/.test(next.message) && !L.isPremium(next, { config: LS_CONF, now: NOW + 8 * DAY }));
next = await L.revalidate(rec, { config: LS_CONF, now: NOW + 8 * DAY, fetchFn: async () => { throw new TypeError("offline"); } });
check("offline during the weekly check: nothing changes except the time of the attempt", next.status === "active" && next.okAt === NOW && next.checkedAt === NOW + 8 * DAY);
next = await L.revalidate(rec, { config: LS_CONF, now: NOW + 8 * DAY, fetchFn: fakeFetch(() => [503, {}]) });
check("server trouble (5xx) is treated like being offline", next.status === "active");

// ---------------- 3. the panel: lock, limits, Premium, Follow on a video ----------------
console.log("3. panel");
const core = await import(`file://${SRC}/scanner/core.js`);
const html = fs.readFileSync(`${SRC}/panel.html`, "utf8").replace(/<script[^>]*><\/script>/, "").replace(/<link[^>]*>/, "");
const dom = new JSDOM(html, { url: "chrome-extension://abc/panel.html", pretendToBeVisual: true });
const w = dom.window;
const posted = [];
class FakeWorker {
  constructor(url) {
    this.url = String(url); this.sent = [];
    this.kind = /scanner\/worker\.js$/.test(this.url) ? "scan" : "engine";
    if (this.kind === "scan") { FakeWorker.scan = this; setTimeout(() => this.onmessage && this.onmessage({ data: { type: "ready" } }), 0); }
    else FakeWorker.engine = this;
  }
  postMessage(m) {
    this.sent.push(m);
    if (this.kind === "engine") queueMicrotask(() => { if (m === "uci") this.onmessage({ data: "uciok" }); if (m === "isready") this.onmessage({ data: "readyok" }); });
    else if (m && m.type === "scan") setTimeout(() => { const res = nextResult(m); this.onmessage({ data: { type: "result", id: m.id, result: res } }); }, 5);
  }
  terminate() {}
}
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR";
const AFTER_E5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR";
const read = (placement, over = {}) => ({
  grid: core.placementToGrid(placement), bottom: "white", bottomConfidence: 0.99, orientationUnsure: false, placement,
  confidence: 0.99, squareConfidence: Array(64).fill(0.99), legalityChanges: 0, pieces: placement.replace(/[^a-z]/gi, "").length,
  corners: [[320, 90], [960, 90], [960, 630], [320, 630]], imageSize: [1280, 720], ms: { locate: 1, read: 1 }, ...over,
});
let nextResult = () => read(START);
const store = {};
const listeners = [];
let manifest = { version: "2.0.0", update_url: "https://clients2.google.com/service/update2/crx" }; // a store install
const sentToBg = [];
globalThis.chrome = {
  runtime: { getManifest: () => manifest, sendMessage: (m) => sentToBg.push(m) },
  storage: { local: { get: async (k) => (k in store ? { [k]: store[k] } : {}), set: async (o) => Object.assign(store, o), remove: async (k) => { delete store[k]; } }, onChanged: { addListener: (fn) => listeners.push(fn) } },
};
const storageChange = (o) => { Object.assign(store, o); const ch = {}; for (const [k, v] of Object.entries(o)) ch[k] = { newValue: v }; listeners.forEach((fn) => fn(ch, "local")); };
Object.assign(globalThis, { window: w, document: w.document, parent: { postMessage: (m) => posted.push(m) }, Worker: FakeWorker });
globalThis.ResizeObserver = class { observe() {} };
Object.defineProperty(globalThis, "navigator", { value: { deviceMemory: 8, hardwareConcurrency: 8, clipboard: { writeText: async () => {} } }, configurable: true, writable: true });
w.open = () => null;
const $ = (id) => w.document.getElementById(id);
const reply = (data) => w.dispatchEvent(new w.MessageEvent("message", { data }));
const last = (type) => posted.filter((m) => m.type === type).at(-1);
const count = (type) => posted.filter((m) => m.type === type).length;
const fenNow = () => $("fen").value;
const idle = () => !$("snap").classList.contains("busy");
const blob = () => new w.Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" });
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();

await import(`file://${SRC}/panel.js?t=${Date.now()}`);
await sleep(60);
check("the panel says hello so the host tells it about the page", posted.some((m) => m.type === "hello"));
check("free plan by default, with today's free minutes of Follow video shown", /Free · 10 min of Follow video left today/.test($("planText").textContent) && !$("planBtn").hidden, $("planText").textContent);

console.log("3a. fair play lock");
const stopsBefore = FakeWorker.engine.sent.filter((m) => m === "stop").length;
FakeWorker.engine.onmessage({ data: "info depth 12 multipv 1 score cp 40 pv e2e4 e7e5" });
await sleep(40);
check("(analysis was showing)", $("bestMove").textContent === "e4");
reply({ type: "page", site: "chesscom", locked: true, kind: "game", reason: "A game is being played on this tab, so Pawnshot is off until it ends.", board: true, video: false });
await sleep(20);
check("a live game locks the panel: lock card with the reason", w.document.body.classList.contains("locked") && !$("lock").hidden && /game is being played/.test($("lockText").textContent) && $("lockTitle").textContent === "Game in progress");
check("the engine stops and no best move, arrow or line is left on screen", FakeWorker.engine.sent.filter((m) => m === "stop").length > stopsBefore && $("bestMove").textContent === "—" && $("arrows").innerHTML === "" && $("lines").innerHTML === "");
check("every way to read or analyse is disabled", ["snap", "editBtn", "pictureBtn", "auto", "fen", "go", "undo", "redo"].every((id) => $(id).disabled));
check("the minimized pill says it is off, not a move", last("summary").text === "Off during the game");
const asksBefore = count("snapshot") + count("capture") + count("videoFrame");
$("snap").onclick({});
await sleep(20);
check("Snapshot does nothing while locked (no read is even asked for)", count("snapshot") + count("capture") + count("videoFrame") === asksBefore);
$("auto").checked = true; $("auto").onchange();
check("Follow cannot be switched on", !$("auto").checked);
const posBefore = fenNow();
$("board").getBoundingClientRect = () => ({ left: 0, top: 0, right: 320, bottom: 320, width: 320, height: 320 });
$("board").setPointerCapture = () => {};
$("board").dispatchEvent(new w.MouseEvent("pointerdown", { clientX: 180, clientY: 260, button: 0, bubbles: true }));
$("board").dispatchEvent(new w.MouseEvent("pointerup", { clientX: 180, clientY: 180, button: 0, bubbles: true }));
check("no moves can be tried on the board either", fenNow() === posBefore);
const posCount = FakeWorker.engine.sent.filter((m) => String(m).startsWith("position")).length;
reply({ type: "page", site: "chesscom", locked: false, board: true, video: false });
await sleep(30);
check("when the game ends the panel unlocks by itself and says so", !w.document.body.classList.contains("locked") && $("lock").hidden && /game is over/.test($("status").textContent) && !$("snap").disabled);
check("and analysis resumes", FakeWorker.engine.sent.filter((m) => String(m).startsWith("position")).length > posCount);
$("snap").onclick({});
await sleep(10);
reply({ type: "snapshot", id: last("snapshot").id, fen: null, locked: true, reason: "A game is being played on this tab." });
await sleep(20);
check("a refused read (the host found a live game) locks the panel too", w.document.body.classList.contains("locked") && idle());
reply({ type: "page", site: null, locked: false, board: false, video: false });
await sleep(20);

console.log("3b. free plan limits");
store.scanQuota = { day: today, used: 500 };
const capsBefore = count("capture");
$("snap").onclick({ shiftKey: true });
await waitFor(() => count("capture") === capsBefore + 1);
check("picture scans are unlimited on the free plan (like other scanners; they cost nothing, it all runs here)", count("capture") === capsBefore + 1 && !w.document.body.classList.contains("upsell"));
nextResult = () => read(START);
reply({ type: "captured", id: last("capture").id, ok: true, dataUrl: "data:image/png;base64,iVBORw0KGgo=" });
await waitFor(idle);
await sleep(20);
check("and the plan line does not count them", /Free · 10 min of Follow video left today/.test($("planText").textContent), $("planText").textContent);
const plan = await import(`file://${SRC}/plan.js`);
store.followQuota = { day: today, used: 0 };
check("the free plan follows videos for 10 minutes a day", (await plan.followLeft(false)) === 600000);
check("time spent following is counted and kept", (await plan.useFollow(false, 90000)) === 510000 && store.followQuota.used === 90000);
check("Premium follows without a limit", (await plan.followLeft(true)) === Infinity);
store.followQuota = { day: "2001-01-01", used: 600000 };
check("a new day brings the free minutes back", (await plan.followLeft(false)) === 600000);
$("multipv").value = "5"; $("multipv").onchange();
check("5 lines on the free plan: back to 3, and Premium is explained", $("multipv").value === "3" && w.document.body.classList.contains("upsell") && /depth 20 with 3 lines/.test($("upsellWhy").textContent));
$("upsellClose").click();
$("depthMax").value = "26"; $("depthMax").onchange();
check("depth 26 on the free plan: capped at 20", $("depthMax").value === "20" && w.document.body.classList.contains("upsell"));
w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
check("Esc closes the Premium sheet", !w.document.body.classList.contains("upsell"));
check("the engine never searches past the free limits", FakeWorker.engine.sent.filter((m) => /^go depth/.test(String(m))).every((m) => +String(m).split(" ")[2] <= 20) && FakeWorker.engine.sent.filter((m) => /MultiPV/.test(String(m))).every((m) => +String(m).split(" ").at(-1) <= 3));
reply({ type: "page", site: null, locked: false, board: false, video: true });
await sleep(10);
check("on a video page the Follow chip offers to follow the video (★ = Premium)", $("followLabel").textContent === "Follow video ★");
store.followQuota = { day: today, used: 600000 };
$("auto").checked = true; $("auto").onchange();
await waitFor(() => w.document.body.classList.contains("upsell"));
check("when today's free minutes are used, Follow video opens the Premium sheet instead", !$("auto").checked && w.document.body.classList.contains("upsell") && /today's 10 free minutes/.test($("upsellWhy").textContent), $("upsellWhy").textContent);
$("upsellClose").click();
store.followQuota = { day: today, used: 0 };
const vfFree = count("videoFrame");
$("auto").checked = true; $("auto").onchange();
await waitFor(() => count("videoFrame") > vfFree);
check("with minutes left, the free plan follows the video (it starts by reading the frame)", count("videoFrame") === vfFree + 1 && !w.document.body.classList.contains("upsell"));
reply({ type: "videoFrame", id: last("videoFrame").id, ok: false, error: "No video" });
await sleep(30);
check("(no board there: it stops and says so)", !$("auto").checked && /No chess board found/.test($("noteText").textContent));
$("planBtn").click();
$("upsellGo").click();
check("Get Premium opens the options page at the Premium section", sentToBg.some((m) => m.type === "openOptions" && m.section === "premium") && !w.document.body.classList.contains("upsell"));
$("settingsBtn").click();
check("the gear opens the settings page", sentToBg.filter((m) => m.type === "openOptions").length === 2);

console.log("3c. Premium");
storageChange({ license: { status: "dev" } });
await sleep(30);
check("a developer licence does nothing in a store install", !/Premium/.test($("planText").textContent));
manifest = { version: "2.0.0" }; // unpacked copy
storageChange({ license: { status: "dev" } });
await sleep(30);
check("in an unpacked copy it turns Premium on, live", $("planText").textContent === "★ Premium" && $("planBtn").hidden && $("followLabel").textContent === "Follow video");
check("Premium lifts the depth cap to 30 and allows 5 lines", $("depthMax").max === "30" && (() => { $("multipv").value = "5"; $("multipv").onchange(); return $("multipv").value === "5" && !w.document.body.classList.contains("upsell"); })());
storageChange({ boardTheme: "purple" });
check("Premium board colours apply", w.document.documentElement.style.getPropertyValue("--sq-dark") === "#8d78b5");

console.log("3d. Follow a video");
nextResult = () => read(START);
$("auto").checked = true; $("auto").onchange();
await waitFor(() => count("videoFrame") > 0);
check("Follow video first reads the current frame of the video", !!last("videoFrame") && typeof last("videoFrame").id === "number");
reply({ type: "videoFrame", id: last("videoFrame").id, ok: true, blob: blob(), size: [1280, 720] });
await waitFor(() => count("followStart") > 0);
const start = last("followStart");
check("then tells the host where the board is in the video (fractions of the frame)", start && start.board.map((v) => v.toFixed(3)).join() === "0.250,0.125,0.750,0.875", JSON.stringify(start));
check("the position from the video is on the board and Follow stays on", fenNow().startsWith(START + " w") && $("auto").checked);
check("a note offers Edit, but not a second Follow button", !$("scanNote").hidden && ![...$("noteActions").children].some((b) => /Follow/.test(b.textContent)));
const scans = () => FakeWorker.scan.sent.filter((m) => m.type === "scan");
nextResult = () => read(AFTER_E4);
const doneBefore = count("followDone");
reply({ type: "followFrame", blob: blob(), size: [600, 600], box: [0.05, 0.05, 0.95, 0.95] });
await waitFor(() => count("followDone") > doneBefore);
await sleep(20);
check("a changed frame is read with the board's known place (no searching: faster)", JSON.stringify(scans().at(-1).opts.box) === "[30,30,570,570]", JSON.stringify(scans().at(-1).opts));
check("one legal move away: the move is played, so the turn is right", fenNow().startsWith(AFTER_E4 + " b") && /video: e4/.test($("status").textContent), fenNow() + " | " + $("status").textContent);
check("the move is highlighted like a move on the panel", [...w.document.querySelectorAll("#board .sq.last")].map((e) => e.dataset.sq).sort().join() === "e2,e4");
check("after a sharp read the host is told how long the computer should rest (half the read time)", typeof last("followDone").gap === "number" && last("followDone").gap >= 0 && last("followDone").gap <= 2000);
nextResult = () => read(AFTER_E5);
reply({ type: "followFrame", blob: blob(), size: [600, 600], box: [0.05, 0.05, 0.95, 0.95] });
await waitFor(() => fenNow().startsWith(AFTER_E5));
check("and the next one", fenNow().startsWith(AFTER_E5 + " w"));
nextResult = () => read(AFTER_E5);
const fenSame = fenNow();
reply({ type: "followFrame", blob: blob(), size: [600, 600], box: [0.05, 0.05, 0.95, 0.95] });
await sleep(60);
check("a frame that changed but shows the same position (an arrow drawn, a highlight) changes nothing", fenNow() === fenSame);
$("undo").click();
check("← steps back through the moves the video played", fenNow().startsWith(AFTER_E4 + " b"));
$("redo").click();
nextResult = () => read("8/8/8/8/8/8/8/8", { pieces: 0, confidence: 0.3 });
const vfBefore = count("videoFrame");
for (let i = 0; i < 3; i++) { reply({ type: "followFrame", blob: blob(), size: [600, 600], box: [0.05, 0.05, 0.95, 0.95] }); await sleep(40); }
await waitFor(() => count("videoFrame") > vfBefore);
check("after three bad reads it looks for the board in the whole frame again", count("videoFrame") === vfBefore + 1);
nextResult = () => read(AFTER_E5, { corners: [[100, 100], [500, 100], [500, 500], [100, 500]] });
const startsBefore = count("followStart");
reply({ type: "videoFrame", id: last("videoFrame").id, ok: true, blob: blob(), size: [1280, 720] });
await waitFor(() => count("followStart") > startsBefore);
check("and follows the board at its new place", last("followStart").board.map((v) => v.toFixed(3)).join() === "0.078,0.139,0.391,0.694", JSON.stringify(last("followStart")));
check("the position did not jump on a bad read", fenNow().startsWith(AFTER_E5));

console.log("3e. Follow a video, the quick way (a thumbnail instead of a sharp read)");
{
  const set = loadSet("P1_start__A_cburnett_brown.png");
  const BOX = [TRUE_BOX.x / REGION, TRUE_BOX.y / REGION, (TRUE_BOX.x + TRUE_BOX.w) / REGION, (TRUE_BOX.y + TRUE_BOX.h) / REGION];
  const g = new Chess(fenNow());
  const pl = () => g.fen().split(" ")[0];
  const tiles = (opts = {}) => ({ type: "followTiles", seq: 1, px: thumbOf(set, pl(), opts), size: REGION });
  const sharp = (opts = {}) => ({ type: "followFrame", blob: blob(), size: [600, 600], box: BOX, px: thumbOf(set, pl(), opts), pxSize: REGION });
  // a sharp read gives the panel the thumbnail of a known position to compare with
  nextResult = () => read(pl());
  const d0 = count("followDone");
  reply(sharp({ seed: 1 }));
  await waitFor(() => count("followDone") > d0);
  await sleep(20);
  const T = w.__panel.track;
  check("a sharp read leaves the panel a thumbnail of the known position, with the board lined up in it", !!T.ref && !!T.box && Math.abs(T.box.x - TRUE_BOX.x) <= 2 && Math.abs(T.box.w - TRUE_BOX.w) <= 2, JSON.stringify(T.box));
  const scansAt = scans().length, grabsAt = count("followGrab");
  let m = g.move("Nf3");
  const t0 = performance.now();
  reply(tiles({ highlight: [m.from, m.to], seed: 2 }));
  const ms = performance.now() - t0;
  check(`a move in the thumbnail is played at once, without the neural reader (${ms.toFixed(0)} ms)`, fenNow().startsWith(pl() + " b") && /video: Nf3/.test($("status").textContent) && scans().length === scansAt && count("followGrab") === grabsAt, fenNow() + " | " + $("status").textContent);
  const g1 = count("followGrab");
  reply(tiles({ highlight: [m.from, m.to], arrows: [["c7", "c5"]], seed: 3 }));
  await sleep(10);
  check("an arrow drawn over the board changes nothing (at most a sharp look is asked for)", fenNow().startsWith(pl() + " b") && count("followGrab") <= g1 + 1);
  if (count("followGrab") > g1) { // answer it: by then the arrow is gone, the reader sees the same position
    nextResult = () => read(pl());
    const dd = count("followDone");
    reply(sharp({ highlight: [m.from, m.to], seed: 3 }));
    await waitFor(() => count("followDone") > dd);
    await sleep(20);
  }
  m = g.move("Nc6");
  const afterNc6 = pl();
  const m2 = g.move("Bb5");
  reply(tiles({ highlight: [m2.from, m2.to], seed: 4 }));
  check("two moves between two looks are both played, in order", fenNow().startsWith(pl() + " b") && /video: Nc6 Bb5/.test($("status").textContent), $("status").textContent);
  $("undo").click();
  check("and ← steps back through each of them", fenNow().startsWith(afterNc6 + " w"), fenNow());
  const beforeA6 = g.fen();
  m = g.move("a6");
  reply(tiles({ highlight: [m.from, m.to], seed: 5 }));
  check("while you look back, a new move from the video does not move the board", !fenNow().startsWith(pl()) && /Press → to catch up/.test($("status").textContent), $("status").textContent);
  $("redo").click();
  $("redo").click();
  check("→ then reaches the moves the video played meanwhile", fenNow().startsWith(pl() + " w"), fenNow());
  // in the next quiet moment the reader checks the quick look
  const grabs = count("followGrab");
  await waitFor(() => count("followGrab") > grabs, 4000);
  check("after a quiet moment the panel asks for one sharp picture to make sure (later while the checks keep agreeing)", count("followGrab") === grabs + 1 && w.__panel.track.trust === 1, String(w.__panel.track.trust));
  // the reader sees something else than the quick look thought: the quick moves are taken back and replaced
  const wrong = new Chess(beforeA6); wrong.move("a5"); // the video really played ...a5, not ...a6
  nextResult = () => read(wrong.fen().split(" ")[0]);
  const d1 = count("followDone");
  reply({ type: "followFrame", blob: blob(), size: [600, 600], box: BOX, px: thumbOf(set, wrong.fen().split(" ")[0], { seed: 6 }), pxSize: REGION });
  await waitFor(() => count("followDone") > d1);
  await sleep(20);
  check("a quick move the reader does not confirm is corrected (…a6 becomes …a5)", fenNow().startsWith(wrong.fen().split(" ")[0] + " w") && /a5/.test($("status").textContent), fenNow() + " | " + $("status").textContent);
  $("undo").click();
  check("and the move list has the right move: one step back is the position before it", fenNow().startsWith(beforeA6.split(" ")[0] + " b"), fenNow());
  $("redo").click();
  g.load(wrong.fen());
  // something the quick look cannot explain goes to the reader
  const grabs2 = count("followGrab");
  const other = new Chess(); for (const x of ["d4", "d5", "c4"]) other.move(x);
  reply({ type: "followTiles", seq: 9, px: thumbOf(set, other.fen().split(" ")[0], { seed: 7 }), size: REGION });
  check("a picture the quick look cannot explain (a cut to another game) asks for a sharp read", count("followGrab") === grabs2 + 1);
  nextResult = () => read(other.fen().split(" ")[0]);
  const d2 = count("followDone");
  reply({ type: "followFrame", blob: blob(), size: [600, 600], box: BOX, px: thumbOf(set, other.fen().split(" ")[0], { seed: 8 }), pxSize: REGION });
  await waitFor(() => count("followDone") > d2);
  await sleep(20);
  check("and the reader's position is taken as a new start", fenNow().startsWith(other.fen().split(" ")[0]), fenNow());
  // the video steps back a move: the board steps back too, instead of 'playing' the piece back
  const back = new Chess(other.fen()); back.undo();
  nextResult = () => read(back.fen().split(" ")[0]);
  const d3 = count("followDone");
  reply({ type: "followFrame", blob: blob(), size: [600, 600], box: BOX, px: thumbOf(set, back.fen().split(" ")[0], { seed: 9 }), pxSize: REGION });
  await waitFor(() => count("followDone") > d3);
  await sleep(20);
  check("when the video goes back a move, so does the board (→ goes forward again)", /video: back/.test($("status").textContent) || fenNow().startsWith(back.fen().split(" ")[0]), $("status").textContent + " " + fenNow());
}

reply({ type: "followError", error: "This video does not let other programs read its picture." });
await sleep(10);
check("a video that forbids reading stops Follow with an explanation", !$("auto").checked && /does not let/.test($("noteText").textContent) && last("followStop"));
$("auto").checked = true; $("auto").onchange();
await sleep(10);
const stopsAt = count("followStop");
const board = $("board");
board.dispatchEvent(new w.MouseEvent("pointerdown", { clientX: 20 + 6 * 40, clientY: 20 + 7 * 40, button: 0, bubbles: true })); // g1
board.dispatchEvent(new w.MouseEvent("pointerup", { clientX: 20 + 5 * 40, clientY: 20 + 5 * 40, button: 0, bubbles: true })); // f3
check("playing your own move stops Follow so the video does not overwrite it", !$("auto").checked && count("followStop") === stopsAt + 1 && /Follow paused/.test($("status").textContent), $("status").textContent);
reply({ type: "shown", visible: false });
const stopsHidden = FakeWorker.engine.sent.filter((m) => m === "stop").length;
check("hiding the panel stops the engine", stopsHidden > 0);
const posHidden = FakeWorker.engine.sent.filter((m) => String(m).startsWith("position")).length;
$("fen").value = AFTER_E4 + " b KQkq - 0 1"; $("go").click();
await sleep(20);
check("and nothing is analysed while hidden", FakeWorker.engine.sent.filter((m) => String(m).startsWith("position")).length === posHidden);
reply({ type: "shown", visible: true });
await sleep(20);
check("showing it again picks up where it was", FakeWorker.engine.sent.filter((m) => String(m).startsWith("position")).length > posHidden);

// ---------------- 4. the host page (content.js) ----------------
console.log("4. host page: fair play, video frames, Follow");
const contentCode = fs.readFileSync(`${SRC}/content.js`, "utf8");
function hostPage(url, body = "<p>page</p>") {
  const d = new JSDOM(`<!doctype html><body>${body}</body>`, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const hw = d.window;
  hw.chrome = { runtime: { getURL: (p) => `chrome-extension://abc/${p}`, lastError: undefined, sendMessage: (m, cb) => setTimeout(() => cb && cb(m.type === "capture" ? { ok: true, dataUrl: "data:image/png;base64,AAAA" } : null), 0) } };
  hw.eval(fpCode);
  hw.eval(contentCode);
  const host = hw.document.querySelector("[data-pawnshot-host]");
  const frame = host.shadowRoot.querySelector("iframe");
  Object.defineProperty(frame, "contentWindow", { value: {}, configurable: true });
  const out = [];
  frame.contentWindow.postMessage = (m) => out.push(m);
  const origin = new hw.URL(frame.src).origin;
  const send = (data) => hw.dispatchEvent(new hw.MessageEvent("message", { data, origin, source: frame.contentWindow }));
  return { hw, host, frame, out, send, code: contentCode };
}
let H = hostPage("https://www.chess.com/play/online", '<wc-chess-board><div class="piece wk square-51"></div><div class="piece bk square-58"></div></wc-chess-board>');
H.send({ type: "hello" });
await sleep(10);
check("on a chess.com play page the host reports a locked page", H.out.some((m) => m.type === "page" && m.locked && m.site === "chesscom"), JSON.stringify(H.out));
H.send({ type: "snapshot", id: 3, auto: false });
await sleep(30);
check("the board is not read: the answer says locked, with no position", H.out.some((m) => m.type === "snapshot" && m.id === 3 && m.locked && m.fen === null));
H.send({ type: "capture", id: 4 });
await sleep(150);
check("a screenshot is refused too", H.out.some((m) => m.type === "captured" && m.id === 4 && !m.ok && m.locked));
H.send({ type: "videoFrame", id: 5 });
await sleep(30);
check("and so is a video frame", H.out.some((m) => m.type === "videoFrame" && m.id === 5 && !m.ok && m.locked));
H.hw.eval(H.code); // toolbar icon again
check("the toolbar icon still toggles the panel", H.host.style.display === "none");
H.hw.eval(H.code);
check("and brings it back", H.host.style.display === "block");

H = hostPage("https://www.youtube.com/watch?v=abc", "<video></video>");
const video = H.hw.document.querySelector("video");
Object.defineProperties(video, { videoWidth: { value: 1280 }, videoHeight: { value: 720 }, readyState: { value: 4 }, paused: { value: false, configurable: true } });
video.getBoundingClientRect = () => ({ left: 0, top: 0, right: 960, bottom: 540, width: 960, height: 540 });
// what the video shows: one grey level, plus `moved` pixels that changed (a piece moving)
let scene = 100, moved = 0;
let taint = false;
const draws = [];
H.hw.HTMLCanvasElement.prototype.getContext = function () {
  return {
    drawImage: (...a) => { if (taint) { const e = new Error("tainted"); e.name = "SecurityError"; throw e; } draws.push(a); },
    getImageData: (x, y, wd, ht) => { const d = new Uint8ClampedArray(wd * ht * 4).fill(scene); for (let i = 0; i < moved; i++) d[i * 4 * 7] = 230; return { data: d }; },
  };
};
H.hw.HTMLCanvasElement.prototype.toBlob = function (cb, type) { if (taint) throw new Error("SecurityError"); cb(new H.hw.Blob([new Uint8Array([1, 2, 3])], { type })); };
H.send({ type: "hello" });
await sleep(10);
check("on YouTube the host reports a video and no lock", H.out.some((m) => m.type === "page" && m.video && !m.locked));
H.send({ type: "videoFrame", id: 9 });
await sleep(30);
const vf = H.out.find((m) => m.type === "videoFrame" && m.id === 9);
check("a frame is taken straight from the video, full size, as a JPEG", vf && vf.ok && vf.blob.type === "image/jpeg" && vf.size.join() === "1280,720" && draws.at(-1).slice(1).join() === "0,0,1280,720,0,0,1280,720", JSON.stringify(vf && vf.size) + " " + JSON.stringify(draws.at(-1) && draws.at(-1).slice(1)));
check("the panel is never hidden for it (no blinking)", H.host.style.visibility !== "hidden");
H.send({ type: "followStart", board: [0.25, 0.125, 0.75, 0.875] });
await waitFor(() => H.out.some((m) => m.type === "followFrame"), 1500);
const ff = H.out.find((m) => m.type === "followFrame");
check("Follow starts with one sharp picture of the board area, and its thumbnail", !!ff && ff.blob && ff.size.join() === "717,605" && ff.box.map((v) => v.toFixed(3)).join() === "0.054,0.054,0.946,0.946" && ff.px.length === 160 * 160 * 3 && ff.pxSize === 160, JSON.stringify(ff && { size: ff.size, box: ff.box, px: ff.px && ff.px.length }));
H.send({ type: "followDone", gap: 0 });
await sleep(700);
check("while the board area does not change, nothing more is sent", !H.out.some((m) => m.type === "followTiles") && H.out.filter((m) => m.type === "followFrame").length === 1);
const draws0 = draws.length;
check("but it is looked at several times a second (a thumbnail each time)", draws0 > 0);
moved = 400; // a piece moved
const tMove = Date.now();
await waitFor(() => H.out.some((m) => m.type === "followTiles"), 1500);
const ft = H.out.find((m) => m.type === "followTiles");
const tookMs = Date.now() - tMove;
check(`a move reaches the panel a moment after the board settles (${tookMs} ms; it was 1.2 to 2.5 s)`, !!ft && tookMs < 600, String(tookMs));
check("as a small thumbnail of the board area (160 px), not a full picture", !!ft && ft.px.length === 160 * 160 * 3 && ft.size === 160 && !ft.blob);
check("a sharp picture only goes when the panel asks for one", H.out.filter((m) => m.type === "followFrame").length === 1);
H.send({ type: "followGrab" });
await waitFor(() => H.out.filter((m) => m.type === "followFrame").length === 2, 1500);
check("when it asks, it gets one", H.out.filter((m) => m.type === "followFrame").length === 2);
H.send({ type: "followGrab" });
await sleep(500);
check("one sharp picture at a time: the next waits until the panel is done with this one", H.out.filter((m) => m.type === "followFrame").length === 2);
H.send({ type: "followBox", box: [0.06, 0.05, 0.94, 0.95] });
H.send({ type: "followDone", gap: 0 });
await waitFor(() => H.out.filter((m) => m.type === "followFrame").length === 3, 1500);
check("then the waiting one is sent, cut with the better box the panel worked out", H.out.filter((m) => m.type === "followFrame").at(-1).box.join() === "0.06,0.05,0.94,0.95", JSON.stringify(H.out.filter((m) => m.type === "followFrame").at(-1).box));
taint = true;
scene = 30;
H.send({ type: "followDone", gap: 0 });
await waitFor(() => H.out.some((m) => m.type === "followError"), 2000);
check("a video that forbids reading stops following and says why", H.out.some((m) => m.type === "followError" && /does not let/.test(m.error)));
H.send({ type: "videoFrame", id: 10 });
await sleep(20);
check("and a frame request on it fails cleanly (the panel then uses a screenshot)", H.out.some((m) => m.type === "videoFrame" && m.id === 10 && !m.ok && m.tainted));
{
  // a camera or a shared screen in a <video> is never read: it could be the reader's own game in another window
  const S2 = hostPage("https://meet.example.com/", "<video></video>");
  S2.hw.MediaStream = class MediaStream {};
  const cam = S2.hw.document.querySelector("video");
  Object.defineProperties(cam, { videoWidth: { value: 1280 }, videoHeight: { value: 720 }, readyState: { value: 4 }, srcObject: { value: new S2.hw.MediaStream() } });
  cam.getBoundingClientRect = () => ({ left: 0, top: 0, right: 960, bottom: 540, width: 960, height: 540 });
  S2.send({ type: "hello" });
  await sleep(10);
  S2.send({ type: "videoFrame", id: 1 });
  await sleep(20);
  check("a live camera or shared screen is not treated as a video (no frame, no Follow)", S2.out.some((m) => m.type === "page" && !m.video) && S2.out.some((m) => m.type === "videoFrame" && !m.ok));
}
H.send({ type: "summary", text: "Nf3  +0.41" });
H.host.shadowRoot.querySelectorAll("button")[1].click(); // minimize
check("minimized, the pill shows the best move", H.host.shadowRoot.querySelector("span").textContent === "Nf3  +0.41");
H.host.shadowRoot.querySelectorAll("button")[1].click();
check("restored, the title is back", H.host.shadowRoot.querySelector("span").textContent === "Pawnshot");

// A panel left behind by an earlier copy of the extension (reloaded while the page stayed open) is removed.
const D = new JSDOM('<!doctype html><body></body>', { url: "https://example.com/", runScripts: "outside-only", pretendToBeVisual: true });
const old = D.window.document.createElement("div");
old.setAttribute("data-pawnshot-host", "");
D.window.document.documentElement.appendChild(old);
D.window.chrome = { runtime: { getURL: (p) => `chrome-extension://new/${p}`, sendMessage: () => {} } };
D.window.eval(contentCode);
check("a dead panel from before an extension update is replaced, not doubled", D.window.document.querySelectorAll("[data-pawnshot-host]").length === 1 && !D.window.document.documentElement.contains(old));

// ---------------- 5. files and manifest ----------------
console.log("5. package");
const man = JSON.parse(fs.readFileSync(`${SRC}/manifest.json`, "utf8"));
check("store name carries the search words people use", /Pawnshot/.test(man.name) && /Chess/.test(man.name) && /Video/.test(man.name) && /Scanner/.test(man.name) && man.name.length <= 75);
check("the summary says what it does: follow a video, Stockfish, fair play", /Follow a chess video/.test(man.description) && /Stockfish/.test(man.description) && /Fair-play/.test(man.description));
check("description fits the 132-character limit", man.description.length <= 132, String(man.description.length));
check("the fair-play check is injected before the panel", /files: \['fairplay\.js', 'content\.js'\]/.test(fs.readFileSync(`${SRC}/background.js`, "utf8")));
check("options page and module background are declared", man.options_ui.page === "options.html" && man.background.type === "module");
for (const f of ["fairplay.js", "video-track.js", "license.js", "plan.js", "premium-config.js", "options.html", "options.js", "options.css", "PRIVACY.md"]) check(`${f} exists`, fs.existsSync(`${SRC}/${f}`));
const pc = await import(`file://${SRC}/premium-config.js`);
check("premium-config ships with a known provider", ["none", "lemonsqueezy", "gumroad"].includes(pc.PREMIUM_CONFIG.provider));

console.log(fail ? `\n${fail} PREMIUM CHECK(S) FAILED` : "\nPREMIUM CHECKS PASSED");
process.exit(fail ? 1 : 0);
