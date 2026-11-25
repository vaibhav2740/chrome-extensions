import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS, SETTINGS_KEY, loadSettings, normalizeSettings, saveSettings } from '../shared/settings.js';

const memoryArea = (initial = {}) => {
  const data = { ...initial };
  return { data, get: async (k) => ({ [k]: data[k] }), set: async (o) => Object.assign(data, o) };
};

test('garbage in, defaults out', () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings('nope'), DEFAULT_SETTINGS);
  const n = normalizeSettings({ follow: 'magnus', badge: 'sparkles', streamDelaySec: 'x', spoilerShield: 'yes', notify: { soon: 1, result: 'true' } });
  assert.deepEqual(n, DEFAULT_SETTINGS);
});

test('valid values survive and delays are clamped to 0..300 whole seconds', () => {
  const n = normalizeSettings({ follow: 'sindarov', badge: 'odds', streamDelaySec: 12.6, spoilerShield: true, notify: { soon: true, zeitnot: true } });
  assert.deepEqual(n, { follow: 'sindarov', badge: 'odds', streamDelaySec: 13, spoilerShield: true, notify: { soon: true, result: false, zeitnot: true } });
  assert.equal(normalizeSettings({ streamDelaySec: -5 }).streamDelaySec, 0);
  assert.equal(normalizeSettings({ streamDelaySec: 9999 }).streamDelaySec, 300);
});

test('saveSettings merges the notify keys one by one and persists a validated copy', async () => {
  const area = memoryArea();
  assert.deepEqual(await loadSettings(area), DEFAULT_SETTINGS);
  await saveSettings(area, { notify: { soon: true } });
  const after = await saveSettings(area, { follow: 'gukesh', notify: { result: true } });
  assert.deepEqual(after.notify, { soon: true, result: true, zeitnot: false });
  assert.equal(after.follow, 'gukesh');
  assert.deepEqual(area.data[SETTINGS_KEY], after);
  await saveSettings(area, { badge: 'bogus' });
  assert.equal((await loadSettings(area)).badge, 'eval');
});
