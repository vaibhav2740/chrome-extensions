// Getting a position out of a picture: capture the screen (or take a given picture), hand it to the reader, and
// report one tidy outcome. The caller decides what to show.
//   { ok: true,  result, source: 'screen' | 'picture', blob }
//   { ok: false, kind: 'capture' | 'read' | 'cancelled', error }

export function dataUrlToBlob(url) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url || '');
  if (!m) throw new Error('Not an image');
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] || 'image/png' });
}

const CANCELLED = { ok: false, kind: 'cancelled' };

// deps: { capture() -> Promise<{ok, dataUrl, error}>, makeScanner(onStage) -> { scan(blob, crop) }, onStage(name) }
export function createScanFlow({ capture, makeScanner, onStage = () => {} }) {
  let scanner = null;
  let run = 0; // bumps on every start and cancel; a result from an older run is dropped

  async function read(blob, crop, source, id, opts) {
    try {
      if (!scanner) scanner = makeScanner((stage) => onStage(stage));
      const result = await scanner.scan(blob, crop, opts);
      return id === run ? { ok: true, result, source, blob } : CANCELLED;
    } catch (e) {
      return id === run ? { ok: false, kind: 'read', error: String((e && e.message) || e), blob } : CANCELLED;
    }
  }

  return {
    cancel() { run++; },

    // Take a picture of the whole visible page and read it.
    async scanScreen() {
      const id = ++run;
      onStage('capturing');
      let res;
      try { res = await capture(); } catch (e) { res = { ok: false, error: String((e && e.message) || e) }; }
      if (id !== run) return CANCELLED;
      if (!res || !res.ok) {
        return { ok: false, kind: 'capture', error: (res && res.error) || 'Could not capture this tab. Paste a screenshot instead.' };
      }
      let blob;
      try { blob = dataUrlToBlob(res.dataUrl); } catch (e) {
        return { ok: false, kind: 'capture', error: 'The capture could not be read. Paste a screenshot instead.' };
      }
      return read(blob, null, 'screen', id);
    },

    // Read a picture the person gave us, optionally only the part inside `crop` = [x0, y0, x1, y1] (picture pixels).
    // opts.box: the board's known place in the picture (skips finding it).
    scanBlob(blob, crop = null, source = 'picture', opts = {}) {
      return read(blob, crop, source, ++run, opts);
    },
  };
}
