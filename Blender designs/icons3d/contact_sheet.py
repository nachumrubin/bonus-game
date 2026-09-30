"""Build contact_sheet.png from the preview renders in out/."""
from PIL import Image, ImageDraw
import glob
ps = sorted(p for p in glob.glob('out/*/*.png') if not p.endswith('_tex.png'))
T, cols = 180, 10
rows = (len(ps) + cols - 1) // cols
sheet = Image.new('RGB', (cols * T, rows * (T + 14)), (40, 44, 60)); d = ImageDraw.Draw(sheet)
for i, p in enumerate(ps):
    im = Image.open(p).convert('RGBA').resize((T, T)); x, y = (i % cols) * T, (i // cols) * (T + 14)
    sheet.paste(im, (x, y), im); d.text((x + 3, y + T), str(i), fill=(220, 220, 220))
sheet.save('contact_sheet.png')
