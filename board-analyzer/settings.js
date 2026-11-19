// What the panel remembers between visits (chrome.storage, or localStorage when run outside the extension).

const hasChromeStorage = () => typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

async function read(key, fallback, valid) {
  try {
    if (hasChromeStorage()) {
      const v = (await chrome.storage.local.get(key))[key];
      if (valid(v)) return v;
    } else if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem('ba.' + key);
      const v = key === 'compactMode' ? raw === '1' : raw;
      if (valid(v)) return v;
    }
  } catch (e) { /* fall through */ }
  return fallback;
}

function write(key, value) {
  try {
    if (hasChromeStorage()) chrome.storage.local.set({ [key]: value });
    else if (typeof localStorage !== 'undefined') localStorage.setItem('ba.' + key, typeof value === 'boolean' ? (value ? '1' : '0') : value);
  } catch (e) { /* not persisted; still applied for this session */ }
}

// ---------- glass vs basic style ----------
// Backdrop blur is cheap on most machines but costly on weak GPUs, especially over playing video, so it is a setting.
// Auto turns it off for "reduce transparency" users and very low-end devices.
export function effectiveGlass(mode) {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-transparency: reduce)').matches) return false;
    if (navigator.deviceMemory && navigator.deviceMemory <= 2) return false;
    if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) return false;
  } catch (e) { /* unknown: assume capable */ }
  return true;
}

export const loadGlassMode = () => read('glassMode', 'auto', (v) => ['auto', 'on', 'off'].includes(v));
export const saveGlassMode = (mode) => write('glassMode', mode);

// ---------- compact view ----------
export const loadCompact = () => read('compactMode', false, (v) => typeof v === 'boolean');
export const saveCompact = (on) => write('compactMode', !!on);
