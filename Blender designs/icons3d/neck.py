"""Neck detection shared by build_relief.py (Blender) and offline checks. Pure numpy."""
import numpy as np


def _central_widths(mask):
    h, w = mask.shape
    top = mask[int(h * 0.6):]
    cx = int(np.round(np.average(np.arange(w), weights=top.sum(0)))) if top.any() else w // 2
    widths = np.zeros(h); centers = np.full(h, float(cx))
    for r in range(h):
        row = mask[r]
        if not row[cx]:
            continue
        a = cx
        while a > 0 and row[a - 1]:
            a -= 1
        b = cx
        while b < w - 1 and row[b + 1]:
            b += 1
        widths[r] = b - a + 1; centers[r] = (a + b) / 2
    return widths, centers


def find_neck(alpha):
    """alpha: 2D array, row 0 = BOTTOM. Returns (row fraction from bottom, column fraction).
    Busts: scan up from the shoulders to where the silhouette narrows to head width.
    Head-on-a-base shapes (robots): the narrowest row in the lower part."""
    mask = alpha > 0.5
    h, w = mask.shape
    widths, centers = _central_widths(mask)
    k = max(1, h // 40)
    sm = np.convolve(widths, np.ones(2 * k + 1) / (2 * k + 1), mode="same")
    rows = np.nonzero(sm > 0)[0]
    lo, hi = rows.min(), rows.max(); ch = hi - lo + 1
    head_w = np.median(sm[hi - int(ch * 0.35):hi - int(ch * 0.1) + 1])
    shoulder_w = np.median(sm[lo:lo + int(ch * 0.2) + 1])
    if shoulder_w > head_w * 1.2:
        thr = head_w + 0.3 * (shoulder_w - head_w)
        r = lo + int(ch * 0.15)
        while r < hi and sm[r] > thr:
            r += 1
        r = min(hi, r + int(ch * 0.02))
    else:
        a, b = lo + int(ch * 0.08), lo + int(ch * 0.45)
        r = a + int(np.argmin(sm[a:b]))
    # busts in this art style put the neck at 30-62% of the silhouette height; outside that
    # the detector latched onto hair/antennae — fall back to the typical 45%.
    rel = (r - lo) / ch
    if not 0.3 <= rel <= 0.62:
        r = lo + int(ch * 0.45)
    return (r + 0.5) / h, centers[r] / w


def neck_override(name, overrides):
    """overrides: {file stem: neck height as a fraction of the IMAGE height from the bottom}."""
    return overrides.get(name)
