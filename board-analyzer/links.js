// Taking the position somewhere else: other analysis boards, the clipboard.

// Lichess takes the FEN in the path with spaces as underscores; ?color=black shows the board from Black's side.
export function lichessUrl(fen, flippedView) {
  return 'https://lichess.org/analysis/' + fen.trim().replace(/\s+/g, '_') + (flippedView ? '?color=black' : '');
}

export function chesscomUrl(fen, flippedView) {
  return 'https://www.chess.com/analysis?fen=' + encodeURIComponent(fen.trim()) + '&flip=' + (flippedView ? 'true' : 'false');
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { /* blocked */ }
    ta.remove();
    return ok;
  }
}

export function openExternal(url) {
  window.open(url, '_blank', 'noopener,noreferrer');
}
