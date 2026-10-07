# Riley the dog: 3D model

A hand-built three.js model of Riley, made from four photos (October 2026).
Not a Boostie and not used in the app yet.

| File | What it is |
|---|---|
| `riley.js` | The model. `buildRiley(THREE, mergeVertices)` returns `{ root, clips }`. |
| `riley.glb` | The exported model (vertex colours, no textures, ~3.4 MB) with clips `idle`, `wag`, `tilt`. |
| `export.html`, `export.mjs` | Headless export: renders preview views and writes `riley.glb`. |
| `previews/` | Turnaround (front, 3/4, side, back, top, face) and animation stills. |

Why hand-built: the photo-to-3D route (`Blender designs/boosties/meshy_generate.py` or
`trellis_generate.py`) needs a Meshy key or Hugging Face access, and neither was
available in the cloud session. Running Meshy on a front photo of Riley later would
give a more realistic mesh.

## What comes from the photos

White coat; a brown saddle over the left flank and hip; brown patches on the right
shoulder and at the tail base; brown head sides with a white blaze; dark rims round big
dark eyes; a flat muzzle with a black nose and two underbite teeth; feathered brown ears
with black tips; a white plumed tail curled over the back; a pink vest harness with a
D-ring and a bone-shaped tag.

Named parts for animation: `head`, `ear_L/R`, `eye_L/R`, `tail`, `torso`, `tag_pivot`,
`leg_front_L/R`, `leg_back_L/R`, `harness` (hide it for a harness-free Riley).

## Re-export after editing `riley.js`

```
npm i --no-save three@0.169.0 playwright-core
python3 -m http.server 8765 &          # from the repo root
mkdir -p /tmp/riley && node tools/riley-3d/export.mjs /tmp/riley glb
cp /tmp/riley/riley.glb tools/riley-3d/
```

`export.mjs` needs Chromium (set `CHROME` to its path); it renders with SwiftShader, so
no GPU is needed.
