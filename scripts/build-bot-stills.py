"""Bot stills from the ChatGPT turnaround sheets (Blender designs/boosties/sources/bot_<lvl>_sheet.png).

For each level, takes the front view (first of four panels), cuts it out of the grey backdrop and writes
  assets/avatars/bots/bot_<lvl>_full.webp   the whole bot, painted face (VS screen, lists)
  assets/avatars/bots/bot_<lvl>_bust.webp   head and chest crop of the same
  assets/avatars/bots/bot_<lvl>_blank.webp  the whole bot with the screen face removed: the game
                                            scoreboard draws live faces over it (botFace.js)
and prints the screen rectangle (512-px canvas) for src/ui/boostie3d/botFace.js.
Run: python scripts/build-bot-stills.py
"""
import json, os
import cv2, numpy as np
from scipy import ndimage as ndi
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'Blender designs', 'boosties', 'sources')
OUT = os.path.join(ROOT, 'assets', 'avatars', 'bots')
CANVAS, FIT_H = 512, 486

def cutout(rgb):
    h, w = rgb.shape[:2]
    blur = cv2.GaussianBlur(rgb, (0, 0), 0.8)
    bg = np.zeros((h + 2, w + 2), np.uint8)
    # The backdrop is a soft gradient: flood from many border seeds, each with a small fixed
    # tolerance around its own colour, so the white plastic (a little brighter) is not reached.
    flags = 4 | cv2.FLOODFILL_MASK_ONLY | cv2.FLOODFILL_FIXED_RANGE | (255 << 8)
    seeds = [(x, 2) for x in range(2, w - 2, 30)] + [(x, h - 3) for x in range(2, w - 2, 30)]           + [(2, y) for y in range(2, h - 2, 30)] + [(w - 3, y) for y in range(2, h - 2, 30)]
    for seed in seeds:
        cv2.floodFill(blur.copy(), bg, seed, 0, (9,) * 3, (9,) * 3, flags)
    fg = (bg[1:-1, 1:-1] == 0)
    lab, n = ndi.label(fg)
    if n > 1:   # keep every big piece (the head and body can be split at the neck), drop specks
        sizes = ndi.sum(fg, lab, range(1, n + 1))
        keep = [i + 1 for i, sz in enumerate(sizes) if sz > 0.05 * sizes.max()]
        fg = np.isin(lab, keep)
    fg = ndi.binary_closing(fg, iterations=3)
    fg = ndi.binary_fill_holes(fg)
    fg = ndi.binary_erosion(fg, iterations=1)
    a = cv2.GaussianBlur(fg.astype(np.float32), (0, 0), 0.9)
    return np.clip(a * 255, 0, 255).astype(np.uint8), fg

def screen_of(rgb, fg):
    """The dark head screen: dark pixels in the upper part, holes filled (the face glyphs)."""
    ys, xs = np.where(fg)
    top, bot = ys.min(), ys.max()
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    dark = (hsv[..., 2] < 95) & fg
    dark[int(top + (bot - top) * 0.55):] = False
    lab, n = ndi.label(dark)
    sizes = ndi.sum(dark, lab, range(1, n + 1))
    comp = lab == (1 + int(np.argmax(sizes)))
    # a face glyph touching the edge of the dark area would not be a hole: close it
    comp = ndi.binary_closing(comp, iterations=6)
    return ndi.binary_fill_holes(comp), dark

for lvl in ('easy', 'medium', 'hard'):
    sheet = np.array(Image.open(os.path.join(SRC, f'bot_{lvl}_sheet.png')).convert('RGB'))
    pw = sheet.shape[1] // 4
    rgb = sheet[:, :pw]
    alpha, fg = cutout(rgb)
    scr, dark = screen_of(rgb, fg)
    # blank the glyphs: inside the screen, anything that is not the dark glass becomes the glass colour
    glass = np.median(rgb[dark & scr], axis=0)
    blank = rgb.copy()
    inner = ndi.binary_erosion(scr, iterations=3)
    # glyphs = anything in the glass that is brighter than the glass itself (incl. glow halos)
    lum = rgb.astype(np.float32).mean(axis=2)
    glyph = inner & (lum > np.percentile(lum[inner], 55) + 18)
    glyph = ndi.binary_dilation(glyph, iterations=7) & inner
    blank = cv2.inpaint(blank, (glyph * 255).astype(np.uint8), 9, cv2.INPAINT_TELEA)
    ys, xs = np.where(fg)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    scale = FIT_H / (y1 - y0)
    def place(img_rgb):
        rgba = np.dstack([img_rgb, alpha])[y0:y1, x0:x1]
        im = Image.fromarray(rgba, 'RGBA')
        im = im.resize((max(1, round(im.width * scale)), FIT_H), Image.LANCZOS)
        cv = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
        ox, oy = (CANVAS - im.width) // 2, CANVAS - FIT_H - 8
        cv.paste(im, (ox, oy), im)
        return cv, ox, oy
    full, ox, oy = place(rgb)
    blankim, _, _ = place(blank)
    full.save(os.path.join(OUT, f'bot_{lvl}_full.webp'), quality=92, method=6)
    blankim.save(os.path.join(OUT, f'bot_{lvl}_blank.webp'), quality=92, method=6)
    # bust: the head and chest, as a square from the top of the antenna
    side = int(FIT_H * 0.56)
    cx = CANVAS // 2
    crop = full.crop((cx - side // 2, oy, cx + side // 2, oy + side)).resize((256, 256), Image.LANCZOS)
    crop.save(os.path.join(OUT, f'bot_{lvl}_bust.webp'), quality=92, method=6)
    sy, sx = np.where(scr)
    r = [(sx.min() - x0) * scale + ox, (sy.min() - y0) * scale + oy, (sx.max() + 1 - x0) * scale + ox, (sy.max() + 1 - y0) * scale + oy]
    print(lvl, json.dumps({'screen': [round(v / CANVAS, 4) for v in r], 'glass': [int(c) for c in glass]}))
