"""Build the app icons from the Blender ב tile: the Android launcher icons (adaptive
foreground / background / monochrome + legacy square and round), icon-512.png (web,
PWA manifest) and store_icon.png (Play listing). The tile is render/row_bet.png from
render_logo_tiles.py (git-ignored, re-render it first on a fresh clone).

    python "Blender designs/logo/make_app_icon.py"          # writes the icons
    python "Blender designs/logo/make_app_icon.py" <dir>    # previews into <dir> only
"""
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageChops

SRC = 'Blender designs/logo/render/row_bet.png'
OUT = sys.argv[1] if len(sys.argv) > 1 else None   # preview dir, or None = write repo

tile = Image.open(SRC).convert('RGBA')
tile = tile.crop(tile.getbbox())

def background(n):
    """Navy radial gradient with a soft cyan glow behind the tile."""
    bg = Image.new('RGBA', (n, n))
    inner, outer = (22, 46, 112), (5, 10, 36)
    px = bg.load()
    c = (n - 1) / 2
    for y in range(n):
        for x in range(n):
            d = min(1.0, (((x - c) ** 2 + (y - c) ** 2) ** 0.5) / (n * 0.72))
            px[x, y] = tuple(int(inner[i] + (outer[i] - inner[i]) * d) for i in range(3)) + (255,)
    glow = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    r = n * 0.30
    g.ellipse((c - r, c - r, c + r, c + r), fill=(80, 220, 255, 110))
    glow = glow.filter(ImageFilter.GaussianBlur(n * 0.09))
    return Image.alpha_composite(bg, glow)

def placed(n, frac):
    """The tile scaled so its height is frac*n, centred, on a transparent n×n canvas."""
    h = round(n * frac)
    w = round(tile.width * h / tile.height)
    t = tile.resize((w, h), Image.LANCZOS)
    canvas = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    shadow = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    a = t.getchannel('A').point(lambda v: v * 0.55)
    shadow.paste(Image.new('RGBA', t.size, (0, 0, 20, 255)), ((n - w) // 2, (n - h) // 2 + round(n * 0.025)), a)
    shadow = shadow.filter(ImageFilter.GaussianBlur(n * 0.02))
    canvas = Image.alpha_composite(canvas, shadow)
    canvas.alpha_composite(t, ((n - w) // 2, (n - h) // 2))
    return canvas

def letter_mask(n, frac):
    """Monochrome (themed) icon: the carved letter as a white silhouette."""
    h = round(n * frac)
    w = round(tile.width * h / tile.height)
    t = tile.resize((w, h), Image.LANCZOS)
    r, g, b, a = t.split()
    lum = Image.merge('RGB', (r, g, b)).convert('L')
    m = lum.point(lambda v: 255 if v < 120 else 0)
    m = ImageChops.multiply(m, a).filter(ImageFilter.MedianFilter(5))
    # Drop the dark outer shading at the rim: keep only the inner part of the tile.
    keep = Image.new('L', t.size, 0)
    ImageDraw.Draw(keep).rectangle((w * 0.12, h * 0.12, w * 0.88, h * 0.82), fill=255)
    m = ImageChops.multiply(m, keep)
    out = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    out.paste(Image.new('RGBA', t.size, (255, 255, 255, 255)), ((n - w) // 2, (n - h) // 2), m)
    return out

def rounded(img, radius_frac):
    n = img.width
    m = Image.new('L', (n, n), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, n - 1, n - 1), radius=n * radius_frac, fill=255)
    out = img.copy()
    out.putalpha(ImageChops.multiply(img.getchannel('A'), m))
    return out

def circle(img):
    n = img.width
    m = Image.new('L', (n, n), 0)
    ImageDraw.Draw(m).ellipse((0, 0, n - 1, n - 1), fill=255)
    out = img.copy()
    out.putalpha(m)
    return out

# Adaptive icon (108dp): launchers show the inner 72dp → tile height 50dp.
FG_FRAC = 50 / 108
# Legacy / web / store icons: the full square, tile at 70%.
FLAT_FRAC = 0.70

def flat(n):
    return Image.alpha_composite(background(n), placed(n, FLAT_FRAC))

DENS = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
RES = 'android/app/src/main/res'

if OUT:
    big = flat(512)
    big.save(f'{OUT}/preview_flat.png')
    # How a launcher shows the adaptive icon (squircle mask), plus the themed one.
    n = 432
    adaptive = Image.alpha_composite(background(n), placed(n, FG_FRAC))
    rounded(adaptive, 0.3).save(f'{OUT}/preview_adaptive.png')
    mono = Image.new('RGBA', (n, n), (40, 40, 48, 255))
    mono.alpha_composite(letter_mask(n, FG_FRAC))
    rounded(mono, 0.3).save(f'{OUT}/preview_mono.png')
    sys.exit()

for d, k in DENS.items():
    fg = round(108 * k)
    placed(fg, FG_FRAC).save(f'{RES}/mipmap-{d}/ic_launcher_foreground.webp', lossless=True)
    background(fg).save(f'{RES}/mipmap-{d}/ic_launcher_background.webp', lossless=True)
    letter_mask(fg, FG_FRAC).save(f'{RES}/mipmap-{d}/ic_launcher_monochrome.webp', lossless=True)
    leg = round(48 * k)
    f = flat(leg * 4).resize((leg, leg), Image.LANCZOS)
    rounded(f, 0.18).save(f'{RES}/mipmap-{d}/ic_launcher.webp', lossless=True)
    circle(f).save(f'{RES}/mipmap-{d}/ic_launcher_round.webp', lossless=True)

flat(512).save('icon-512.png')          # web / PWA manifest (maskable: tile inside the 80% zone)
flat(512).convert('RGB').save('store_icon.png')   # Play Console store listing icon (512, no alpha)
print('written')
