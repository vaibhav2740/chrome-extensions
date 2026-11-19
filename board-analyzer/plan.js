// Free vs Premium: what each plan allows, and the daily allowance of picture scans on the free plan.
// Everything Pawnshot does runs on the device; Premium only lifts limits and adds conveniences.
import { isPremium, isUnpacked, loadLicense } from './license.js';

export const FREE_LIMITS = { scansPerDay: 10, maxDepth: 20, maxLines: 3, follow: false };
export const PREMIUM_LIMITS = { scansPerDay: Infinity, maxDepth: 30, maxLines: 5, follow: true };

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

// ---------- daily scan allowance (free plan) ----------
const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const local = () => (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) || null;
let memory = { day: today(), used: 0 }; // when there is no extension storage (tests, plain pages)

async function readQuota() {
  let q = memory;
  try { const s = local(); if (s) q = (await s.get('scanQuota')).scanQuota || q; } catch (e) { /* use memory */ }
  return q && q.day === today() ? q : { day: today(), used: 0 };
}

export async function scansLeft(premium) {
  if (premium) return Infinity;
  const q = await readQuota();
  return Math.max(0, FREE_LIMITS.scansPerDay - q.used);
}

// Count one scan that found a board. Returns what is left.
export async function useScan(premium) {
  if (premium) return Infinity;
  const q = await readQuota();
  const next = { day: q.day, used: q.used + 1 };
  memory = next;
  try { const s = local(); if (s) await s.set({ scanQuota: next }); } catch (e) { /* kept in memory */ }
  return Math.max(0, FREE_LIMITS.scansPerDay - next.used);
}
