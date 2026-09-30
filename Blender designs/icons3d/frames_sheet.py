"""Preview sheet of one asset's atlas frames: python frames_sheet.py <frames_dir> <out.png>"""
import sys, json, os
from PIL import Image, ImageDraw
d, out = sys.argv[1], sys.argv[2]
meta = json.load(open(os.path.join(d, 'frames.json'), encoding='utf-8'))
T = 200; cols = 6; fr = meta['frames']; rows = (len(fr) + cols - 1) // cols
sheet = Image.new('RGB', (cols * T, rows * (T + 14)), (40, 44, 60)); dr = ImageDraw.Draw(sheet)
for i, f in enumerate(fr):
    im = Image.open(os.path.join(d, f['file'])).convert('RGBA'); im.thumbnail((T, T))
    x, y = (i % cols) * T, (i // cols) * (T + 14)
    sheet.paste(im, (x, y), im); dr.text((x + 3, y + T), f['name'], fill=(220, 220, 220))
sheet.save(out)
