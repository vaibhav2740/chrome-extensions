#!/usr/bin/env python3
"""Screenshots and the demo video for the Chrome Web Store, at the exact size the store wants (macOS, Pillow).

    python3 scripts/store-shot.py size                      # make the front Chrome window the right size, once
    python3 scripts/store-shot.py 1-follow "The board follows the video, move by move"
    python3 scripts/store-shot.py 2-scan                    # no caption: the Chrome tab bar stays visible
    python3 scripts/store-shot.py video 45                  # 45 s screen recording of the window -> store/demo.mov

Each screenshot brings Chrome to the front, waits 4 seconds (--delay N to change), captures the window and saves
store/screenshots/<name>.png: 1280x800, no transparency, square corners (what the store asks for). A caption is drawn
as a band over Chrome's tab bar and address bar, so the page itself stays fully visible.

The first run asks for two macOS permissions for your terminal app: Screen Recording (System Settings > Privacy &
Security) and controlling Chrome (Automation). If a screenshot shows only the desktop, Screen Recording is still off.
"""
import os
import subprocess
import sys
import tempfile
import time

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'store', 'screenshots')
BROWSER = os.environ.get('PAWNSHOT_BROWSER', 'Google Chrome')
W, H = 1280, 800
LEFT, TOP, INSET = 0, 40, 6  # window position (points); the capture stays INSET inside it, clear of the round corners
BAND = 76  # caption band height in the final picture: about Chrome's tab bar + address bar


def osa(script):
    subprocess.run(['osascript', '-e', script], check=True)


def place_window():
    l, t = LEFT, TOP
    osa(f'tell application "{BROWSER}" to set bounds of front window to {{{l}, {t}, {l + W + 2 * INSET}, {t + H + 2 * INSET}}}')


def rect():
    return f'{LEFT + INSET},{TOP + INSET},{W},{H}'


def caption_band(img, text):
    from_ = (60, 196, 172)
    to = (10, 70, 78)
    band = Image.new('RGB', (W, BAND))
    px = band.load()
    for x in range(W):
        t = x / W
        c = tuple(round(from_[i] + (to[i] - from_[i]) * t) for i in range(3))
        for y in range(BAND):
            px[x, y] = c
    icon = Image.open(os.path.join(ROOT, 'store', 'icon-art-128.png')).convert('RGBA').resize((52, 52), Image.LANCZOS)
    band.paste(icon, (24, (BAND - 52) // 2), icon)
    f = ImageFont.truetype(os.path.join(ROOT, 'store', 'fonts', 'Nunito.ttf'), 34)
    f.set_variation_by_name('ExtraBold')
    d = ImageDraw.Draw(band)
    box = d.textbbox((0, 0), text, font=f)
    d.text((96, (BAND - (box[3] - box[1])) // 2 - box[1]), text, font=f, fill=(255, 255, 255))
    img.paste(band, (0, 0))
    return img


def shot(name, caption, delay):
    os.makedirs(OUT, exist_ok=True)
    place_window()
    osa(f'tell application "{BROWSER}" to activate')
    time.sleep(delay)
    tmp = tempfile.mktemp(suffix='.png')
    subprocess.run(['screencapture', '-x', '-R', rect(), tmp], check=True)
    img = Image.open(tmp).convert('RGB')
    os.remove(tmp)
    if img.size != (W, H):
        img = img.resize((W, H), Image.LANCZOS)  # a Retina screen captures at twice the size
    if caption:
        img = caption_band(img, caption)
    path = os.path.join(OUT, f'{name}.png')
    img.save(path)
    print(f'saved {os.path.relpath(path, ROOT)} ({W}x{H})')


def video(seconds, delay):
    place_window()
    osa(f'tell application "{BROWSER}" to activate')
    time.sleep(delay)
    path = os.path.join(ROOT, 'store', 'demo.mov')
    print(f'recording {seconds} s of the Chrome window...')
    subprocess.run(['screencapture', '-v', '-x', '-k', '-V', str(seconds), '-R', rect(), path], check=True)
    print(f'saved {os.path.relpath(path, ROOT)}: upload it to YouTube and paste the link in "Global promo video"')


def main(argv):
    delay = 4
    if '--delay' in argv:
        i = argv.index('--delay')
        delay = float(argv[i + 1])
        argv = argv[:i] + argv[i + 2:]
    if not argv:
        print(__doc__)
        return
    if argv[0] == 'size':
        place_window()
        print(f'{BROWSER} window set to {W}x{H} (plus a small margin). Set up the page, then take the shots.')
    elif argv[0] == 'video':
        video(int(argv[1]) if len(argv) > 1 else 45, delay)
    else:
        shot(argv[0], argv[1] if len(argv) > 1 else None, delay)


if __name__ == '__main__':
    main(sys.argv[1:])
