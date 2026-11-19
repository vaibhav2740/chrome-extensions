import { PROVIDER_ORIGINS, loadLicense, needsCheck, revalidate, saveLicense } from './license.js';

// Toggle the panel: inject the fair-play check and content.js (idempotent, it toggles itself if already present).
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['fairplay.js', 'content.js'] });
  } catch (e) {
    console.warn('Cannot inject on this page (chrome:// pages, the Web Store and the PDF viewer are blocked):', e.message);
  }
});

// First install: a short welcome page (pin the icon, how Snapshot works, fair play).
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('options.html#welcome') });
  checkLicense();
});
chrome.runtime.onStartup.addListener(() => { checkLicense(); });

// Re-check a Premium key about once a week. Offline or server trouble keeps Premium on (grace period, see license.js).
async function checkLicense() {
  try {
    const rec = await loadLicense();
    if (!needsCheck(rec)) return;
    const origin = PROVIDER_ORIGINS[rec.provider];
    if (!origin || !(await chrome.permissions.contains({ origins: [origin] }))) return;
    await saveLicense(await revalidate(rec));
  } catch (e) { /* next time */ }
}

// Runs inside the page's own JS world so it can read chess.com's internal game object.
function mainWorldFen() {
  try {
    const boards = [...document.querySelectorAll('wc-chess-board, chess-board')];
    for (const el of boards) {
      const g = el.game;
      if (g && typeof g.getFEN === 'function') return { fen: g.getFEN(), src: 'chess.com game' };
    }
  } catch (e) {}
  try {
    const a = window.lichess && window.lichess.analysis;
    if (a && a.node && a.node.fen) return { fen: a.node.fen, src: 'lichess analysis' };
  } catch (e) {}
  return null;
}

// A picture of the tab the message came from, for the board scanner. Needs the tab to have been activated by a
// click on the toolbar icon (or the shortcut): that is what "activeTab" grants.
function captureError(e) {
  const m = String((e && e.message) || e);
  if (/activeTab|permission|cannot access|not allowed/i.test(m)) {
    return 'Chrome only allows a screenshot after you click the Pawnshot icon on this tab. Click it once, or paste a screenshot instead.';
  }
  return 'Could not capture this tab: ' + m;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'capture' && sender.tab) {
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' })
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((e) => sendResponse({ ok: false, error: captureError(e) }));
    return true; // async response
  }
  if (msg && msg.type === 'mainFen' && sender.tab) {
    chrome.scripting
      .executeScript({ target: { tabId: sender.tab.id }, world: 'MAIN', func: mainWorldFen })
      .then((r) => sendResponse((r && r[0] && r[0].result) || null))
      .catch(() => sendResponse(null));
    return true; // async response
  }
  if (msg && msg.type === 'openOptions') {
    const hash = typeof msg.section === 'string' && /^[a-z]+$/.test(msg.section) ? '#' + msg.section : '';
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html' + hash) });
    return false;
  }
  if (msg && msg.type === 'checkLicense') { checkLicense(); return false; }
  return false;
});
