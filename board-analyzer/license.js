// Premium licence keys: activate, re-check now and then, deactivate. Works with Lemon Squeezy or Gumroad (pick in
// premium-config.js). Used by the options page (activate / deactivate) and the background (weekly re-check).
//
// What is stored (chrome.storage.local "license"):
//   { key, provider, instanceId, status: 'active' | 'invalid' | 'dev', email, checkedAt, okAt, message }
// Premium stays on for GRACE_MS after the last successful check, so being offline for a while never locks anyone out.
// status 'dev' is a test switch that only counts in an unpacked (developer) install, never in a store install.
import { PREMIUM_CONFIG } from './premium-config.js';

export const REVALIDATE_MS = 7 * 24 * 3600 * 1000;
export const GRACE_MS = 30 * 24 * 3600 * 1000;
export const PROVIDER_ORIGINS = {
  lemonsqueezy: 'https://api.lemonsqueezy.com/*',
  gumroad: 'https://api.gumroad.com/*',
};

export function isPremium(rec, { unpacked = false, now = Date.now(), config = PREMIUM_CONFIG } = {}) {
  if (!rec) return false;
  if (rec.status === 'dev') return !!unpacked;
  if (rec.status !== 'active' || rec.provider !== config.provider) return false;
  return now - (rec.okAt || 0) < GRACE_MS;
}

export const needsCheck = (rec, now = Date.now()) => !!rec && rec.status === 'active' && now - (rec.checkedAt || 0) > REVALIDATE_MS;

// A store install has an update_url in its manifest; an unpacked (developer) install does not.
export function isUnpacked() {
  try { return typeof chrome !== 'undefined' && !!chrome.runtime && !('update_url' in chrome.runtime.getManifest()); } catch (e) { return false; }
}

async function post(fetchFn, url, body) {
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  return { status: res.status, data: data || {} };
}

// A key sold by someone else's Lemon Squeezy store must not unlock Pawnshot.
function lsOwnProduct(meta, config) {
  const c = config.lemonsqueezy || {};
  if (!c.storeId || +meta.store_id !== +c.storeId) return false;
  const ids = (c.productIds || []).map(Number);
  return !ids.length || ids.includes(+meta.product_id);
}

function gumroadProblem(p) {
  if (!p) return 'The license server gave no purchase details.';
  if (p.refunded) return 'This purchase was refunded.';
  if (p.chargebacked || p.disputed) return 'This purchase was disputed.';
  if (p.subscription_ended_at || p.subscription_cancelled_at || p.subscription_failed_at) return 'This subscription has ended.';
  return null;
}

const LS = 'https://api.lemonsqueezy.com/v1/licenses/';
const ADAPTERS = {
  lemonsqueezy: {
    async activate(key, { fetchFn, config, instanceName }) {
      const { status, data } = await post(fetchFn, LS + 'activate', { license_key: key, instance_name: instanceName });
      if (!data.activated) return { ok: false, message: data.error || `The license server refused this key (${status}).` };
      const instanceId = data.instance && data.instance.id;
      if (!lsOwnProduct(data.meta || {}, config)) {
        try { await post(fetchFn, LS + 'deactivate', { license_key: key, instance_id: instanceId }); } catch (e) { /* best effort */ }
        return { ok: false, message: 'This key is for a different product.' };
      }
      return { ok: true, instanceId, email: (data.meta && data.meta.customer_email) || '' };
    },
    async validate(rec, { fetchFn, config }) {
      const { status, data } = await post(fetchFn, LS + 'validate', { license_key: rec.key, instance_id: rec.instanceId });
      if (status >= 500) throw new Error('license server unavailable');
      if (!data.valid) return { ok: false, message: data.error || 'This key is no longer valid.' };
      if (!lsOwnProduct(data.meta || {}, config)) return { ok: false, message: 'This key is for a different product.' };
      return { ok: true };
    },
    async deactivate(rec, { fetchFn }) {
      await post(fetchFn, LS + 'deactivate', { license_key: rec.key, instance_id: rec.instanceId });
    },
  },
  gumroad: {
    async activate(key, { fetchFn, config }) {
      const { status, data } = await post(fetchFn, 'https://api.gumroad.com/v2/licenses/verify',
        { product_id: config.gumroad.productId, license_key: key, increment_uses_count: 'true' });
      if (!data.success) return { ok: false, message: data.message || `The license server refused this key (${status}).` };
      const bad = gumroadProblem(data.purchase);
      if (bad) return { ok: false, message: bad };
      if (+data.uses > config.maxActivations) return { ok: false, message: `This key is already in use on ${config.maxActivations} browsers.` };
      return { ok: true, instanceId: '', email: data.purchase.email || '' };
    },
    async validate(rec, { fetchFn, config }) {
      const { status, data } = await post(fetchFn, 'https://api.gumroad.com/v2/licenses/verify',
        { product_id: config.gumroad.productId, license_key: rec.key, increment_uses_count: 'false' });
      if (status >= 500) throw new Error('license server unavailable');
      if (!data.success) return { ok: false, message: data.message || 'This key is no longer valid.' };
      const bad = gumroadProblem(data.purchase);
      return bad ? { ok: false, message: bad } : { ok: true };
    },
    async deactivate() { /* Gumroad keys have no per-browser slot to give back */ },
  },
};

function deps(d = {}) {
  return {
    fetchFn: d.fetchFn || ((...a) => fetch(...a)),
    config: d.config || PREMIUM_CONFIG,
    now: d.now || Date.now(),
    instanceName: d.instanceName || 'Pawnshot on Chrome',
  };
}

// -> { ok: true, record } | { ok: false, message }
export async function activateKey(rawKey, d) {
  const o = deps(d);
  const key = String(rawKey || '').trim();
  const a = ADAPTERS[o.config.provider];
  if (!a) return { ok: false, message: 'Premium is not on sale yet.' };
  if (key.length < 8) return { ok: false, message: 'That does not look like a license key.' };
  let r;
  try { r = await a.activate(key, o); } catch (e) {
    return { ok: false, message: 'Could not reach the license server. Check your connection and try again.' };
  }
  if (!r.ok) return r;
  return {
    ok: true,
    record: { key, provider: o.config.provider, instanceId: r.instanceId || '', status: 'active', email: r.email || '', checkedAt: o.now, okAt: o.now, message: '' },
  };
}

// The weekly check. Returns the record to store. A network problem keeps the record as it is (grace period).
export async function revalidate(rec, d) {
  const o = deps(d);
  const a = rec && ADAPTERS[rec.provider];
  if (!a || rec.status !== 'active') return rec;
  try {
    const r = await a.validate(rec, o);
    return r.ok ? { ...rec, checkedAt: o.now, okAt: o.now, message: '' } : { ...rec, status: 'invalid', checkedAt: o.now, message: r.message };
  } catch (e) {
    return { ...rec, checkedAt: o.now };
  }
}

export async function deactivateKey(rec, d) {
  const o = deps(d);
  const a = rec && ADAPTERS[rec.provider];
  if (a && rec.status === 'active') { try { await a.deactivate(rec, o); } catch (e) { /* the slot frees itself on the next validation failure */ } }
}

// ---------- storage ----------
const store = () => (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) || null;
export async function loadLicense() {
  try { const s = store(); return s ? (await s.get('license')).license || null : null; } catch (e) { return null; }
}
export async function saveLicense(rec) {
  const s = store();
  if (!s) return;
  if (rec) await s.set({ license: rec }); else await s.remove('license');
}
