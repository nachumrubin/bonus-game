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
    # Two backdrop bits the border flood cannot reach, because the floor shadow (darker than the
    # backdrop) walls them off: the shadow itself, and the gap between the legs. The shadow is the
    # unsaturated mid-grey in the last rows under the soles; the gap is the same grey between the
    # two coloured soles, from the hips down.
    hsv = cv2.cvtColor(blur, cv2.COLOR_RGB2HSV)
    greyish = (hsv[..., 1] < 34) & (hsv[..., 2] >= 105) & (hsv[..., 2] <= 206)
    ys_ = np.where(fg.any(axis=1))[0]
    top_, bot_ = ys_.min(), ys_.max()
    floor = np.zeros_like(fg)
    floor[int(top_ + 0.9 * (bot_ - top_)):] = True
    fg &= ~(floor & greyish & (hsv[..., 2] <= 190))
    bot_ = np.where(fg.any(axis=1))[0].max()
    sole = (hsv[..., 1] > 90) & fg
    cols = sole[bot_ - 22:bot_ - 4].any(axis=0)
    runs, start = [], None
    for x_, on in enumerate(np.append(cols, False)):
        if on and start is None: start = x_
        if not on and start is not None: runs.append((start, x_)); start = None
    runs = sorted(sorted(runs, key=lambda r: r[1] - r[0])[-2:])
    if len(runs) == 2:
        gx0, gx1 = runs[0][1], runs[1][0]
        # the gap starts at the top of the dark thigh joints (below the belly) and runs to the soles
        dark_joint = (hsv[..., 2] < 105) & (hsv[..., 1] < 70) & fg
        rows = np.where(dark_joint[int(top_ + 0.5 * (bot_ - top_)):].sum(axis=1) > 6)[0]
        gy0 = int(top_ + 0.5 * (bot_ - top_)) + (rows.min() if len(rows) else int(0.2 * (bot_ - top_)))
        gy0 += int(0.03 * (bot_ - top_))
        pale = (hsv[..., 1] < 28) & (hsv[..., 2] >= 105) & (hsv[..., 2] <= 226)   # backdrop, lit by the boots
        box = np.zeros_like(fg)
        box[gy0:bot_ + 1, gx0:gx1] = True
        fg &= ~ndi.binary_dilation(box & pale, iterations=1)
    fg = ndi.binary_closing(fg, iterations=2)
    # fill only small pinholes; a big enclosed hole is backdrop, not part of the bot
    holes = ndi.binary_fill_holes(fg) & ~fg
    hl, hn = ndi.label(holes)
    for i in range(1, hn + 1):
        if (hl == i).sum() < 150:
            fg |= hl == i
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
    sy, sx = np.where(scr)
    r = [(sx.min() - x0) * scale + ox, (sy.min() - y0) * scale + oy, (sx.max() + 1 - x0) * scale + ox, (sy.max() + 1 - y0) * scale + oy]
    # bust: framed from the screen so all three bots read alike (the Hard bot's framing): from the
    # top of the antenna to just under the chest-top, centred on the screen
    top = oy
    bottom = r[3] + 0.9 * (r[3] - r[1])
    side = int(bottom - top)
    cx = int((r[0] + r[2]) / 2)
    crop = full.crop((cx - side // 2, top, cx - side // 2 + side, top + side)).resize((256, 256), Image.LANCZOS)
    crop.save(os.path.join(OUT, f'bot_{lvl}_bust.webp'), quality=92, method=6)
    print(lvl, json.dumps({'screen': [round(v / CANVAS, 4) for v in r], 'glass': [int(c) for c in glass]}))
