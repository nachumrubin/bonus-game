"""Generate a Boostie level mesh with Meshy (image to 3D) from reference views.

Plain Python (not Blender), standard library only. Needs a Meshy Pro (or higher) API key
in the MESHY_API_KEY environment variable. Never paste the key into chat or a repo file:

  setx MESHY_API_KEY "msy_..."        (Windows, once; then open a new terminal)

  # the multi-angle reference sheet, split into N columns (front first):
  python meshy_generate.py sources/zapi_l3_meshy.glb sources/zapi_l3_turnaround.png --split 4

  # separate views, front first (up to 4), or a single front image:
  python meshy_generate.py sources/zapi_l3_meshy.glb front.png side.png back.png
  python meshy_generate.py sources/zapi_l4_meshy.glb sources/zapi_l4.png

  # resume a task that is already running (e.g. the terminal was closed); no new credits:
  python meshy_generate.py sources/zapi_l3_meshy.glb --task <id> [--multi]

The base-colour texture and a front preview are saved next to the .glb. One task costs
about 30 credits (Pro: 1000 a month).
"""
import argparse
import base64
import json
import mimetypes
import os
import sys
import time
import urllib.request

API = "https://api.meshy.ai/openapi/v1"

ap = argparse.ArgumentParser()
ap.add_argument("out", help="output .glb path")
ap.add_argument("images", nargs="*", help="view image(s); front view first")
ap.add_argument("--split", type=int, default=0, help="split a single sheet into N columns (cuts snap to empty gaps)")
ap.add_argument("--model", default="latest", help="ai_model: latest, meshy-7.1, meshy-6, meshy-6-lite")
ap.add_argument("--polycount", type=int, default=30000, help="target triangles after remesh")
ap.add_argument("--texture", default="2k", choices=["2k", "4k"])
ap.add_argument("--prompt", default="", help="optional texture guidance (max 800 chars)")
ap.add_argument("--task", help="resume: wait for this existing task id and download it (no new credits)")
ap.add_argument("--multi", action="store_true", help="with --task: it is a multi-image task")
a = ap.parse_args()

KEY = os.environ.get("MESHY_API_KEY")
if not KEY:
    sys.exit("MESHY_API_KEY is not set (see the header of this script)")

if not a.images and not a.task:
    ap.error("give view image(s), or --task to resume")
views = a.images
if a.split > 1:
    import numpy as np
    from PIL import Image
    sheet = Image.open(a.images[0]).convert("RGB")
    w = sheet.width // a.split
    # equal columns can slice a tail that reaches past its column: move each cut to the
    # emptiest pixel column (fewest non-background pixels) within 12% of the width
    px = np.asarray(sheet).astype(int)
    bg = np.median(px[:5].reshape(-1, 3), axis=0)
    fg = (np.abs(px - bg).sum(2) > 40).sum(0)
    near = int(w * 0.12)
    cuts = [0] + [min(range(i * w - near, i * w + near), key=lambda x: (fg[x], abs(x - i * w)))
                  for i in range(1, a.split)] + [sheet.width]
    base = os.path.splitext(a.out)[0]
    views = []
    for i in range(a.split):
        p = f"{base}_view{i}.png"
        sheet.crop((cuts[i], 0, cuts[i + 1], sheet.height)).save(p)
        views.append(p)
    print("cuts at", cuts[1:-1], "(foreground pixels:", [int(fg[c]) for c in cuts[1:-1]], ")")
    print("split into", views)
views = views[:4]


def data_uri(path):
    mime = mimetypes.guess_type(path)[0] or "image/png"
    with open(path, "rb") as f:
        return f"data:{mime};base64," + base64.b64encode(f.read()).decode()


def call(method, url, body=None):
    req = urllib.request.Request(url, method=method, headers={"Authorization": f"Bearer {KEY}",
                                                              "Content-Type": "application/json"},
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"Meshy {e.code}: {e.read().decode(errors='replace')[:400]}")


def fetch(url, path):
    with urllib.request.urlopen(url, timeout=300) as r, open(path, "wb") as f:
        f.write(r.read())


common = dict(ai_model=a.model, should_texture=True, enable_pbr=False, texture_resolution=a.texture,
              should_remesh=True, topology="triangle", target_polycount=a.polycount,
              target_formats=["glb"])
if a.prompt:
    common["texture_prompt"] = a.prompt[:800]
if a.task:
    kind, body = ("multi-image-to-3d" if a.multi else "image-to-3d"), None
elif len(views) == 1:
    kind, body = "image-to-3d", dict(image_url=data_uri(views[0]), **common)
else:
    kind, body = "multi-image-to-3d", dict(image_urls=[data_uri(v) for v in views], **common)

t0 = time.time()
task = a.task or call("POST", f"{API}/{kind}", body)["result"]
print(f"{kind} task {task} ({'resumed' if a.task else f'{len(views)} view(s), model {a.model}'})", flush=True)
last = -1
while True:
    t = call("GET", f"{API}/{kind}/{task}")
    if t["status"] == "SUCCEEDED":
        break
    if t["status"] in ("FAILED", "CANCELED"):
        sys.exit(f"task {t['status']}: {t.get('task_error', {}).get('message', '')}")
    if t.get("progress", 0) != last:
        last = t.get("progress", 0)
        print(f"  {t['status'].lower()} {last}%  ({time.time() - t0:.0f} s)", flush=True)
    if time.time() - t0 > 1800:
        sys.exit(f"no result after 30 min; task {task} is still {t['status']} (check it on meshy.ai)")
    time.sleep(8)

fetch(t["model_urls"]["glb"], a.out)
base = os.path.splitext(a.out)[0]
for tex in t.get("texture_urls") or []:
    if tex.get("base_color"):
        fetch(tex["base_color"], base + "_basecolor.png")
if t.get("thumbnail_url"):
    fetch(t["thumbnail_url"], base + "_preview.png")
print(f"saved {a.out} ({os.path.getsize(a.out) // 1024} KB) in {time.time() - t0:.0f} s, "
      f"{t.get('consumed_credits', '?')} credits")
