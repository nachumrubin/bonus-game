# icons3d — 2.5D relief models + pose atlases for achievements & avatars

`build_relief.py` turns each PNG in `assets/achievements`, `assets/avatars_v2/*`, `assets/avatars`
into an inflated, closed 3D mesh (rounded rim + dome + light emboss from the art), textured with the
original image, parented under an animated root empty. Busts (avatars) also get an automatic
2-bone rig (`chest` → `head`, soft neck blend) so they can nod, tilt, lean and breathe.

## Rebuild (headless, doesn't touch any open Blender session)

```bash
"/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python "Blender designs/icons3d/build_relief.py" -- "Blender designs/icons3d/out" --atlas assets/achievements assets/avatars_v2 assets/avatars
python "Blender designs/icons3d/pack_atlas.py"
```

~35 min with `--atlas` (models only: ~3 min). Inputs can be PNG files, folders, or `@list.txt`
(UTF-8, one path per line). `pack_atlas.py` writes the app assets: `assets/anim/**.webp` + `manifest.json`.

## Output — `out/<category>/<name>.*`

| File | Use |
|------|-----|
| `.glb` | Web model with clips `idle`, `reveal`, `celebrate` (not used by the app today) |
| `.blend` | Editable scene: `<name>_root` (NLA clips) → `<name>_rig` (busts) → mesh |
| `.png` | 512² preview render |
| `_tex.png` | Texture with colours bled past the outline |
| `_frames/` | Pose-atlas frames + `frames.json` (input to `pack_atlas.py`) |

Root-local axes: X = width, Y = height, Z = depth (root is rotated 90° on X to stand upright).

## Pose atlases (what the app plays)

Poses are defined in `BUST_POSES` / `OBJECT_POSES` in `build_relief.py`; the app's clips
(`src/ui/avatarMotion/poseClips.js`) blend between them and add CSS motion. The camera frames the
**original** PNG rectangle, so frame `rest` lines up with the source image exactly.

- Bust: `rest`, `yaw±4/8/12`, `lean-5/+5/+10`, `nod+6/+12`, `tilt±7`, `breath+1/+2` (16 frames, 320 px)
- Object: `rest`, `yaw±5…30`, `sweep+1…8` metallic light sweep (21 frames, 384 px)

## Neck detection

`neck.py` finds the shoulder line; `neck_overrides.json` fixes assets where it can't (robots).
Check all busts visually by drawing the detected line (see the snippet in git history / session).

## Dev preview

`python tools/avatar-motion/nocache_server.py 8766` then open
`http://localhost:8766/tools/avatar-motion/preview.html` — every clip on every asset.

## Tunables (top of `build_relief.py`)

`GRID` mesh resolution, `EDGE_DEPTH`/`EDGE_RADIUS` rim, `DOME_DEPTH` bulge, `DETAIL_DEPTH` emboss,
`BACK_SCALE` back flatness, `MIN_ISLAND` sparkle removal, `CELL_BUST`/`CELL_OBJECT` atlas cell size.
