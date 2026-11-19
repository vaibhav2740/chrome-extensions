// Free vs Premium: what each plan allows, and the daily allowances of the free plan.
// Everything Pawnshot does runs on the device, so a scan costs nothing to give away: picture scans are unlimited on
// both plans (other scanners offer that too). What Premium sells is what only Pawnshot does: following a video move
// by move. The free plan gets a taste of it every day (followMinutes).
import { isPremium, isUnpacked, loadLicense } from './license.js';

export const FREE_LIMITS = { scansPerDay: Infinity, followMinutes: 10, maxDepth: 20, maxLines: 3 };
export const PREMIUM_LIMITS = { scansPerDay: Infinity, followMinutes: Infinity, maxDepth: 30, maxLines: 5 };

// Board colours. The first two are free.
export const THEMES = {
  classic: { label: 'Classic', light: '#f0d9b5', dark: '#b58863', free: true },
  green: { label: 'Tournament', light: '#eeeed2', dark: '#769656', free: true },
  blue: { label: 'Ice', light: '#dee3e6', dark: '#8ca2ad', free: false },
  purple: { label: 'Amethyst', light: '#e9e1f3', dark: '#8d78b5', free: false },
  slate: { label: 'Slate', light: '#d7dbe1', dark: '#6c7889', free: false },
  coral: { label: 'Coral', light: '#f4ddd3', dark: '#c47f6c', free: false },
};
export const themeAllowed = (name, premium) => !!THEMES[name] && (premium || THEMES[name].free);

export const limitsFor = (premium) => (premium ? PREMIUM_LIMITS : FREE_LIMITS);

export async function loadPremium() {
  return isPremium(await loadLicense(), { unpacked: isUnpacked() });
}

// ---------- daily allowances (free plan): picture scans (unlimited for now) and minutes of Follow on a video ----------
const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const local = () => (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) || null;
const memory = {}; // when there is no extension storage (tests, plain pages)

async function readQuota(key) {
  let q = memory[key];
  try { const s = local(); if (s) q = (await s.get(key))[key] || q; } catch (e) { /* use memory */ }
  return q && q.day === today() ? q : { day: today(), used: 0 };
}
async function addQuota(key, n) {
  const q = await readQuota(key);
  const next = { day: q.day, used: q.used + n };
  memory[key] = next;
  try { const s = local(); if (s) await s.set({ [key]: next }); } catch (e) { /* kept in memory */ }
  return next.used;
}

export async function scansLeft(premium) {
  if (premium || !Number.isFinite(FREE_LIMITS.scansPerDay)) return Infinity;
  return Math.max(0, FREE_LIMITS.scansPerDay - (await readQuota('scanQuota')).used);
}

// Count one scan that found a board. Returns what is left.
export async function useScan(premium) {
  if (premium || !Number.isFinite(FREE_LIMITS.scansPerDay)) return Infinity;
  return Math.max(0, FREE_LIMITS.scansPerDay - (await addQuota('scanQuota', 1)));
}

// Milliseconds of Follow on a video left today.
export async function followLeft(premium) {
  if (premium || !Number.isFinite(FREE_LIMITS.followMinutes)) return Infinity;
  return Math.max(0, FREE_LIMITS.followMinutes * 60000 - (await readQuota('followQuota')).used);
}

// Count `ms` of following. Returns what is left.
export async function useFollow(premium, ms) {
  if (premium || !Number.isFinite(FREE_LIMITS.followMinutes)) return Infinity;
  return Math.max(0, FREE_LIMITS.followMinutes * 60000 - (await addQuota('followQuota', Math.max(0, Math.round(ms)))));
}
