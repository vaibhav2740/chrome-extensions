// What the panel remembers between visits (chrome.storage, or localStorage when run outside the extension).
// The panel and the options page both read and write these; onSettingsChange tells a page when the other one changed them.

const hasChromeStorage = () => typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

async function read(key, fallback, valid) {
  try {
    if (hasChromeStorage()) {
      const v = (await chrome.storage.local.get(key))[key];
      if (valid(v)) return v;
    } else if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem('ba.' + key);
      const v = raw === '1' ? true : raw === '0' ? false : raw != null && /^\d+$/.test(raw) ? +raw : raw;
      if (valid(v)) return v;
    }
  } catch (e) { /* fall through */ }
  return fallback;
}

function write(key, value) {
  try {
    if (hasChromeStorage()) chrome.storage.local.set({ [key]: value });
    else if (typeof localStorage !== 'undefined') localStorage.setItem('ba.' + key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
  } catch (e) { /* not persisted; still applied for this session */ }
}

// callback({ key: newValue, ... }) whenever stored settings change elsewhere (another tab, the options page).
export function onSettingsChange(cb) {
  try {
    if (hasChromeStorage() && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        const out = {};
        for (const [k, v] of Object.entries(changes)) out[k] = v.newValue;
        cb(out);
      });
    }
  } catch (e) { /* no live updates */ }
}

// ---------- device class ----------
// Weak devices (2 GB of memory or 2 cores) get the solid style and a lighter default search.
export function weakDevice() {
  try {
    if (navigator.deviceMemory && navigator.deviceMemory <= 2) return true;
    if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) return true;
  } catch (e) { /* unknown: assume capable */ }
  return false;
}

// ---------- glass vs basic style ----------
// Backdrop blur is cheap on most machines but costly on weak GPUs, especially over playing video, so it is a setting.
// Auto turns it off for "reduce transparency" users and very low-end devices.
export function effectiveGlass(mode) {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-transparency: reduce)').matches) return false;
  } catch (e) { /* unknown */ }
  return !weakDevice();
}

export const loadGlassMode = () => read('glassMode', 'auto', (v) => ['auto', 'on', 'off'].includes(v));
export const saveGlassMode = (mode) => write('glassMode', mode);

// ---------- compact view ----------
export const loadCompact = () => read('compactMode', false, (v) => typeof v === 'boolean');
export const saveCompact = (on) => write('compactMode', !!on);

// ---------- board colours ----------
export const loadTheme = () => read('boardTheme', 'classic', (v) => typeof v === 'string' && /^[a-z]+$/.test(v));
export const saveTheme = (name) => write('boardTheme', name);

// ---------- engine defaults ----------
export const defaultDepth = () => (weakDevice() ? 16 : 20);
export const defaultLines = () => (weakDevice() ? 2 : 3);
export const loadDepth = () => read('engineDepth', defaultDepth(), (v) => Number.isInteger(v) && v >= 8 && v <= 30);
export const saveDepth = (d) => write('engineDepth', d);
export const loadLines = () => read('engineLines', defaultLines(), (v) => Number.isInteger(v) && v >= 1 && v <= 5);
export const saveLines = (n) => write('engineLines', n);
