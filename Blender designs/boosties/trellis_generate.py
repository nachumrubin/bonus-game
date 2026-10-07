"""Generate a Boostie level mesh with TRELLIS (Hugging Face Space) from 3D reference views.

Plain Python (not Blender). Needs `pip install gradio_client` and a Hugging Face login
(`hf auth login`; a free account gets a few GPU minutes a day, about 1–2 runs).

  # one 3D reference sheet with N views side by side, split into equal columns:
  python trellis_generate.py sources/zapi_l3_trellis.glb sources/zapi_l3_turnaround.png --split 4

  # separate view images (front first):
  python trellis_generate.py sources/zapi_l3_trellis.glb front.png side.png back.png

  # a single front-facing image:
  python trellis_generate.py sources/zapi_l3_trellis.glb sources/zapi_l3_ref_a.png

With more than one view TRELLIS runs in multi-image mode, so it doesn't have to invent
the hidden side of the character (extra ears, smeared far eyes).
"""
import argparse
import os
import shutil
import time

from gradio_client import Client, handle_file
from huggingface_hub import get_token

ap = argparse.ArgumentParser()
ap.add_argument("out", help="output .glb path")
ap.add_argument("images", nargs="+", help="view image(s); front view first")
ap.add_argument("--split", type=int, default=0, help="split a single sheet into N equal columns")
ap.add_argument("--seed", type=int, default=0)
ap.add_argument("--algo", default="stochastic", choices=["stochastic", "multidiffusion"])
ap.add_argument("--texture", type=int, default=2048)
ap.add_argument("--space", default="trellis-community/TRELLIS")
a = ap.parse_args()

views = a.images
if a.split > 1:
    from PIL import Image
    sheet = Image.open(a.images[0]).convert("RGB")
    w = sheet.width // a.split
    base = os.path.splitext(a.out)[0]
    views = []
    for i in range(a.split):
        p = f"{base}_view{i}.png"
        sheet.crop((i * w, 0, (i + 1) * w, sheet.height)).save(p)
        views.append(p)
    print("split into", views)

c = Client(a.space, token=get_token(), verbose=False)
t0 = time.time()
c.predict(api_name="/start_session")
params = dict(seed=a.seed, ss_guidance_strength=7.5, ss_sampling_steps=12, slat_guidance_strength=3.0,
              slat_sampling_steps=12, multiimage_algo=a.algo, mesh_simplify=0.95, texture_size=a.texture)
if len(views) == 1:
    c.predict(api_name="/lambda")                                  # single-image tab
    pre = c.predict(handle_file(views[0]), api_name="/preprocess_image")
    r = c.predict(image=handle_file(pre), multiimages=[], api_name="/generate_and_extract_glb", **params)
else:
    c.predict(api_name="/lambda_1")                                # multi-image tab
    gallery = c.predict([{"image": handle_file(v), "caption": None} for v in views], api_name="/preprocess_images")
    multi = [{"image": handle_file(g["image"]), "caption": None} for g in gallery]
    r = c.predict(image=multi[0]["image"], multiimages=multi, api_name="/generate_and_extract_glb", **params)
glb = r[2] if isinstance(r[2], str) else r[1]
shutil.copy(glb, a.out)
print(f"saved {a.out} ({os.path.getsize(a.out) // 1024} KB) in {time.time() - t0:.0f} s from {len(views)} view(s)")
