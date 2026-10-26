// Toggle the panel: inject content.js (idempotent, it toggles itself if already present).
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (e) {
    console.warn('Cannot inject on this page (chrome:// pages, Web Store and PDFs are blocked):', e.message);
  }
});

// Runs inside the page's own JS world so it can read chess.com's internal game object.
function mainWorldFen() {
  try {
    const boards = [...document.querySelectorAll('wc-chess-board, chess-board')];
    for (const el of boards) {
      const g = el.game;
      if (g && typeof g.getFEN === 'function') return { fen: g.getFEN(), src: 'chess.com game object' };
    }
  } catch (e) {}
  try {
    const a = window.lichess && window.lichess.analysis;
    if (a && a.node && a.node.fen) return { fen: a.node.fen, src: 'lichess analysis' };
  } catch (e) {}
  return null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'mainFen' && sender.tab) {
    chrome.scripting
      .executeScript({ target: { tabId: sender.tab.id }, world: 'MAIN', func: mainWorldFen })
      .then((r) => sendResponse((r && r[0] && r[0].result) || null))
      .catch(() => sendResponse(null));
    return true; // async response
  }
});
