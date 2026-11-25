import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const manifest = JSON.parse(read('manifest.json'));

test('Manifest V3 with a module service worker, a popup and matching versions', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.type, 'module');
  assert(fs.existsSync(path.join(ROOT, manifest.background.service_worker)));
  assert(fs.existsSync(path.join(ROOT, manifest.action.default_popup)));
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  assert(manifest.name.length <= 75 && manifest.description.length <= 132, 'within the store limits');
  assert(Number(manifest.minimum_chrome_version) >= 120, '30 s alarms need Chrome 120');
});

test('every icon exists at exactly its stated size', () => {
  const all = { ...manifest.icons, ...manifest.action.default_icon };
  for (const [size, rel] of Object.entries(all)) {
    const buf = fs.readFileSync(path.join(ROOT, rel));
    assert.equal(buf.toString('ascii', 1, 4), 'PNG');
    assert.equal(buf.readUInt32BE(16), Number(size), `${rel} width`);
    assert.equal(buf.readUInt32BE(20), Number(size), `${rel} height`);
  }
  assert.deepEqual(Object.keys(manifest.icons), ['16', '32', '48', '128']);
});

test('permissions are the minimum: storage, alarms, lichess.org; notifications only on request', () => {
  assert.deepEqual(manifest.permissions.slice().sort(), ['alarms', 'storage']);
  assert.deepEqual(manifest.optional_permissions, ['notifications']);
  assert.deepEqual(manifest.host_permissions, ['https://lichess.org/*']);
});

test('every network address in the code is on lichess.org', () => {
  const files = ['background.js', ...fs.readdirSync(path.join(ROOT, 'shared')).map((f) => `shared/${f}`), 'popup/popup.js', 'popup/popup.html'];
  for (const rel of files) {
    for (const m of read(rel).matchAll(/https?:\/\/[^\s'"`)<>]+/g)) {
      const host = new URL(m[0].replace(/\$\{[^}]*\}.*/, '')).hostname;
      assert(/^(image\.)?lichess\.org$|^www\.w3\.org$/.test(host), `${rel} mentions ${m[0]}`);
    }
  }
});

test('popup.html has no inline script (MV3 CSP) and every id the popup looks up exists', () => {
  const html = read('popup/popup.html');
  assert(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'inline <script> would be blocked');
  assert(!/\son\w+\s*=/i.test(html), 'no inline event handlers');
  const js = read('popup/popup.js');
  const list = js.slice(js.indexOf('const IDS = ['), js.indexOf('];', js.indexOf('const IDS = [')));
  for (const m of list.matchAll(/'([A-Za-z0-9]+)'/g)) assert(html.includes(`id="${m[1]}"`), `popup.html has no #${m[1]}`);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
});

test('the shortcut opens the popup', () => {
  assert(manifest.commands._execute_action.suggested_key.default);
});

test('the pack script leaves out tests, scripts and docs', () => {
  const sh = read('scripts/pack.sh');
  for (const x of ['test/*', 'scripts/*', 'node_modules/*', 'README.md']) assert(sh.includes(x), x);
});
