// Image bytes -> position, for the browser. Shared by the worker (normal) and the page (fallback).
// Decoding uses the browser's own image decoder, so PNG, JPEG, WebP and phone photos (EXIF-rotated) all work.

import { createEngine } from './engine.js';

// Screenshots of 4K / retina screens are huge; the networks look at 256-320 px anyway.
export const MAX_EDGE = 2560;

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Decode `blob`, optionally cropped to `crop` = [x0, y0, x1, y1] in the picture's own pixels, and shrink it to
// MAX_EDGE. Returns the pixels plus what is needed to map positions back onto the original picture.
export async function decodeImage(blob, crop = null) {
  const bmp = await createImageBitmap(blob);
  try {
    const W = bmp.width, H = bmp.height;
    let sx = 0, sy = 0, sw = W, sh = H;
    if (crop) {
      sx = Math.max(0, Math.min(W - 1, Math.round(crop[0])));
      sy = Math.max(0, Math.min(H - 1, Math.round(crop[1])));
      sw = Math.max(1, Math.min(W, Math.round(crop[2])) - sx);
      sh = Math.max(1, Math.min(H, Math.round(crop[3])) - sy);
    }
    const scale = Math.min(1, MAX_EDGE / Math.max(sw, sh));
    const cw = Math.max(1, Math.round(sw * scale)), ch = Math.max(1, Math.round(sh * scale));
    const canvas = makeCanvas(cw, ch);
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; // transparent pixels become white, like a page behind a screenshot
    g.fillRect(0, 0, cw, ch);
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, sx, sy, sw, sh, 0, 0, cw, ch);
    const px = g.getImageData(0, 0, cw, ch);
    return { image: { width: cw, height: ch, data: px.data }, origin: [sx, sy], scale, size: [W, H] };
  } finally {
    if (bmp.close) bmp.close();
  }
}

// ort: onnxruntime-web module. base: URL of the scanner folder (ends with '/').
export function createRunner({ ort, base, onStage }) {
  const engine = createEngine({
    ort,
    onStage,
    async loadBytes(name) {
      const res = await fetch(new URL(`models/${name}.onnx`, base));
      if (!res.ok) throw new Error(`Could not load the ${name} model (${res.status})`);
      return new Uint8Array(await res.arrayBuffer());
    },
  });
  return {
    async scan(blob, crop) {
      const d = await decodeImage(blob, crop);
      // a hand-drawn box already gives the locator a tight view, so it needs fewer passes
      const r = await engine.read(d.image, { passes: crop ? 2 : 3 });
      // map the found corners back onto the original picture
      r.corners = r.corners.map(([x, y]) => [x / d.scale + d.origin[0], y / d.scale + d.origin[1]]);
      r.imageSize = d.size;
      return r;
    },
    release: () => engine.release(),
  };
}
