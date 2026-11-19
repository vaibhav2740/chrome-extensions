#!/usr/bin/env python3
"""Store artwork for the Chrome Web Store listing (macOS: needs qlmanage, which ships with it, and Pillow).

    python3 scripts/store-art.py

Writes:
  icons/128.png                    the package icon, artwork 96x96 with 16 px of clear space (the store's rule)
  store/icon-128.png               the same, for the dashboard's "Store icon" box
  store/promo-small-440x280.png    "Small promo tile" (items without one are listed after items that have one)
  store/promo-marquee-1400x560.png "Marquee promo tile" (only used if the store features the item)

The full-bleed icon artwork is kept in store/icon-art-128.png and is what everything is drawn from, so running this
again gives the same files. Pieces are lichess's cburnett set (pieces/), the font is Nunito (store/fonts, SIL OFL).
"""
import os
import re
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORE = os.path.join(ROOT, 'store')
FONT = os.path.join(STORE, 'fonts', 'Nunito.ttf')

# The Opera game, just before 16.Qb8+! Nxb8 17.Rd8#: the best move is a queen sacrifice.
FEN = '4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4'
ARROW = ('b3', 'b8')
LIGHT, DARK = (240, 217, 181), (181, 136, 99)  # the panel's Classic board
TEAL_HI, TEAL_LO = (60, 196, 172), (10, 70, 78)  # from the icon


def font(size, weight='ExtraBold'):
    f = ImageFont.truetype(FONT, size)
    f.set_variation_by_name(weight)
    return f


def render_pieces(px):
    """cburnett SVGs -> RGBA images. Quick Look draws SVGs on white, so each piece is drawn on black and on white
    and the two are compared to recover the transparency exactly."""
    out = {}
    tmp = tempfile.mkdtemp()
    try:
        for name in ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP']:
            svg = open(os.path.join(ROOT, 'pieces', f'{name}.svg')).read()
            at = svg.index('>', svg.index('<svg')) + 1
            # Quick Look draws an SVG with a width/height at that size in the corner: keep only the viewBox
            tag = re.sub(r'\s(width|height)="[^"]*"', '', svg[:at])
            if 'viewBox' not in tag:
                tag = tag[:-1] + ' viewBox="0 0 45 45">'
            svg, at = tag + svg[at:], len(tag)
            shots = {}
            for bg in ('000', 'fff'):
                p = os.path.join(tmp, f'{name}_{bg}.svg')
                open(p, 'w').write(svg[:at] + f'<rect x="-50" y="-50" width="200" height="200" fill="#{bg}"/>' + svg[at:])
                subprocess.run(['qlmanage', '-t', '-s', str(px), '-o', tmp, p], check=True, capture_output=True)
                shots[bg] = Image.open(p + '.png').convert('RGB').resize((px, px), Image.LANCZOS)
            b, w = shots['000'].load(), shots['fff'].load()
            img = Image.new('RGBA', (px, px))
            o = img.load()
            for y in range(px):
                for x in range(px):
                    kb, kw = b[x, y], w[x, y]
                    a = max(0, min(255, 255 - round(sum(kw[i] - kb[i] for i in range(3)) / 3)))
                    o[x, y] = (0, 0, 0, 0) if a == 0 else tuple(min(255, round(kb[i] * 255 / a)) for i in range(3)) + (a,)
            out[name] = img
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return out


def board(size, pieces):
    sq = size // 8
    size = sq * 8
    img = Image.new('RGBA', (size, size))
    d = ImageDraw.Draw(img)
    rows = []
    for row in FEN.split('/'):
        r = []
        for ch in row:
            r.extend(['.'] * int(ch) if ch.isdigit() else [ch])
        rows.append(r)
    for r in range(8):
        for c in range(8):
            d.rectangle([c * sq, r * sq, (c + 1) * sq - 1, (r + 1) * sq - 1], fill=LIGHT if (r + c) % 2 == 0 else DARK)
            ch = rows[r][c]
            if ch != '.':
                name = ('w' if ch.isupper() else 'b') + ch.upper()
                img.alpha_composite(pieces[name].resize((sq, sq), Image.LANCZOS), (c * sq, r * sq))
    # the best-move arrow, drawn large and scaled down for smooth edges
    k = 4
    big = Image.new('RGBA', (size * k, size * k))
    bd = ImageDraw.Draw(big)
    centre = lambda s: (('abcdefgh'.index(s[0]) + 0.5) * sq * k, (8 - int(s[1]) + 0.5) * sq * k)
    (x0, y0), (x1, y1) = centre(ARROW[0]), centre(ARROW[1])
    head, width = sq * k * 0.5, sq * k * 0.2
    ux, uy = (x1 - x0), (y1 - y0)
    n = (ux * ux + uy * uy) ** 0.5
    ux, uy = ux / n, uy / n
    bx, by = x1 - ux * head, y1 - uy * head
    green = (21, 120, 27, 205)
    bd.line([(x0, y0), (bx, by)], fill=green, width=round(width))
    bd.polygon([(x1, y1), (bx - uy * head * 0.62, by + ux * head * 0.62), (bx + uy * head * 0.62, by - ux * head * 0.62)], fill=green)
    img.alpha_composite(big.resize((size, size), Image.LANCZOS))
    return img


def gradient(w, h):
    img = Image.new('RGB', (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = min(1, max(0, (x / w) * 0.55 + (y / h) * 0.45))
            px[x, y] = tuple(round(TEAL_HI[i] + (TEAL_LO[i] - TEAL_HI[i]) * t) for i in range(3))
    img = img.convert('RGBA')
    # a faint checkerboard fading in towards the bottom, like the icon
    sq = max(8, h // 9)
    over = Image.new('RGBA', (w, h))
    od = ImageDraw.Draw(over)
    for r in range(h // sq + 1):
        for c in range(w // sq + 1):
            if (r + c) % 2 == 0:
                a = round(26 * max(0, (r * sq - h * 0.35) / (h * 0.65)))
                od.rectangle([c * sq, r * sq, (c + 1) * sq - 1, (r + 1) * sq - 1], fill=(255, 255, 255, a))
    img.alpha_composite(over)
    return img


def shadow(base, box, radius, blur, alpha=110):
    s = Image.new('RGBA', base.size)
    ImageDraw.Draw(s).rounded_rectangle(box, radius, fill=(0, 20, 25, alpha))
    base.alpha_composite(s.filter(ImageFilter.GaussianBlur(blur)))


def player(base, x, y, bsize, pieces, u):
    """A video player showing the board, with an evaluation bar and a progress bar: "a chess video, analysed"."""
    pad, ev, gap, bar = round(10 * u), round(9 * u), round(7 * u), round(30 * u)
    w, h = pad + ev + gap + bsize + pad, pad + bsize + bar
    shadow(base, [x + 2 * u, y + 6 * u, x + w + 2 * u, y + h + 6 * u], round(14 * u), 8 * u)
    card = Image.new('RGBA', base.size)
    cd = ImageDraw.Draw(card)
    cd.rounded_rectangle([x, y, x + w, y + h], round(14 * u), fill=(14, 26, 32, 246))
    base.alpha_composite(card)
    d = ImageDraw.Draw(base)
    ex, ey = x + pad, y + pad
    d.rounded_rectangle([ex, ey, ex + ev, ey + bsize], round(3 * u), fill=(40, 44, 48))
    d.rounded_rectangle([ex, ey + round(bsize * 0.08), ex + ev, ey + bsize], round(3 * u), fill=(245, 245, 245))
    base.alpha_composite(board(bsize, pieces), (ex + ev + gap, ey))
    # play button and progress
    cy = y + pad + bsize + bar // 2
    tx = x + pad
    d.polygon([(tx, cy - 7 * u), (tx, cy + 7 * u), (tx + 12 * u, cy)], fill=(255, 255, 255))
    l0, l1 = tx + 22 * u, x + w - pad
    lm = l0 + (l1 - l0) * 0.62
    d.rounded_rectangle([l0, cy - 2 * u, l1, cy + 2 * u], round(2 * u), fill=(255, 255, 255, 90))
    d.rounded_rectangle([l0, cy - 2 * u, lm, cy + 2 * u], round(2 * u), fill=(108, 232, 205))
    d.ellipse([lm - 6 * u, cy - 6 * u, lm + 6 * u, cy + 6 * u], fill=(255, 255, 255))
    return w, h


def tile(w, h, pieces, art, tagline=None):
    u = h / 280
    img = gradient(w, h)
    bsize = round(176 * u) // 8 * 8
    pw = round(10 * u) * 2 + round(9 * u) + round(7 * u) + bsize
    ph = round(10 * u) + bsize + round(30 * u)
    px, py = w - pw - round(34 * u), (h - ph) // 2
    # brand block, centred in the space left of the player
    isz = min(round(112 * u), 128)  # the icon artwork is 128 px: never blow it up
    room = px - round(30 * u)
    tsize = round(40 * u)
    while True:
        title = font(tsize)
        tw = ImageDraw.Draw(img).textlength('Pawnshot', font=title)
        if tw <= room or tsize < 12:
            break
        tsize -= 1
    sub = font(round(17 * u), 'Bold') if tagline else None
    sw = ImageDraw.Draw(img).textlength(tagline, font=sub) if tagline else 0
    block_h = isz + round(14 * u) + round(44 * u) + (round(30 * u) if tagline else 0)
    cx = px / 2
    top = (h - block_h) // 2
    shadow(img, [cx - isz / 2, top + 5 * u, cx + isz / 2, top + isz + 5 * u], round(24 * u), 7 * u, 90)
    img.alpha_composite(art.resize((isz, isz), Image.LANCZOS), (round(cx - isz / 2), top))
    d = ImageDraw.Draw(img)
    ty = top + isz + round(10 * u)
    d.text((cx - tw / 2, ty + 2 * u), 'Pawnshot', font=title, fill=(0, 40, 45, 90))
    d.text((cx - tw / 2, ty), 'Pawnshot', font=title, fill=(255, 255, 255))
    if tagline:
        d.text((cx - sw / 2, ty + round(50 * u)), tagline, font=sub, fill=(225, 250, 244))
    player(img, px, py, bsize, pieces, u)
    return img.convert('RGB')


def main():
    os.makedirs(STORE, exist_ok=True)
    art_path = os.path.join(STORE, 'icon-art-128.png')
    if not os.path.exists(art_path):
        shutil.copy(os.path.join(ROOT, 'icons', '128.png'), art_path)
    art = Image.open(art_path).convert('RGBA')

    icon = Image.new('RGBA', (128, 128))
    icon.alpha_composite(art.resize((96, 96), Image.LANCZOS), (16, 16))
    icon.save(os.path.join(ROOT, 'icons', '128.png'))
    icon.save(os.path.join(STORE, 'icon-128.png'))

    pieces = render_pieces(200)
    tile(440, 280, pieces, art).save(os.path.join(STORE, 'promo-small-440x280.png'))
    tile(1400, 560, pieces, art, 'Follow chess videos move by move').save(os.path.join(STORE, 'promo-marquee-1400x560.png'))
    print('wrote icons/128.png, store/icon-128.png, store/promo-small-440x280.png, store/promo-marquee-1400x560.png')


if __name__ == '__main__':
    main()
