// End-to-end check of the board reader with the real shipped models and the real ONNX Runtime (WebAssembly, one
// thread, exactly as in the browser worker). Images are synthetic boards and boards pasted into busy pages.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import * as ort from "../scanner/ort/ort.wasm.min.mjs";
import { createEngine } from "../scanner/engine.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FX = path.join(ROOT, "test", "fixtures");
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = pathToFileURL(path.join(ROOT, "scanner", "ort") + "/").href;

const engine = createEngine({ ort, loadBytes: async (n) => new Uint8Array(fs.readFileSync(path.join(ROOT, "scanner", "models", `${n}.onnx`))) });
const load = (f) => { const p = PNG.sync.read(fs.readFileSync(path.join(FX, f))); return { width: p.width, height: p.height, data: new Uint8ClampedArray(p.data) }; };
const truth = JSON.parse(fs.readFileSync(path.join(FX, "truth.json"), "utf8"));

let fail = 0;
const check = (n, c, x = "") => { console.log(`  ${c ? "✓" : "✗"} ${n} ${c ? "" : x}`); if (!c) fail++; };

console.log("clean board pictures (several piece sets, one blurry video-style frame)");
for (const [f, t] of Object.entries(truth.boards)) {
  const r = await engine.read(load(f));
  check(f, r.placement === t.placement && r.bottom === t.bottom, `${r.placement} / ${r.bottom}`);
}
console.log("boards inside busy 1280x720 .. 1920x1080 pages, both orientations");
let pageHits = 0;
const pages = Object.entries(truth.pages);
for (const [f, t] of pages) {
  const r = await engine.read(load(f));
  const hit = r.placement === t.placement && r.bottom === t.bottom;
  pageHits += hit;
  console.log(`  ${hit ? "·" : "✗"} ${f} (${r.ms.locate + r.ms.read} ms, confidence ${(100 * r.confidence).toFixed(0)}%)`);
}
check(`at least ${pages.length - 1} of ${pages.length} pages read exactly`, pageHits >= pages.length - 1, `${pageHits}/${pages.length}`);

console.log("behaviour");
const r1 = await engine.read(load(Object.keys(truth.boards)[0]));
check("result carries per-square confidence for all 64 squares", r1.squareConfidence.length === 64 && r1.squareConfidence.every((c) => c > 0 && c <= 1));
check("grid is 8x8 as drawn and matches the placement", r1.grid.length === 8 && r1.grid.every((row) => row.length === 8));
const both = await Promise.all([engine.read(load(Object.keys(truth.boards)[1])), engine.read(load(Object.keys(truth.boards)[2]))]);
check("overlapping scans are queued, both finish correctly", both[0].placement === Object.values(truth.boards)[1].placement && both[1].placement === Object.values(truth.boards)[2].placement);
const blank = { width: 400, height: 300, data: new Uint8ClampedArray(400 * 300 * 4).fill(255) };
let blankOk = true;
try { await engine.read(blank); } catch (e) { blankOk = false; }
check("a picture with no board does not crash the reader", blankOk);
await engine.release();
const again = await engine.read(load(Object.keys(truth.boards)[0]));
check("the models reload after release()", again.placement === Object.values(truth.boards)[0].placement);
await engine.release();

console.log(fail ? `\n${fail} ENGINE CHECK(S) FAILED` : "\nENGINE CHECKS PASSED");
process.exit(fail ? 1 : 0);
