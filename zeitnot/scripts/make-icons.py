#!/usr/bin/env python3
"""Rasterise icons/icon.svg and icons/icon-small.svg into the PNG sizes the manifest lists.

    python3 scripts/make-icons.py

macOS only (uses Quick Look's qlmanage, like Pawnshot's store-art.py) plus Pillow and numpy.
Quick Look draws SVGs on an opaque background, so each size is drawn on black and on white and the two
renders are compared to recover exact transparency. Everything is drawn at 1024 px and shrunk with LANCZOS.

Writes icons/icon-{16,32,48,128}.png. 128 uses the full 16 px clear space the Chrome Web Store asks for;
the smaller sizes crop in so the artwork fills the toolbar slot.
"""
import os
import re
import subprocess
import tempfile

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, 'icons')
BIG = 1024

# (output size, source svg, viewBox to render)
SPECS = [
    (128, 'icon.svg', '0 0 128 128'),
    (48, 'icon.svg', '12 12 104 104'),
    (32, 'icon-small.svg', '0 0 128 128'),
    (16, 'icon-small.svg', '0 0 128 128'),
]


def render(svg_text, view_box, bg, tmp, name):
    head_end = svg_text.index('>', svg_text.index('<svg')) + 1
    head = re.sub(r'\sviewBox="[^"]*"', '', re.sub(r'\s(width|height)="[^"]*"', '', svg_text[:head_end]))
    head = head[:-1] + f' viewBox="{view_box}">'
    x, y, w, h = view_box.split()
    cover = f'<rect x="{float(x) - 50}" y="{float(y) - 50}" width="{float(w) + 100}" height="{float(h) + 100}" fill="#{bg}"/>'
    path = os.path.join(tmp, f'{name}_{bg}.svg')
    with open(path, 'w') as f:
        f.write(head + cover + svg_text[head_end:])
    subprocess.run(['qlmanage', '-t', '-s', str(BIG), '-o', tmp, path], check=True, capture_output=True)
    return Image.open(path + '.png').convert('RGB').resize((BIG, BIG), Image.LANCZOS)


def with_alpha(on_black, on_white):
    b = np.asarray(on_black, dtype=np.float64) / 255.0
    w = np.asarray(on_white, dtype=np.float64) / 255.0
    alpha = np.clip(1.0 - (w - b).mean(axis=2), 0.0, 1.0)
    safe = np.where(alpha[..., None] > 1e-4, alpha[..., None], 1.0)
    rgb = np.clip(b / safe, 0.0, 1.0)
    out = np.dstack([rgb, alpha])
    return Image.fromarray((out * 255.0 + 0.5).astype(np.uint8))


def main():
    tmp = tempfile.mkdtemp()
    for size, svg_name, view_box in SPECS:
        with open(os.path.join(ICONS, svg_name)) as f:
            svg = f.read()
        tag = f'{os.path.splitext(svg_name)[0]}_{size}'
        img = with_alpha(render(svg, view_box, '000', tmp, tag), render(svg, view_box, 'fff', tmp, tag))
        out = os.path.join(ICONS, f'icon-{size}.png')
        img.resize((size, size), Image.LANCZOS).save(out, optimize=True)
        print('wrote', os.path.relpath(out, ROOT))


if __name__ == '__main__':
    main()
