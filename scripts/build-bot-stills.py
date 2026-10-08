"""Bot stills from the ChatGPT turnaround sheets with a transparent background
(Blender designs/boosties/sources/bot_<lvl>_sheet.png, and bot_<lvl>_head.png for the VS screen).

For each level, takes the front view (first of four panels), drops the stray specks around it and writes
  assets/avatars/bots/bot_<lvl>_full.webp   the whole bot, painted face (lists)
  assets/avatars/bots/bot_<lvl>_bust.webp   the head image, for the VS screen
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

def clean_alpha(alpha, panel_w):
    """Keep the figure of the first panel: big pieces only (the sheet has fringe specks)."""
    solid = alpha > 40
    lab, n = ndi.label(solid)
    keep = []
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        if len(ys) > 400 and xs.mean() < panel_w * 1.02:
            keep.append(i)
    mask = np.isin(lab, keep)
    mask = ndi.binary_fill_holes(mask) | mask
    soft = ndi.binary_dilation(mask, iterations=2)       # keep the anti-aliased edge
    return np.where(soft, alpha, 0).astype(np.uint8), mask

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
    comp = ndi.binary_closing(comp, iterations=6)       # a glyph touching the edge is not a hole yet
    return ndi.binary_fill_holes(comp), dark

for lvl in ('easy', 'medium', 'hard'):
    sheet = np.array(Image.open(os.path.join(SRC, f'bot_{lvl}_sheet.png')).convert('RGBA'))
    pw = sheet.shape[1] // 4
    panel = sheet[:, :int(pw * 1.1)]
    rgb = panel[..., :3].copy()
    alpha, fg = clean_alpha(panel[..., 3], pw)
    scr, dark = screen_of(rgb, fg)
    # blank the glyphs: anything in the glass that is brighter than the glass itself (and its glow)
    inner = ndi.binary_erosion(scr, iterations=3)
    lum = rgb.astype(np.float32).mean(axis=2)
    glyph = inner & (lum > np.percentile(lum[inner], 55) + 18)
    glyph = ndi.binary_dilation(glyph, iterations=7) & inner
    blank = cv2.inpaint(rgb, (glyph * 255).astype(np.uint8), 9, cv2.INPAINT_TELEA)
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
    # VS-screen bust: the supplied head image, on a square canvas, bottom-aligned
    head = Image.open(os.path.join(SRC, f'bot_{lvl}_head.png')).convert('RGBA')
    bb = head.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()
    head = head.crop(bb)
    k = 248 / max(head.size)
    head = head.resize((round(head.width * k), round(head.height * k)), Image.LANCZOS)
    sq = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
    sq.paste(head, ((256 - head.width) // 2, 256 - head.height - 4), head)
    sq.save(os.path.join(OUT, f'bot_{lvl}_bust.webp'), quality=92, method=6)
    sy, sx = np.where(scr)
    r = [(sx.min() - x0) * scale + ox, (sy.min() - y0) * scale + oy, (sx.max() + 1 - x0) * scale + ox, (sy.max() + 1 - y0) * scale + oy]
    print(lvl, json.dumps({'screen': [round(v / CANVAS, 4) for v in r]}))
