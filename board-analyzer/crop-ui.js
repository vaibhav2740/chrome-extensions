// "Select the board" sheet: shows a picture and lets the person draw a box around the board, for when reading the
// whole picture was not enough. Reading then happens on the boxed part only.

// deps: { $, onRead(blob, crop|null), onCancel() }
export function createCropSheet({ $, onRead, onCancel }) {
  let blob = null, url = null, natW = 0, natH = 0, crop = null, start = null;

  const isOpen = () => document.body.classList.contains('cropping');
  const drawBox = (x0, y0, x1, y1) => {
    const el = $('cropBox');
    el.hidden = false;
    el.style.left = Math.min(x0, x1) + 'px';
    el.style.top = Math.min(y0, y1) + 'px';
    el.style.width = Math.abs(x1 - x0) + 'px';
    el.style.height = Math.abs(y1 - y0) + 'px';
  };
  const hint = () => {
    $('cropHint').textContent = crop
      ? 'Only the boxed area will be read. Click the picture to clear the box.'
      : 'Drag a box around the board, then press Read.';
  };
  const point = (e) => {
    const r = $('cropImg').getBoundingClientRect();
    return { r, x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: Math.max(0, Math.min(r.height, e.clientY - r.top)) };
  };

  function open(picture) {
    release();
    blob = picture;
    url = URL.createObjectURL(picture);
    crop = null;
    $('cropBox').hidden = true;
    $('cropImg').src = url;
    hint();
    document.body.classList.add('cropping');
  }

  function release() {
    if (url) { try { URL.revokeObjectURL(url); } catch (e) { /* gone */ } }
    url = null; blob = null; natW = natH = 0;
  }

  function close() {
    document.body.classList.remove('cropping');
    release();
  }

  $('cropImg').addEventListener('load', () => { natW = $('cropImg').naturalWidth; natH = $('cropImg').naturalHeight; });
  $('cropWrap').addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const p = point(e);
    if (!p.r.width) return;
    start = { x: p.x, y: p.y };
    try { $('cropWrap').setPointerCapture(e.pointerId); } catch (err) { /* synthetic event */ }
  });
  $('cropWrap').addEventListener('pointermove', (e) => {
    if (!start) return;
    const p = point(e);
    drawBox(start.x, start.y, p.x, p.y);
  });
  $('cropWrap').addEventListener('pointerup', (e) => {
    if (!start) return;
    const p = point(e);
    const x0 = Math.min(start.x, p.x), y0 = Math.min(start.y, p.y), x1 = Math.max(start.x, p.x), y1 = Math.max(start.y, p.y);
    start = null;
    if (x1 - x0 < 24 || y1 - y0 < 24 || !p.r.width) { crop = null; $('cropBox').hidden = true; hint(); return; }
    const sx = (natW || p.r.width) / p.r.width, sy = (natH || p.r.height) / p.r.height;
    crop = [x0 * sx, y0 * sy, x1 * sx, y1 * sy];
    drawBox(x0, y0, x1, y1);
    hint();
  });
  $('cropWrap').addEventListener('pointercancel', () => { start = null; });

  $('cropCancel').onclick = () => { close(); onCancel(); };
  $('cropRead').onclick = () => { const b = blob, c = crop; close(); onRead(b, c); };
  document.addEventListener('keydown', (e) => { if (isOpen() && e.key === 'Escape') $('cropCancel').onclick(); });

  return { open, close, isOpen };
}
