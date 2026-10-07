"""Boostie level → game-ready .glb, from an image-to-3D mesh (Meshy; TRELLIS as a fallback).

The generator turns a level's 3D reference views into one textured mesh with no rig.
It paints the eyes on and paints the cyan parts dull; TRELLIS also builds surfaces from
flat planes (Meshy's are already smooth, so Meshy levels set smooth.enabled = False). Every level gets the same upgrades here (the boostie-evolution skill, part 2):

  1. smooth rebuild  — thicken thin parts, voxel-fuse, relax, reduce to ~19k faces,
                       copy the painting across texel by texel (`smooth`)
  2. glow            — teal/cyan texels on the tail and core repainted as glowing cyan,
                       with an emission map and glow-sprite anchors (`core`)
  3. rig + weights   — small armature from the level's bone list; weights by distance in
                       units of each bone's thickness, so the head owns the whole face
  4. real eyes       — glossy eyeballs + upper lids on their own bones (`eyes`); the app
                       makes them blink, glance and change with the mood
  5. mouth           — the muzzle cut along the mouth line, a `jaw` bone and a dark inner
                       skin, so the mouth really opens (`mouth`)
  6. clips           — idle, turn, good, boost (shared) + the character's own
                       `signature` movement (SIGNATURES, e.g. Zapi's ear twitch)

then exports <key>.glb (recentred on the body) and renders previews into out/<key>/.

Run (one level per call):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup \
    --python "Blender designs/boosties/build_boostie.py" -- zapi_l3 ["Blender designs/boosties/out"]

Adding a level: generate the mesh with meshy_generate.py, normalise it to a longest side of
1.0 with normalize_glb.py into sources/, run measure.py
for the gridded views, read off joints / core / pupils, and add a LEVELS entry.
Bone coordinates are in the source mesh's own space (before grounding).
"""
import math
import os
import sys
import time

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCES = os.path.join(HERE, "sources")

# name, head, tail, parent, roll-towards ((0,-1,0) for upright bones, (0,0,1) for level ones)
UP, FWD = (0, -1, 0), (0, 0, 1)
LEVELS = {
    "zapi_l1": {   # Meshy, front/side/back views, normalised to 1.0; quadruped kit (rig as zapi_l3)
        "src": "zapi_l1_meshy.glb",
        "smooth": {"enabled": False},
        "center": (0.0, -0.05),
        "core": (0.0, -0.32, -0.12),
        "eyes": {"R": (-0.076, 0.155), "L": (0.0775, 0.155), "r": 0.042, "show": 0.22,
                 "shape": {"width": 1.15, "open": 45}},   # big round baby eyes, wide open (no smug half-lid)
        "mouth": {"x": 0.0, "tip": (-0.45, 0.065), "corner": (-0.385, 0.090), "half": 0.06,
                  "hinge": (0.0, -0.33, 0.10)},
        "glow": {"sat_min": 0.28, "val_min": 0.05},
        "bones": [
            ("root",   (0.0, -0.05, -0.50), (0.0, -0.05, -0.38), None,     UP),
            ("hips",   (0.0, 0.10, -0.14),  (0.0, -0.08, -0.13), "root",   FWD),
            ("chest",  (0.0, -0.08, -0.13), (0.0, -0.25, -0.08), "hips",   FWD),
            ("neck",   (0.0, -0.25, -0.08), (0.0, -0.24, 0.06),  "chest",  FWD),
            ("head",   (0.0, -0.24, 0.06),  (0.0, -0.24, 0.32),  "neck",   UP),
            ("ear.L",  (0.09, -0.20, 0.30), (0.17, -0.20, 0.48), "head",   UP),
            ("ear.R",  (-0.09, -0.20, 0.30), (-0.17, -0.20, 0.48), "head", UP),
            ("tail.0", (0.0, 0.08, -0.08),  (0.0, 0.17, -0.16),  "hips",   FWD),
            ("tail.1", (0.0, 0.17, -0.16),  (0.0, 0.26, -0.16),  "tail.0", FWD),
            ("tail.2", (0.0, 0.26, -0.16),  (0.0, 0.34, -0.10),  "tail.1", FWD),
            ("tail.3", (0.0, 0.34, -0.10),  (0.0, 0.40, -0.02),  "tail.2", FWD),
            ("tail.4", (0.0, 0.40, -0.02),  (0.0, 0.44, 0.08),   "tail.3", FWD),
        ],
    },
    "zapi_l2": {   # Meshy, front/side/back views, normalised to 1.0; quadruped (rig as zapi_l1)
        "src": "zapi_l2_meshy.glb",
        "smooth": {"enabled": False},
        "center": (0.0, -0.05),
        "core": (0.0, -0.30, -0.10),
        "eyes": {"R": (-0.0725, 0.17), "L": (0.0725, 0.17), "r": 0.040, "show": 0.22,
                 "shape": {"width": 1.15, "open": 45}},   # round young eyes, wide open (as L1)
        "mouth": {"x": 0.0, "tip": (-0.44, 0.075), "corner": (-0.365, 0.105), "half": 0.05,
                  "hinge": (0.0, -0.31, 0.11)},
        "glow": {"sat_min": 0.28, "val_min": 0.05},
        "bones": [
            ("root",   (0.0, -0.05, -0.50), (0.0, -0.05, -0.38), None,     UP),
            ("hips",   (0.0, 0.14, -0.14),  (0.0, -0.07, -0.13), "root",   FWD),
            ("chest",  (0.0, -0.07, -0.13), (0.0, -0.24, -0.08), "hips",   FWD),
            ("neck",   (0.0, -0.24, -0.08), (0.0, -0.23, 0.06),  "chest",  FWD),
            ("head",   (0.0, -0.23, 0.06),  (0.0, -0.23, 0.32),  "neck",   UP),
            ("ear.L",  (0.09, -0.22, 0.30), (0.16, -0.22, 0.49), "head",   UP),
            ("ear.R",  (-0.09, -0.22, 0.30), (-0.16, -0.22, 0.49), "head", UP),
            ("tail.0", (0.0, 0.13, -0.08),  (0.0, 0.21, -0.16),  "hips",   FWD),
            ("tail.1", (0.0, 0.21, -0.16),  (0.0, 0.29, -0.15),  "tail.0", FWD),
            ("tail.2", (0.0, 0.29, -0.15),  (0.0, 0.36, -0.07),  "tail.1", FWD),
            ("tail.3", (0.0, 0.36, -0.07),  (0.0, 0.41, 0.04),   "tail.2", FWD),
            ("tail.4", (0.0, 0.41, 0.04),   (0.0, 0.43, 0.18),   "tail.3", FWD),
        ],
    },
    "zapi_l3": {   # Meshy, four-view turnaround, normalised to 1.0 (normalize_glb.py)
        "src": "zapi_l3_meshy.glb",
        "smooth": {"enabled": False},   # Meshy surfaces are already smooth; keep its UVs and painting
        "center": (0.0, 0.0),
        "core": (0.0, -0.41, -0.06),
        "eyes": {"R": (-0.057, 0.165), "L": (0.058, 0.165), "r": 0.021, "show": 0.22,
                 "shape": {"width": 1.3, "open": 14, "low": 38, "tilt": 12}},
        "mouth": {"x": 0.0, "tip": (-0.495, 0.106), "corner": (-0.445, 0.114), "half": 0.055,
                  "hinge": (0.0, -0.40, 0.13)},
        "glow": {"sat_min": 0.28, "val_min": 0.05},
        "bones": [
            ("root",   (0.0, -0.12, -0.45), (0.0, -0.12, -0.33), None,     UP),
            ("hips",   (0.0, 0.02, -0.05),  (0.0, -0.14, -0.03), "root",   FWD),
            ("chest",  (0.0, -0.14, -0.03), (0.0, -0.32, 0.00),  "hips",   FWD),
            ("neck",   (0.0, -0.32, 0.00),  (0.0, -0.35, 0.12),  "chest",  FWD),
            ("head",   (0.0, -0.35, 0.12),  (0.0, -0.37, 0.34),  "neck",   UP),
            ("ear.L",  (0.08, -0.35, 0.30), (0.13, -0.35, 0.45), "head",   UP),
            ("ear.R",  (-0.08, -0.35, 0.30), (-0.13, -0.35, 0.45), "head", UP),
            ("tail.0", (0.0, 0.02, -0.03),  (0.0, 0.12, -0.06),  "hips",   FWD),
            ("tail.1", (0.0, 0.12, -0.06),  (0.0, 0.24, -0.06),  "tail.0", FWD),
            ("tail.2", (0.0, 0.24, -0.06),  (0.0, 0.34, 0.00),   "tail.1", FWD),
            ("tail.3", (0.0, 0.34, 0.00),   (0.0, 0.40, 0.10),   "tail.2", FWD),
            ("tail.4", (0.0, 0.40, 0.10),   (0.0, 0.42, 0.24),   "tail.3", FWD),
        ],
    },
    "zapi_l3_trellis": {
        "src": "zapi_l3_trellis.glb",
        "center": (0.02, 0.0),          # body midline (x, y) to move onto the origin
        "core": (-0.02, -0.39, -0.10),  # chest core position: glow is only kept here and on the tail
        "head_yaw": -30,                # TRELLIS sculpted the head turned (as on the sheet): face it forward
        "glow": {"sat_min": 0.18, "val_min": 0.05},
        "bones": [
            ("root",   (0.02, -0.10, -0.42), (0.02, -0.10, -0.30), None,     UP),
            ("hips",   (0.02, 0.08, -0.04),  (0.02, -0.08, -0.02), "root",   FWD),
            ("chest",  (0.02, -0.08, -0.02), (0.01, -0.24, 0.00),  "hips",   FWD),
            ("neck",   (0.01, -0.24, 0.00),  (0.00, -0.30, 0.08),  "chest",  FWD),
            ("head",   (0.00, -0.30, 0.08),  (0.01, -0.32, 0.30),  "neck",   UP),
            ("ear.L",  (0.08, -0.27, 0.27),  (0.15, -0.25, 0.40),  "head",   UP),
            ("ear.R",  (-0.03, -0.36, 0.27), (-0.01, -0.40, 0.43), "head",   UP),
            ("tail.0", (0.03, 0.08, -0.02),  (0.05, 0.20, 0.06),   "hips",   FWD),
            ("tail.1", (0.05, 0.20, 0.06),   (0.07, 0.33, 0.10),   "tail.0", FWD),
            ("tail.2", (0.07, 0.33, 0.10),   (0.08, 0.44, 0.02),   "tail.1", FWD),
            ("tail.3", (0.08, 0.44, 0.02),   (0.08, 0.48, -0.12),  "tail.2", FWD),
            ("tail.4", (0.08, 0.48, -0.12),  (0.07, 0.45, -0.26),  "tail.3", FWD),
        ],
    },
    "zapi_l4": {   # Meshy, four-view turnaround, normalised to 1.0 (normalize_glb.py)
        "src": "zapi_l4_meshy.glb",
        "smooth": {"enabled": False},
        "center": (-0.12, -0.12),
        "core": (-0.12, -0.22, 0.11),
        "eyes": {"R": (-0.173, 0.285), "L": (-0.068, 0.284), "r": 0.020, "show": 0.22,
                 "shape": {"width": 1.3, "open": 14, "low": 38, "tilt": 12}},
        "mouth": {"x": -0.12, "tip": (-0.272, 0.232), "corner": (-0.225, 0.240), "half": 0.05,
                  "hinge": (-0.12, -0.175, 0.255)},
        "glow": {"sat_min": 0.28, "val_min": 0.05},
        "bones": [
            ("root",   (-0.12, -0.10, -0.50), (-0.12, -0.10, -0.38), None,    UP),
            ("hips",   (-0.12, -0.10, -0.15), (-0.12, -0.12, 0.00),  "root",  UP),
            ("chest",  (-0.12, -0.12, 0.00),  (-0.12, -0.14, 0.17),  "hips",  UP),
            ("neck",   (-0.12, -0.14, 0.17),  (-0.12, -0.15, 0.23),  "chest", UP),
            ("head",   (-0.12, -0.15, 0.23),  (-0.12, -0.15, 0.42),  "neck",  UP),
            ("ear.L",  (-0.04, -0.13, 0.36),  (0.00, -0.13, 0.49),   "head",  UP),
            ("ear.R",  (-0.19, -0.13, 0.36),  (-0.24, -0.13, 0.49),  "head",  UP),
            ("tail.0", (-0.04, 0.00, -0.13),  (0.06, 0.05, -0.24),   "hips",  FWD),
            ("tail.1", (0.06, 0.05, -0.24),   (0.18, 0.10, -0.26),   "tail.0", FWD),
            ("tail.2", (0.18, 0.10, -0.26),   (0.28, 0.16, -0.12),   "tail.1", FWD),
            ("tail.3", (0.28, 0.16, -0.12),   (0.30, 0.20, 0.05),    "tail.2", FWD),
            ("tail.4", (0.30, 0.20, 0.05),    (0.20, 0.22, 0.24),    "tail.3", FWD),
        ],
    },
    "zapi_l5": {   # Meshy, four-view turnaround, normalised to 1.0 (normalize_glb.py)
        "src": "zapi_l5_meshy.glb",
        "smooth": {"enabled": False},
        "center": (-0.04, -0.09),
        "core": (-0.04, -0.17, 0.12),
        "eyes": {"R": (-0.088, 0.291), "L": (0.009, 0.291), "r": 0.019, "show": 0.22,
                 "shape": {"width": 1.3, "open": 14, "low": 38, "tilt": 12}},
        "mouth": {"x": -0.04, "tip": (-0.237, 0.243), "corner": (-0.185, 0.250), "half": 0.045,
                  "hinge": (-0.04, -0.135, 0.265)},
        "glow": {"sat_min": 0.28, "val_min": 0.05},
        "bones": [
            ("root",   (-0.04, -0.08, -0.50), (-0.04, -0.08, -0.38), None,    UP),
            ("hips",   (-0.04, -0.08, -0.15), (-0.04, -0.09, -0.02), "root",  UP),
            ("chest",  (-0.04, -0.09, -0.02), (-0.04, -0.10, 0.15),  "hips",  UP),
            ("neck",   (-0.04, -0.10, 0.15),  (-0.04, -0.11, 0.21),  "chest", UP),
            ("head",   (-0.04, -0.11, 0.21),  (-0.04, -0.12, 0.42),  "neck",  UP),
            ("ear.L",  (0.03, -0.10, 0.37),   (0.08, -0.10, 0.50),   "head",  UP),
            ("ear.R",  (-0.12, -0.10, 0.37),  (-0.17, -0.10, 0.50),  "head",  UP),
            ("tail.0", (0.04, 0.00, -0.10),   (0.10, 0.05, -0.20),   "hips",  FWD),
            ("tail.1", (0.10, 0.05, -0.20),   (0.18, 0.10, -0.20),   "tail.0", FWD),
            ("tail.2", (0.18, 0.10, -0.20),   (0.26, 0.15, -0.08),   "tail.1", FWD),
            ("tail.3", (0.26, 0.15, -0.08),   (0.28, 0.18, 0.05),    "tail.2", FWD),
            ("tail.4", (0.28, 0.18, 0.05),    (0.22, 0.20, 0.15),    "tail.3", FWD),
        ],
    },
    "zapi_l6": {   # Meshy, front/side/back views (the 3/4 view merged the tails), normalised to 1.0
        "src": "zapi_l6_meshy.glb",
        "smooth": {"enabled": False},
        "cut": [((-0.15, 0.15), (0.03, 0.5), (-0.5, -0.03)),     # the fur tail Meshy kept between
                ((-0.07, 0.07), (-0.015, 0.5), (-0.25, -0.01))], # the energy tails, and its root
        "center": (0.0, -0.09),
        "core": (0.0, -0.11, 0.15),
        "eyes": {"R": (-0.037, 0.325), "L": (0.038, 0.325), "r": 0.019, "show": 0.22,
                 "shape": {"width": 1.3, "open": 14, "low": 38, "tilt": 12}},
        "mouth": {"x": 0.0, "tip": (-0.23, 0.278), "corner": (-0.19, 0.290), "half": 0.045,
                  "hinge": (0.0, -0.13, 0.29)},
        "glow": {"sat_min": 0.28, "val_min": 0.05},
        "bones": [
            ("root",    (0.0, -0.08, -0.50),  (0.0, -0.08, -0.38),  None,    UP),
            ("hips",    (0.0, -0.08, -0.12),  (0.0, -0.09, 0.02),   "root",  UP),
            ("chest",   (0.0, -0.09, 0.02),   (0.0, -0.10, 0.20),   "hips",  UP),
            ("neck",    (0.0, -0.10, 0.20),   (0.0, -0.11, 0.26),   "chest", UP),
            ("head",    (0.0, -0.11, 0.26),   (0.0, -0.12, 0.46),   "neck",  UP),
            ("ear.L",   (0.05, -0.10, 0.41),  (0.10, -0.10, 0.52),  "head",  UP),
            ("ear.R",   (-0.05, -0.10, 0.41), (-0.10, -0.10, 0.52), "head",  UP),
            ("tail.0",  (0.03, 0.00, -0.02),  (0.12, 0.06, -0.02),  "hips",  FWD),
            ("tail.1",  (0.12, 0.06, -0.02),  (0.22, 0.10, 0.04),   "tail.0", FWD),
            ("tail.2",  (0.22, 0.10, 0.04),   (0.27, 0.13, 0.13),   "tail.1", FWD),
            ("tail.3",  (0.27, 0.13, 0.13),   (0.26, 0.14, 0.22),   "tail.2", FWD),
            ("tail.4",  (0.26, 0.14, 0.22),   (0.20, 0.12, 0.30),   "tail.3", FWD),
            ("tailb.0", (-0.03, 0.00, -0.02), (-0.12, 0.06, -0.02), "hips",  FWD),
            ("tailb.1", (-0.12, 0.06, -0.02), (-0.22, 0.10, 0.04),  "tailb.0", FWD),
            ("tailb.2", (-0.22, 0.10, 0.04),  (-0.27, 0.13, 0.13),  "tailb.1", FWD),
            ("tailb.3", (-0.27, 0.13, 0.13),  (-0.26, 0.14, 0.22),  "tailb.2", FWD),
            ("tailb.4", (-0.26, 0.14, 0.22),  (-0.20, 0.12, 0.30),  "tailb.3", FWD),
        ],
    },
    "zapi_l7": {   # Meshy, front/side/back views (as L6), normalised to 1.0; two tails, no cut needed
        "src": "zapi_l7_meshy.glb",
        "smooth": {"enabled": False},
        "center": (0.0, -0.09),
        "core": (0.0, -0.11, 0.16),
        "eyes": {"R": (-0.034, 0.318), "L": (0.035, 0.318), "r": 0.019, "show": 0.22,
                 "shape": {"width": 1.3, "open": 14, "low": 38, "tilt": 12}},
        "mouth": {"x": 0.0, "tip": (-0.20, 0.265), "corner": (-0.17, 0.272), "half": 0.035,
                  "hinge": (0.0, -0.11, 0.275)},
        "glow": {"sat_min": 0.28, "val_min": 0.05},
        "bones": [
            ("root",    (0.0, -0.08, -0.50),  (0.0, -0.08, -0.38),  None,    UP),
            ("hips",    (0.0, -0.08, -0.12),  (0.0, -0.09, 0.02),   "root",  UP),
            ("chest",   (0.0, -0.09, 0.02),   (0.0, -0.10, 0.20),   "hips",  UP),
            ("neck",    (0.0, -0.10, 0.20),   (0.0, -0.11, 0.25),   "chest", UP),
            ("head",    (0.0, -0.11, 0.25),   (0.0, -0.12, 0.46),   "neck",  UP),
            ("ear.L",   (0.06, -0.10, 0.42),  (0.11, -0.11, 0.53),  "head",  UP),
            ("ear.R",   (-0.06, -0.10, 0.42), (-0.11, -0.11, 0.53), "head",  UP),
            ("tail.0",  (0.03, 0.00, -0.03),  (0.10, 0.05, -0.08),  "hips",  FWD),
            ("tail.1",  (0.10, 0.05, -0.08),  (0.17, 0.09, -0.13),  "tail.0", FWD),
            ("tail.2",  (0.17, 0.09, -0.13),  (0.23, 0.13, -0.12),  "tail.1", FWD),
            ("tail.3",  (0.23, 0.13, -0.12),  (0.26, 0.16, -0.05),  "tail.2", FWD),
            ("tail.4",  (0.26, 0.16, -0.05),  (0.24, 0.17, 0.03),   "tail.3", FWD),
            ("tailb.0", (-0.03, 0.00, -0.03), (-0.10, 0.05, -0.08), "hips",  FWD),
            ("tailb.1", (-0.10, 0.05, -0.08), (-0.17, 0.09, -0.13), "tailb.0", FWD),
            ("tailb.2", (-0.17, 0.09, -0.13), (-0.23, 0.13, -0.12), "tailb.1", FWD),
            ("tailb.3", (-0.23, 0.13, -0.12), (-0.26, 0.16, -0.05), "tailb.2", FWD),
            ("tailb.4", (-0.26, 0.16, -0.05), (-0.24, 0.17, 0.03),  "tailb.3", FWD),
        ],
    },
    "bubo_l1": {   # Meshy, front/side/back views, normalised to 1.0; upright owl chick
        "src": "bubo_l1_meshy.glb",
        "smooth": {"enabled": False},
        "center": (0.0, -0.08),
        "core": (0.0, -0.345, -0.086),
        "eyes": {"R": (-0.080, 0.198), "L": (0.0785, 0.198), "r": 0.054, "show": 0.50, "sink": 0.35,
                 "reach": 1.5, "socket": "E9D2B4",
                 "shape": {"width": 1.15, "open": 45}},   # big round chick eyes, wide open
        "mouth": {"x": 0.0, "tip": (-0.36, 0.13), "corner": (-0.33, 0.135), "half": 0.04,
                  "hinge": (0.0, -0.31, 0.14)},
        "glow": {"sat_min": 0.28, "val_min": 0.05},
        "glow_bones": [],   # L1 tufts are plain feathers: only the core glows
        "radii": {"head": 0.16, "wing.L": 0.05, "wing.R": 0.05},
        "bones": [
            ("root",   (0.0, -0.10, -0.50), (0.0, -0.10, -0.38), None,     UP),
            ("hips",   (0.0, -0.08, -0.36), (0.0, -0.10, -0.15), "root",   UP),
            ("chest",  (0.0, -0.10, -0.15), (0.0, -0.14, 0.04),  "hips",   UP),
            ("neck",   (0.0, -0.14, 0.04),  (0.0, -0.16, 0.10),  "chest",  UP),
            ("head",   (0.0, -0.16, 0.10),  (0.0, -0.18, 0.42),  "neck",   UP),
            ("ear.L",  (0.13, -0.17, 0.38), (0.20, -0.17, 0.50), "head",   UP),
            ("ear.R",  (-0.13, -0.17, 0.38), (-0.20, -0.17, 0.50), "head", UP),
            ("wing.L", (0.22, -0.12, 0.00), (0.29, 0.10, -0.32), "chest",  UP),
            ("wing.R", (-0.22, -0.12, 0.00), (-0.29, 0.10, -0.32), "chest", UP),
            ("tail.0", (0.0, 0.12, -0.22),  (0.0, 0.18, -0.26),  "hips",   FWD),
            ("tail.1", (0.0, 0.18, -0.26),  (0.0, 0.24, -0.30),  "tail.0", FWD),
            ("tail.2", (0.0, 0.24, -0.30),  (0.0, 0.29, -0.33),  "tail.1", FWD),
            ("tail.3", (0.0, 0.29, -0.33),  (0.0, 0.34, -0.37),  "tail.2", FWD),
            ("tail.4", (0.0, 0.34, -0.37),  (0.0, 0.39, -0.40),  "tail.3", FWD),
        ],
    },
    "bubo_l2": {   # Meshy, front/side/back views, normalised to 1.0; young owl, cyan tuft tips
        "src": "bubo_l2_meshy.glb",
        "smooth": {"enabled": False},
        "center": (0.0, -0.07),
        "core": (0.0, -0.27, -0.024),
        "eyes": {"R": (-0.053, 0.22), "L": (0.055, 0.22), "r": 0.040, "show": 0.50, "sink": 0.35,
                 "reach": 1.5, "socket": "E9D2B4",
                 "shape": {"width": 1.15, "open": 35}},   # round, a little less wide-eyed than L1
        "mouth": {"x": 0.0, "tip": (-0.26, 0.155), "corner": (-0.22, 0.168), "half": 0.035,
                  "hinge": (0.0, -0.20, 0.175)},
        "glow": {"sat_min": 0.28, "val_min": 0.05},
        "glow_bones": ["ear.L", "ear.R"],   # the cyan tuft tips
        "radii": {"head": 0.15, "wing.L": 0.05, "wing.R": 0.05},
        "bones": [
            ("root",   (0.0, -0.08, -0.50), (0.0, -0.08, -0.38), None,     UP),
            ("hips",   (0.0, -0.06, -0.36), (0.0, -0.07, -0.15), "root",   UP),
            ("chest",  (0.0, -0.07, -0.15), (0.0, -0.09, 0.06),  "hips",   UP),
            ("neck",   (0.0, -0.09, 0.06),  (0.0, -0.10, 0.12),  "chest",  UP),
            ("head",   (0.0, -0.10, 0.12),  (0.0, -0.12, 0.42),  "neck",   UP),
            ("ear.L",  (0.12, -0.08, 0.38), (0.19, -0.08, 0.50), "head",   UP),
            ("ear.R",  (-0.12, -0.08, 0.38), (-0.19, -0.08, 0.50), "head", UP),
            ("wing.L", (0.17, -0.10, 0.10), (0.25, 0.18, -0.38), "chest",  UP),
            ("wing.R", (-0.17, -0.10, 0.10), (-0.25, 0.18, -0.38), "chest", UP),
            ("tail.0", (0.0, 0.08, -0.22),  (0.0, 0.13, -0.27),  "hips",   FWD),
            ("tail.1", (0.0, 0.13, -0.27),  (0.0, 0.18, -0.32),  "tail.0", FWD),
            ("tail.2", (0.0, 0.18, -0.32),  (0.0, 0.22, -0.37),  "tail.1", FWD),
            ("tail.3", (0.0, 0.22, -0.37),  (0.0, 0.26, -0.41),  "tail.2", FWD),
            ("tail.4", (0.0, 0.26, -0.41),  (0.0, 0.30, -0.45),  "tail.3", FWD),
        ],
    },
    "bubo_l3": {   # Meshy, front/side/back views, normalised to 1.0; spectacles, cyan tuft tops
        "src": "bubo_l3_meshy.glb",
        "smooth": {"enabled": False},
        "center": (0.0, -0.06),
        "core": (0.0, -0.23, 0.0),
        # the spectacle rings sit just in front of the eyes (y -0.245): a smaller socket reach
        # keeps the ring faces out of the cream cover
        "eyes": {"R": (-0.0525, 0.2175), "L": (0.0525, 0.2175), "r": 0.038, "show": 0.50, "sink": 0.35,
                 "reach": 1.25, "socket": "E9D2B4",
                 "shape": {"width": 1.15, "open": 25}},   # a calm, half-lidded scholar
        "mouth": {"x": 0.0, "tip": (-0.25, 0.165), "corner": (-0.22, 0.172), "half": 0.03,
                  "hinge": (0.0, -0.19, 0.18)},
        "glow": {"sat_min": 0.28, "val_min": 0.05},
        "glow_bones": ["ear.L", "ear.R"],
        "radii": {"head": 0.15, "wing.L": 0.05, "wing.R": 0.05},
        "bones": [
            ("root",   (0.0, -0.08, -0.50), (0.0, -0.08, -0.38), None,     UP),
            ("hips",   (0.0, -0.05, -0.36), (0.0, -0.06, -0.15), "root",   UP),
            ("chest",  (0.0, -0.06, -0.15), (0.0, -0.07, 0.06),  "hips",   UP),
            ("neck",   (0.0, -0.07, 0.06),  (0.0, -0.08, 0.12),  "chest",  UP),
            ("head",   (0.0, -0.08, 0.12),  (0.0, -0.10, 0.42),  "neck",   UP),
            ("ear.L",  (0.14, -0.06, 0.36), (0.19, -0.06, 0.50), "head",   UP),
            ("ear.R",  (-0.14, -0.06, 0.36), (-0.19, -0.06, 0.50), "head", UP),
            ("wing.L", (0.17, -0.10, 0.10), (0.25, 0.16, -0.38), "chest",  UP),
            ("wing.R", (-0.17, -0.10, 0.10), (-0.25, 0.16, -0.38), "chest", UP),
            ("tail.0", (0.0, 0.08, -0.22),  (0.0, 0.13, -0.27),  "hips",   FWD),
            ("tail.1", (0.0, 0.13, -0.27),  (0.0, 0.17, -0.32),  "tail.0", FWD),
            ("tail.2", (0.0, 0.17, -0.32),  (0.0, 0.21, -0.37),  "tail.1", FWD),
            ("tail.3", (0.0, 0.21, -0.37),  (0.0, 0.24, -0.42),  "tail.2", FWD),
            ("tail.4", (0.0, 0.24, -0.42),  (0.0, 0.27, -0.46),  "tail.3", FWD),
        ],
    },
    "bubo_l4": {   # Meshy, front/side/back views, normalised to 1.0; spectacles, satchel, ringed orb
        "src": "bubo_l4_meshy.glb",
        "smooth": {"enabled": False},
        "center": (-0.01, -0.06),
        "core": (-0.01, -0.26, 0.056),
        "eyes": {"R": (-0.0675, 0.264), "L": (0.0525, 0.264), "r": 0.038, "show": 0.50, "sink": 0.35,
                 "reach": 1.25, "socket": "E9D2B4",   # as bubo_l3: keep the cover off the rings
                 "shape": {"width": 1.15, "open": 25}},
        "mouth": {"x": -0.01, "tip": (-0.265, 0.215), "corner": (-0.235, 0.228), "half": 0.03,
                  "hinge": (-0.01, -0.21, 0.235)},
        "glow": {"sat_min": 0.28, "val_min": 0.05},
        "glow_bones": ["ear.L", "ear.R"],
        "radii": {"head": 0.15, "wing.L": 0.05, "wing.R": 0.05},
        "bones": [
            ("root",   (-0.01, -0.08, -0.50), (-0.01, -0.08, -0.38), None,     UP),
            ("hips",   (-0.01, -0.05, -0.36), (-0.01, -0.06, -0.13), "root",   UP),
            ("chest",  (-0.01, -0.06, -0.13), (-0.01, -0.07, 0.08),  "hips",   UP),
            ("neck",   (-0.01, -0.07, 0.08),  (-0.01, -0.08, 0.14),  "chest",  UP),
            ("head",   (-0.01, -0.08, 0.14),  (-0.01, -0.10, 0.44),  "neck",   UP),
            ("ear.L",  (0.13, -0.08, 0.37),   (0.19, -0.08, 0.50),   "head",   UP),
            ("ear.R",  (-0.14, -0.08, 0.37),  (-0.20, -0.08, 0.50),  "head",   UP),
            ("wing.L", (0.18, -0.10, 0.12),   (0.26, 0.18, -0.38),   "chest",  UP),
            ("wing.R", (-0.19, -0.10, 0.12),  (-0.27, 0.18, -0.38),  "chest",  UP),
            ("tail.0", (-0.01, 0.08, -0.22),  (-0.01, 0.13, -0.27),  "hips",   FWD),
            ("tail.1", (-0.01, 0.13, -0.27),  (-0.01, 0.17, -0.32),  "tail.0", FWD),
            ("tail.2", (-0.01, 0.17, -0.32),  (-0.01, 0.21, -0.37),  "tail.1", FWD),
            ("tail.3", (-0.01, 0.21, -0.37),  (-0.01, 0.25, -0.42),  "tail.2", FWD),
            ("tail.4", (-0.01, 0.25, -0.42),  (-0.01, 0.28, -0.46),  "tail.3", FWD),
        ],
    },
    "bubo_l5": {   # Meshy, front/side/back views, normalised to 1.0; energy tufts, short cape, book
        "src": "bubo_l5_meshy.glb",
        "smooth": {"enabled": False},
        "center": (0.0, -0.06),
        "core": (0.0, -0.25, 0.064),
        "eyes": {"R": (-0.05, 0.27), "L": (0.05, 0.27), "r": 0.036, "show": 0.50, "sink": 0.35,
                 "reach": 1.25, "socket": "E9D2B4",   # as bubo_l3: keep the cover off the rings
                 "shape": {"width": 1.15, "open": 25}},
        "mouth": {"x": 0.0, "tip": (-0.255, 0.232), "corner": (-0.225, 0.24), "half": 0.028,
                  "hinge": (0.0, -0.20, 0.245)},
        "glow": {"sat_min": 0.28, "val_min": 0.05},
        "glow_bones": ["ear.L", "ear.R"],
        "radii": {"head": 0.15, "wing.L": 0.05, "wing.R": 0.05},
        "bones": [
            ("root",   (0.0, -0.08, -0.50), (0.0, -0.08, -0.38), None,     UP),
            ("hips",   (0.0, -0.04, -0.36), (0.0, -0.05, -0.12), "root",   UP),
            ("chest",  (0.0, -0.05, -0.12), (0.0, -0.06, 0.11),  "hips",   UP),
            ("neck",   (0.0, -0.06, 0.11),  (0.0, -0.07, 0.17),  "chest",  UP),
            ("head",   (0.0, -0.07, 0.17),  (0.0, -0.09, 0.46),  "neck",   UP),
            ("ear.L",  (0.10, -0.06, 0.38), (0.22, -0.02, 0.48), "head",   UP),
            ("ear.R",  (-0.10, -0.06, 0.38), (-0.22, -0.02, 0.48), "head", UP),
            # the wings start under the cape's edge, so the flap doesn't drag the cape
            ("wing.L", (0.20, -0.10, 0.02), (0.28, 0.18, -0.38), "chest",  UP),
            ("wing.R", (-0.20, -0.10, 0.02), (-0.28, 0.18, -0.38), "chest", UP),
            ("tail.0", (0.0, 0.08, -0.22),  (0.0, 0.13, -0.27),  "hips",   FWD),
            ("tail.1", (0.0, 0.13, -0.27),  (0.0, 0.17, -0.32),  "tail.0", FWD),
            ("tail.2", (0.0, 0.17, -0.32),  (0.0, 0.21, -0.37),  "tail.1", FWD),
            ("tail.3", (0.0, 0.21, -0.37),  (0.0, 0.25, -0.42),  "tail.2", FWD),
            ("tail.4", (0.0, 0.25, -0.42),  (0.0, 0.28, -0.46),  "tail.3", FWD),
        ],
    },
    "bubo_l6": {   # Meshy, front/side/back views, normalised to 1.0; scholar's robe, burst with lines
        "src": "bubo_l6_meshy.glb",
        "smooth": {"enabled": False},
        "center": (0.0, -0.06),
        "core": (0.0, -0.21, 0.02),
        "eyes": {"R": (-0.0475, 0.235), "L": (0.055, 0.235), "r": 0.032, "show": 0.50, "sink": 0.35,
                 "reach": 1.25, "socket": "E9D2B4",   # as bubo_l3: keep the cover off the rings
                 "shape": {"width": 1.15, "open": 20}},   # heavier lids: the wise elder
        "mouth": {"x": 0.0, "tip": (-0.24, 0.20), "corner": (-0.215, 0.207), "half": 0.025,
                  "hinge": (0.0, -0.19, 0.21)},
        "glow": {"sat_min": 0.28, "val_min": 0.05},
        "glow_bones": ["ear.L", "ear.R"],
        "radii": {"head": 0.15, "wing.L": 0.05, "wing.R": 0.05},
        "bones": [
            ("root",   (0.0, -0.08, -0.50), (0.0, -0.08, -0.38), None,     UP),
            ("hips",   (0.0, -0.04, -0.36), (0.0, -0.05, -0.12), "root",   UP),
            ("chest",  (0.0, -0.05, -0.12), (0.0, -0.06, 0.10),  "hips",   UP),
            ("neck",   (0.0, -0.06, 0.10),  (0.0, -0.07, 0.16),  "chest",  UP),
            ("head",   (0.0, -0.07, 0.16),  (0.0, -0.09, 0.44),  "neck",   UP),
            ("ear.L",  (0.11, -0.05, 0.38), (0.22, -0.02, 0.49), "head",   UP),
            ("ear.R",  (-0.11, -0.05, 0.38), (-0.22, -0.02, 0.49), "head", UP),
            ("wing.L", (0.20, -0.10, 0.00), (0.27, 0.18, -0.34), "chest",  UP),
            ("wing.R", (-0.20, -0.10, 0.00), (-0.27, 0.18, -0.34), "chest", UP),
            ("tail.0", (0.0, 0.06, -0.25),  (0.0, 0.10, -0.30),  "hips",   FWD),
            ("tail.1", (0.0, 0.10, -0.30),  (0.0, 0.13, -0.35),  "tail.0", FWD),
            ("tail.2", (0.0, 0.13, -0.35),  (0.0, 0.16, -0.40),  "tail.1", FWD),
            ("tail.3", (0.0, 0.16, -0.40),  (0.0, 0.19, -0.44),  "tail.2", FWD),
            ("tail.4", (0.0, 0.19, -0.44),  (0.0, 0.22, -0.48),  "tail.3", FWD),
        ],
    },
    "bubo_l7": {   # Meshy, front/side/back views, normalised to 1.0; circlet, ornate robe, burst with halo ring
        "src": "bubo_l7_meshy.glb",
        "smooth": {"enabled": False},
        "center": (0.0, -0.06),
        "core": (0.0, -0.24, 0.064),
        "eyes": {"R": (-0.039, 0.2625), "L": (0.039, 0.2625), "r": 0.030, "show": 0.50, "sink": 0.35,
                 "reach": 1.25, "socket": "E9D2B4",   # as bubo_l3: keep the cover off the rings
                 "shape": {"width": 1.15, "open": 20}},   # heavy lids, as bubo_l6
        "mouth": {"x": 0.0, "tip": (-0.245, 0.21), "corner": (-0.225, 0.22), "half": 0.025,
                  "hinge": (0.0, -0.20, 0.225)},
        "glow": {"sat_min": 0.28, "val_min": 0.05},
        "glow_bones": ["ear.L", "ear.R"],
        "radii": {"head": 0.15, "wing.L": 0.05, "wing.R": 0.05},
        "bones": [
            ("root",   (0.0, -0.08, -0.50), (0.0, -0.08, -0.38), None,     UP),
            ("hips",   (0.0, -0.04, -0.36), (0.0, -0.05, -0.12), "root",   UP),
            ("chest",  (0.0, -0.05, -0.12), (0.0, -0.06, 0.10),  "hips",   UP),
            ("neck",   (0.0, -0.06, 0.10),  (0.0, -0.07, 0.17),  "chest",  UP),
            ("head",   (0.0, -0.07, 0.17),  (0.0, -0.09, 0.46),  "neck",   UP),
            ("ear.L",  (0.10, -0.07, 0.37), (0.20, -0.04, 0.49), "head",   UP),
            ("ear.R",  (-0.10, -0.07, 0.37), (-0.20, -0.04, 0.49), "head", UP),
            ("wing.L", (0.21, -0.10, 0.02), (0.27, 0.16, -0.30), "chest",  UP),
            ("wing.R", (-0.21, -0.10, 0.02), (-0.27, 0.16, -0.30), "chest", UP),
            ("tail.0", (0.0, 0.06, -0.25),  (0.0, 0.10, -0.30),  "hips",   FWD),
            ("tail.1", (0.0, 0.10, -0.30),  (0.0, 0.13, -0.35),  "tail.0", FWD),
            ("tail.2", (0.0, 0.13, -0.35),  (0.0, 0.16, -0.40),  "tail.1", FWD),
            ("tail.3", (0.0, 0.16, -0.40),  (0.0, 0.19, -0.44),  "tail.2", FWD),
            ("tail.4", (0.0, 0.19, -0.44),  (0.0, 0.22, -0.48),  "tail.3", FWD),
        ],
    },
    "bot_easy": {   # Meshy, four-view turnaround, normalised to 1.0; chibi robot, green
        # Bots (AVATAR_EVOLUTION §9): single level, a screen face (`screen`, no eyes / mouth),
        # the arms are named wing.* so the shared clips swing them, the antenna glows.
        "src": "bot_easy_meshy.glb",
        "screen": {"box": ((-0.28, 0.28), (-0.10, 0.31)), "style": "happy", "color": "62E832"},
        "smooth": {"enabled": False},
        "center": (0.0, 0.0),
        "core": (0.0, -0.15, -0.2),
        "glow": {"sat_min": 0.28, "val_min": 0.05},
        "glow_bones": ["antenna"],
        "radii": {"head": 0.22, "chest": 0.14, "hips": 0.12, "neck": 0.04, "antenna": 0.03,
                  "wing.L": 0.045, "wing.R": 0.045, "leg.L": 0.06, "leg.R": 0.06},
        "bones": [
            ("root",    (0.0, 0.0, -0.54), (0.0, 0.0, -0.44), None, UP),
            ("hips",    (0.0, 0.0, -0.40), (0.0, 0.0, -0.27), "root", UP),
            ("chest",   (0.0, 0.0, -0.27), (0.0, 0.0, -0.12), "hips", UP),
            ("neck",    (0.0, 0.0, -0.12), (0.0, 0.0, -0.08), "chest", UP),
            ("head",    (0.0, 0.0, -0.08), (0.0, 0.0, 0.33), "neck", UP),
            ("antenna", (0.0, 0.0, 0.34), (0.0, 0.0, 0.48), "head", UP),
            ("wing.L",  (0.17, 0.0, -0.17), (0.29, 0.0, -0.34), "chest", UP),
            ("wing.R",  (-0.17, 0.0, -0.17), (-0.29, 0.0, -0.34), "chest", UP),
            ("leg.L",   (0.09, 0.0, -0.40), (0.09, 0.0, -0.52), "hips", UP),
            ("leg.R",   (-0.09, 0.0, -0.40), (-0.09, 0.0, -0.52), "hips", UP),
        ],
    },
    "bot_medium": {   # Meshy, four-view turnaround, normalised to 1.0; taller robot, yellow, shoulder pads
        # Bots (AVATAR_EVOLUTION §9): single level, a screen face (`screen`, no eyes / mouth),
        # the arms are named wing.* so the shared clips swing them, the antenna glows.
        "src": "bot_medium_meshy.glb",
        "screen": {"box": ((-0.26, 0.26), (0.02, 0.38)), "style": "focused", "color": "FFD23A"},
        "smooth": {"enabled": False},
        "center": (0.0, 0.0),
        "core": (0.0, -0.14, -0.08),
        "glow": {"sat_min": 0.28, "val_min": 0.05},
        "glow_bones": ["antenna"],
        "radii": {"head": 0.22, "chest": 0.14, "hips": 0.12, "neck": 0.04, "antenna": 0.03,
                  "wing.L": 0.045, "wing.R": 0.045, "leg.L": 0.06, "leg.R": 0.06},
        "bones": [
            ("root",    (0.0, 0.0, -0.55), (0.0, 0.0, -0.45), None, UP),
            ("hips",    (0.0, 0.0, -0.24), (0.0, 0.0, -0.15), "root", UP),
            ("chest",   (0.0, 0.0, -0.15), (0.0, 0.0, -0.01), "hips", UP),
            ("neck",    (0.0, 0.0, -0.01), (0.0, 0.0, 0.02), "chest", UP),
            ("head",    (0.0, 0.0, 0.02), (0.0, 0.0, 0.40), "neck", UP),
            ("antenna", (0.0, 0.0, 0.41), (0.0, 0.0, 0.53), "head", UP),
            ("wing.L",  (0.17, 0.0, -0.04), (0.26, 0.0, -0.27), "chest", UP),
            ("wing.R",  (-0.17, 0.0, -0.04), (-0.26, 0.0, -0.27), "chest", UP),
            ("leg.L",   (0.09, 0.0, -0.24), (0.09, 0.0, -0.53), "hips", UP),
            ("leg.R",   (-0.09, 0.0, -0.24), (-0.09, 0.0, -0.53), "hips", UP),
        ],
    },
    "bot_hard": {   # Meshy, four-view turnaround, normalised to 1.0; tallest robot, red armour
        # Bots (AVATAR_EVOLUTION §9): single level, a screen face (`screen`, no eyes / mouth),
        # the arms are named wing.* so the shared clips swing them, the antenna glows.
        "src": "bot_hard_meshy.glb",
        "screen": {"box": ((-0.24, 0.24), (0.10, 0.40)), "style": "angry", "color": "FF7350", "emit": 3.4},
        "smooth": {"enabled": False},
        "center": (0.0, 0.0),
        "core": (0.0, -0.14, -0.01),
        "glow": {"sat_min": 0.28, "val_min": 0.05},
        "glow_bones": ["antenna"],
        "radii": {"head": 0.22, "chest": 0.14, "hips": 0.12, "neck": 0.04, "antenna": 0.03,
                  "wing.L": 0.045, "wing.R": 0.045, "leg.L": 0.06, "leg.R": 0.06},
        "bones": [
            ("root",    (0.0, 0.0, -0.55), (0.0, 0.0, -0.45), None, UP),
            ("hips",    (0.0, 0.0, -0.22), (0.0, 0.0, -0.12), "root", UP),
            ("chest",   (0.0, 0.0, -0.12), (0.0, 0.0, 0.10), "hips", UP),
            ("neck",    (0.0, 0.0, 0.10), (0.0, 0.0, 0.13), "chest", UP),
            ("head",    (0.0, 0.0, 0.13), (0.0, 0.0, 0.43), "neck", UP),
            ("antenna", (0.0, 0.0, 0.44), (0.0, 0.0, 0.53), "head", UP),
            ("wing.L",  (0.18, 0.0, 0.04), (0.27, 0.0, -0.27), "chest", UP),
            ("wing.R",  (-0.18, 0.0, 0.04), (-0.27, 0.0, -0.27), "chest", UP),
            ("leg.L",   (0.10, 0.0, -0.22), (0.10, 0.0, -0.53), "hips", UP),
            ("leg.R",   (-0.10, 0.0, -0.22), (-0.10, 0.0, -0.53), "hips", UP),
        ],
    },
    "zapi_l4_trellis": {
        "src": "zapi_l4_trellis.glb",
        "center": (-0.15, -0.08),
        "core": (-0.15, -0.22, 0.05),
        # pupil centres (x, z) seen from the front, and the eyeball radius
        "eyes": {"R": (-0.245, 0.2375), "L": (-0.1075, 0.2625), "r": 0.0275},
        # mouth line: midline x, (y, z) at the tip and at the corners, half width, and the
        # jaw hinge (x, y, z); from measure.py --head / --side
        "mouth": {"x": -0.18, "tip": (-0.36, 0.152), "corner": (-0.275, 0.150), "half": 0.06,
                  "hinge": (-0.18, -0.235, 0.165)},
        "glow": {"sat_min": 0.28, "val_min": 0.05},
        "bones": [
            ("root",   (-0.15, -0.08, -0.50), (-0.15, -0.08, -0.38), None,    UP),
            ("hips",   (-0.15, -0.08, -0.17), (-0.15, -0.09, -0.05), "root",  UP),
            ("chest",  (-0.15, -0.09, -0.05), (-0.15, -0.11, 0.10),  "hips",  UP),
            ("neck",   (-0.15, -0.11, 0.10),  (-0.15, -0.14, 0.16),  "chest", UP),
            ("head",   (-0.15, -0.14, 0.16),  (-0.16, -0.16, 0.36),  "neck",  UP),
            ("ear.L",  (-0.10, -0.14, 0.32),  (-0.07, -0.14, 0.49),  "head",  UP),
            ("ear.R",  (-0.30, -0.14, 0.31),  (-0.40, -0.14, 0.45),  "head",  UP),
            ("tail.0", (-0.08, 0.02, -0.15),  (0.08, 0.17, -0.15),   "hips",  FWD),
            ("tail.1", (0.08, 0.17, -0.15),   (0.28, 0.20, -0.08),   "tail.0", FWD),
            ("tail.2", (0.28, 0.20, -0.08),   (0.40, 0.10, 0.08),    "tail.1", FWD),
            ("tail.3", (0.40, 0.10, 0.08),    (0.30, 0.07, 0.24),    "tail.2", FWD),
            ("tail.4", (0.30, 0.07, 0.24),    (0.12, 0.06, 0.34),    "tail.3", FWD),
        ],
    },
}
MAX_TEXTURE = 1024

# bone -> [(frame, (rx, ry, rz) degrees)]; same names in every layout
CLIPS = {
    "idle": (121, {
        "chest": [(1, (0, 0, 0)), (31, (-1.5, 0, 0)), (61, (0, 0, 0)), (91, (-1.5, 0, 0)), (121, (0, 0, 0))],
        "head": [(1, (0, 0, 0)), (61, (-3, -3, 2)), (121, (0, 0, 0))],
        "tail.2": [(1, (0, 0, 0)), (31, (0, 0, 5)), (61, (0, 0, 0)), (91, (0, 0, -5)), (121, (0, 0, 0))],
        "tail.3": [(1, (0, 0, 0)), (41, (0, 0, 6)), (71, (0, 0, 0)), (101, (0, 0, -6)), (121, (0, 0, 0))],
        "ear.L": [(1, (0, 0, 0)), (80, (0, 0, 0)), (83, (10, 0, 0)), (87, (0, 0, 0)), (121, (0, 0, 0))],
    }),
    "turn": (37, {   # small dip (anticipation), perk up past the pose (overshoot), settle
        "head": [(1, (0, 0, 0)), (4, (4, 2, 0)), (10, (-10, -17, 0)), (14, (-7, -13, 0)), (27, (-7, -13, 0)), (37, (0, 0, 0))],
        "chest": [(1, (0, 0, 0)), (4, (2, 1, 0)), (10, (-4, -5, 0)), (14, (-3, -4, 0)), (27, (-3, -4, 0)), (37, (0, 0, 0))],
        "tail.3": [(1, (0, 0, 0)), (10, (-14, 0, 0)), (27, (-10, 0, 4)), (37, (0, 0, 0))],
        "ear.L": [(1, (0, 0, 0)), (10, (-10, 0, 0)), (27, (-8, 0, 0)), (37, (0, 0, 0))],
        "ear.R": [(1, (0, 0, 0)), (10, (-10, 0, 0)), (27, (-8, 0, 0)), (37, (0, 0, 0))],
    }),
    "good": (31, {   # two nods, each overshooting upwards, with a little head tilt
        "head": [(1, (0, 0, 0)), (5, (11, 0, 4)), (9, (-3, 0, 6)), (13, (8, 0, 6)), (17, (-2, 0, 4)), (22, (0, 0, 2)), (31, (0, 0, 0))],
        "chest": [(1, (0, 0, 0)), (5, (3, 0, 0)), (9, (-1, 0, 0)), (13, (2, 0, 0)), (22, (0, 0, 0)), (31, (0, 0, 0))],
        "tail.2": [(1, (0, 0, 0)), (5, (0, 0, 12)), (11, (0, 0, -12)), (17, (0, 0, 12)), (23, (0, 0, -8)), (31, (0, 0, 0))],
        "tail.3": [(1, (0, 0, 0)), (7, (0, 0, 14)), (13, (0, 0, -14)), (19, (0, 0, 14)), (25, (0, 0, -8)), (31, (0, 0, 0))],
        "jaw": [(1, (0, 0, 0)), (5, (-12, 0, 0)), (20, (-10, 0, 0)), (28, (0, 0, 0))],   # an open grin
        "wing.L": [(1, (0, 0, 0)), (5, (0, 0, 14)), (9, (0, 0, 2)), (13, (0, 0, 12)), (18, (0, 0, 0)), (31, (0, 0, 0))],
        "wing.R": [(1, (0, 0, 0)), (5, (0, 0, -14)), (9, (0, 0, -2)), (13, (0, 0, -12)), (18, (0, 0, 0)), (31, (0, 0, 0))],
    }),
    "boost": (25, {  # a sharp startle, then a wobbly recovery
        "chest": [(1, (0, 0, 0)), (3, (-7, 0, 0)), (9, (-3, 0, 2)), (15, (-4, 0, -1)), (25, (0, 0, 0))],
        "head": [(1, (0, 0, 0)), (3, (-14, 0, 0)), (8, (-8, 0, 4)), (14, (-10, 0, -3)), (25, (0, 0, 0))],
        "ear.L": [(1, (0, 0, 0)), (3, (16, 0, 0)), (25, (0, 0, 0))],
        "ear.R": [(1, (0, 0, 0)), (3, (16, 0, 0)), (25, (0, 0, 0))],
        "tail.2": [(1, (0, 0, 0)), (3, (-12, 0, 0)), (25, (0, 0, 0))],
        "tail.3": [(1, (0, 0, 0)), (3, (-16, 0, 0)), (10, (-6, 0, 0)), (25, (0, 0, 0))],
        "jaw": [(1, (0, 0, 0)), (3, (-20, 0, 0)), (12, (-16, 0, 0)), (22, (0, 0, 0))],  # a gasp
        "wing.L": [(1, (0, 0, 0)), (3, (0, 0, 30)), (7, (0, 0, 8)), (11, (0, 0, 20)), (16, (0, 0, 4)), (25, (0, 0, 0))],
        "wing.R": [(1, (0, 0, 0)), (3, (0, 0, -30)), (7, (0, 0, -8)), (11, (0, 0, -20)), (16, (0, 0, -4)), (25, (0, 0, 0))],
    }),
    # mouth reactions (need a `jaw`; other levels just play the body part)
    "laugh": (37, {  # head thrown back a little, jaw chattering, shoulders bouncing, tail wagging
        "jaw": [(1, (0, 0, 0)), (4, (-15, 0, 0)), (7, (-5, 0, 0)), (10, (-15, 0, 0)), (13, (-5, 0, 0)),
                (16, (-14, 0, 0)), (19, (-4, 0, 0)), (22, (-12, 0, 0)), (28, (-3, 0, 0)), (37, (0, 0, 0))],
        "head": [(1, (0, 0, 0)), (4, (-8, 0, 4)), (7, (-5, 0, 4)), (10, (-9, 0, 5)), (13, (-5, 0, 5)),
                 (16, (-8, 0, 4)), (22, (-6, 0, 3)), (37, (0, 0, 0))],
        "chest": [(1, (0, 0, 0)), (4, (-3, 0, 0)), (7, (0, 0, 0)), (10, (-3, 0, 0)), (13, (0, 0, 0)),
                  (16, (-3, 0, 0)), (22, (0, 0, 0)), (37, (0, 0, 0))],
        "tail.2": [(1, (0, 0, 0)), (6, (0, 0, 12)), (12, (0, 0, -12)), (18, (0, 0, 12)), (24, (0, 0, -8)), (37, (0, 0, 0))],
        "tail.3": [(1, (0, 0, 0)), (8, (0, 0, 14)), (14, (0, 0, -14)), (20, (0, 0, 14)), (26, (0, 0, -8)), (37, (0, 0, 0))],
        "wing.L": [(1, (0, 0, 0)), (4, (0, 0, 8)), (7, (0, 0, 0)), (10, (0, 0, 8)), (13, (0, 0, 0)), (16, (0, 0, 6)), (22, (0, 0, 0)), (37, (0, 0, 0))],
        "wing.R": [(1, (0, 0, 0)), (4, (0, 0, -8)), (7, (0, 0, 0)), (10, (0, 0, -8)), (13, (0, 0, 0)), (16, (0, 0, -6)), (22, (0, 0, 0)), (37, (0, 0, 0))],
    }),
    "wow": (43, {    # pulls back, jaw drops and hangs open, ears shoot up, slow recovery
        "jaw": [(1, (0, 0, 0)), (4, (-4, 0, 0)), (8, (-24, 0, 0)), (12, (-20, 0, 0)), (30, (-21, 0, 0)), (43, (0, 0, 0))],
        "head": [(1, (0, 0, 0)), (4, (4, 0, 0)), (8, (-12, 0, 0)), (12, (-9, 0, 0)), (30, (-9, 0, -3)), (43, (0, 0, 0))],
        "chest": [(1, (0, 0, 0)), (8, (-5, 0, 0)), (12, (-4, 0, 0)), (30, (-4, 0, 0)), (43, (0, 0, 0))],
        "ear.L": [(1, (0, 0, 0)), (8, (18, 0, 0)), (12, (14, 0, 0)), (30, (14, 0, 0)), (43, (0, 0, 0))],
        "ear.R": [(1, (0, 0, 0)), (8, (18, 0, 0)), (12, (14, 0, 0)), (30, (14, 0, 0)), (43, (0, 0, 0))],
        "tail.3": [(1, (0, 0, 0)), (8, (-14, 0, 0)), (30, (-10, 0, 0)), (43, (0, 0, 0))],
        "wing.L": [(1, (0, 0, 0)), (8, (0, 0, 24)), (12, (0, 0, 18)), (30, (0, 0, 18)), (43, (0, 0, 0))],
        "wing.R": [(1, (0, 0, 0)), (8, (0, 0, -24)), (12, (0, 0, -18)), (30, (0, 0, -18)), (43, (0, 0, 0))],
    }),
    "stare": (46, {  # wide eyes: leans in, ears forward, holds the look ("really?")
        "head": [(1, (0, 0, 0)), (4, (-3, 0, 0)), (9, (7, 0, -7)), (12, (5, 0, -6)), (36, (6, 0, -6)), (46, (0, 0, 0))],
        "chest": [(1, (0, 0, 0)), (9, (3, 0, 0)), (36, (3, 0, 0)), (46, (0, 0, 0))],
        "ear.L": [(1, (0, 0, 0)), (9, (-12, 0, 0)), (36, (-10, 0, 0)), (46, (0, 0, 0))],
        "ear.R": [(1, (0, 0, 0)), (9, (-12, 0, 0)), (36, (-10, 0, 0)), (46, (0, 0, 0))],
        "tail.3": [(1, (0, 0, 0)), (9, (0, 0, 0)), (36, (0, 0, 0)), (46, (0, 0, 0))],
    }),
    "yawn": (58, {   # a slow, showy yawn: "you're taking forever"
        "jaw": [(1, (0, 0, 0)), (10, (-5, 0, 0)), (24, (-28, 0, 0)), (38, (-26, 0, 0)), (50, (-2, 0, 0)), (58, (0, 0, 0))],
        "head": [(1, (0, 0, 0)), (10, (3, 0, 0)), (24, (-14, 0, 3)), (38, (-12, 0, 4)), (50, (2, 0, 0)), (58, (0, 0, 0))],
        "chest": [(1, (0, 0, 0)), (24, (-5, 0, 0)), (38, (-4, 0, 0)), (58, (0, 0, 0))],
        "ear.L": [(1, (0, 0, 0)), (24, (10, 0, 6)), (40, (8, 0, 6)), (58, (0, 0, 0))],
        "ear.R": [(1, (0, 0, 0)), (24, (10, 0, -6)), (40, (8, 0, -6)), (58, (0, 0, 0))],
    }),
    "wink": (22, {   # a sly wink: head tilts, a small grin; the lids come from LID_CLIPS
        "head": [(1, (0, 0, 0)), (4, (3, 0, 9)), (13, (3, 0, 8)), (22, (0, 0, 0))],
        "jaw": [(1, (0, 0, 0)), (4, (-6, 0, 0)), (13, (-6, 0, 0)), (20, (0, 0, 0))],
        "ear.L": [(1, (0, 0, 0)), (4, (-8, 0, 0)), (13, (-8, 0, 0)), (22, (0, 0, 0))],
        "tail.3": [(1, (0, 0, 0)), (6, (0, 0, 8)), (14, (0, 0, -4)), (22, (0, 0, 0))],
    }),
}

# Lid keys added to a clip once the lid bones exist (eyes, part 2). Only these clips key the
# lids; in every other clip the app drives them live. lid.* rotate about X from the rest
# opening: -82 = shut. Existing builds were patched by add_wink.py (keep the two in sync).
LID_CLIPS = {
    "wink": {
        "lid.L": [(1, (0, 0, 0)), (4, (-82, 0, 0)), (13, (-82, 0, 0)), (19, (0, 0, 0)), (22, (0, 0, 0))],
        "lid.R": [(1, (0, 0, 0)), (4, (-10, 0, 0)), (13, (-10, 0, 0)), (19, (0, 0, 0)), (22, (0, 0, 0))],   # squints
    },
}

# Each character's own movement, exported as the "signature" clip. The app plays it every
# 10-20 s between reactions, also on the board (D-boostie-live-3d). Keep it short (< 1 s),
# small and recognisable; it must use bones every level of the character has.
SIGNATURES = {
    "zapi": (25, {   # a quick double ear twitch, the left ear leading, the tail tip answering
        "ear.L": [(1, (0, 0, 0)), (3, (20, 0, -10)), (5, (0, 0, 0)), (8, (16, 0, -8)), (11, (0, 0, 0)), (25, (0, 0, 0))],
        "ear.R": [(1, (0, 0, 0)), (6, (0, 0, 0)), (8, (8, 0, 6)), (11, (0, 0, 0)), (25, (0, 0, 0))],
        "tail.4": [(1, (0, 0, 0)), (9, (0, 0, 0)), (13, (0, 0, 14)), (18, (0, 0, -6)), (25, (0, 0, 0))],
    }),
    "bot": (26, {    # the antenna wobble: a quick springy flick with a little head bob
        "antenna": [(1, (0, 0, 0)), (4, (0, 0, 0)), (7, (14, 0, 10)), (10, (-10, 0, -8)), (13, (7, 0, 5)),
                    (16, (-4, 0, -3)), (19, (2, 0, 1)), (26, (0, 0, 0))],
        "head": [(1, (0, 0, 0)), (4, (5, 0, 0)), (8, (-2, 0, 0)), (14, (0, 0, 0)), (26, (0, 0, 0))],
    }),
    "bubo": (28, {   # the owl head swivel: a quick turn and a curious sideways tilt, tufts perking
        "head": [(1, (0, 0, 0)), (5, (0, 28, 0)), (10, (0, 24, 16)), (17, (0, 20, 14)), (23, (0, -3, 0)), (28, (0, 0, 0))],
        "ear.L": [(1, (0, 0, 0)), (10, (12, 0, 0)), (17, (10, 0, 0)), (28, (0, 0, 0))],
        "ear.R": [(1, (0, 0, 0)), (10, (12, 0, 0)), (17, (10, 0, 0)), (28, (0, 0, 0))],
    }),
}

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
KEY = args[0] if args else "zapi_l4"
CFG = LEVELS[KEY]
OUT_ROOT = os.path.abspath(args[1] if len(args) > 1 else os.path.join(HERE, "out"))
OUT = os.path.join(OUT_ROOT, KEY)
os.makedirs(OUT, exist_ok=True)

# ------------------------------------------------------------------ import, ground, smooth
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=os.path.join(SOURCES, CFG["src"]))
BODY = next(o for o in scene.objects if o.type == "MESH")
mw = BODY.matrix_world.copy()
for o in list(scene.objects):
    if o is not BODY:
        bpy.data.objects.remove(o)
BODY.matrix_world = mw
BODY.name = BODY.data.name = f"{KEY}_body"
bpy.context.view_layer.objects.active = BODY
BODY.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
# "cut": boxes ((x0, x1), (y0, y1), (z0, z1)) in source space; faces centred inside are
# deleted. For extra parts the generator added, e.g. the fur tail Meshy kept between
# Zapi L6's two energy tails.
if CFG.get("cut"):
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(BODY.data)
    kill = [f for f in bm.faces if any(all(lo < c < hi for c, (lo, hi) in zip(f.calc_center_median(), box))
                                       for box in CFG["cut"])]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bm.to_mesh(BODY.data)
    bm.free()
    print(f"cut {len(kill)} faces")
GROUND = -min(v.co.z for v in BODY.data.vertices)
BODY.data.transform(Matrix.Translation((0, 0, GROUND)))
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.remove_doubles(threshold=1e-5)
bpy.ops.object.mode_set(mode="OBJECT")

# ------------------------------------------------------------------ rebuild as one smooth surface
# TRELLIS surfaces are flat planes with jagged edges ("sharp geometric components").
# Fuse the mesh into one watertight volume (thin parts thickened first so they survive),
# relax it, reduce it back to a phone budget, unwrap it, and copy the painting across:
# every texel of the new surface takes the colour of the nearest point on the original.
SMOOTH = {"voxel": 0.005, "thicken": 0.012, "relax": 10, "faces": 20000, **CFG.get("smooth", {})}


def rebuild_smooth(src):
    t0 = time.time()
    new = src.copy()
    new.data = src.data.copy()
    scene.collection.objects.link(new)
    for m in list(new.modifiers):
        new.modifiers.remove(m)
    th = new.modifiers.new("thicken", "SOLIDIFY")
    th.thickness, th.offset = SMOOTH["thicken"], 0.0
    rm = new.modifiers.new("fuse", "REMESH")
    rm.mode, rm.voxel_size = "VOXEL", SMOOTH["voxel"]
    rl = new.modifiers.new("relax", "LAPLACIANSMOOTH")
    rl.lambda_factor, rl.iterations, rl.use_volume_preserve = 0.5, SMOOTH["relax"], True
    sm = new.modifiers.new("soften", "SMOOTH")
    sm.factor, sm.iterations = 0.5, 3
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = new
    new.select_set(True)
    for m in ("thicken", "fuse", "relax", "soften"):
        bpy.ops.object.modifier_apply(modifier=m)
    dec = new.modifiers.new("reduce", "DECIMATE")
    dec.ratio = min(1.0, SMOOTH["faces"] / max(1, len(new.data.polygons) * 2))
    bpy.ops.object.modifier_apply(modifier="reduce")
    new.data.validate()   # the reduction can leave degenerate faces
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
    bpy.ops.object.mode_set(mode="OBJECT")

    # texture transfer, texel by texel
    src_img = next(n for n in src.data.materials[0].node_tree.nodes if n.type == "TEX_IMAGE").image
    sw, sh = src_img.size
    spx = np.empty(sw * sh * 4, np.float32)
    src_img.pixels.foreach_get(spx)
    spx = spx.reshape(sh, sw, 4)
    om = src.data
    om.calc_loop_triangles()
    ouv = om.uv_layers.active.data
    tree = BVHTree.FromPolygons([v.co for v in om.vertices], [t.vertices[:] for t in om.loop_triangles])
    otris = [(t.vertices[:], t.loops[:]) for t in om.loop_triangles]
    nm_ = new.data
    nm_.calc_loop_triangles()
    nuv = nm_.uv_layers.active.data
    TS = MAX_TEXTURE
    out_px = np.zeros((TS, TS, 4), np.float32)
    filled = np.zeros((TS, TS), bool)
    for t in nm_.loop_triangles:
        P = [nm_.vertices[i].co for i in t.vertices]
        U = [Vector((nuv[l].uv[0] * TS, nuv[l].uv[1] * TS)) for l in t.loops]
        x0, x1 = int(max(0, min(u.x for u in U))), int(min(TS - 1, max(u.x for u in U) + 1))
        y0, y1 = int(max(0, min(u.y for u in U))), int(min(TS - 1, max(u.y for u in U) + 1))
        den = (U[1].y - U[2].y) * (U[0].x - U[2].x) + (U[2].x - U[1].x) * (U[0].y - U[2].y)
        if abs(den) < 1e-12:
            continue
        for yy in range(y0, y1 + 1):
            for xx in range(x0, x1 + 1):
                if filled[yy, xx]:
                    continue
                cx_, cy_ = xx + 0.5, yy + 0.5
                l1 = ((U[1].y - U[2].y) * (cx_ - U[2].x) + (U[2].x - U[1].x) * (cy_ - U[2].y)) / den
                l2 = ((U[2].y - U[0].y) * (cx_ - U[2].x) + (U[0].x - U[2].x) * (cy_ - U[2].y)) / den
                l3 = 1 - l1 - l2
                if l1 < -0.01 or l2 < -0.01 or l3 < -0.01:
                    continue
                loc, _, fi, _ = tree.find_nearest(P[0] * l1 + P[1] * l2 + P[2] * l3)
                if loc is None:
                    continue
                vi, li = otris[fi]
                A = [om.vertices[i].co for i in vi]
                UV = [Vector((ouv[l].uv[0], ouv[l].uv[1], 0)) for l in li]
                uv = barycentric_transform(loc, A[0], A[1], A[2], UV[0], UV[1], UV[2])
                out_px[yy, xx] = spx[min(sh - 1, max(0, int(uv.y * sh))), min(sw - 1, max(0, int(uv.x * sw)))]
                filled[yy, xx] = True
    for _ in range(6):   # bleed colour past island edges so filtering doesn't pull in black
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            take = ~filled & np.roll(np.roll(filled, dy, 0), dx, 1)
            out_px[take] = np.roll(np.roll(out_px, dy, 0), dx, 1)[take]
            filled = filled | take
    out_px[..., 3] = 1
    img = bpy.data.images.new(f"{KEY}_smooth", TS, TS, alpha=False)
    img.pixels.foreach_set(out_px.ravel())
    mat_ = src.data.materials[0]
    next(n for n in mat_.node_tree.nodes if n.type == "TEX_IMAGE").image = img
    new.data.materials.clear()
    new.data.materials.append(mat_)
    bpy.data.objects.remove(src)
    new.name = new.data.name = f"{KEY}_body"
    print(f"smooth rebuild: {len(new.data.polygons)} faces, {time.time() - t0:.1f} s")
    return new


if SMOOTH.get("enabled", True):
    BODY = rebuild_smooth(BODY)
bpy.ops.object.select_all(action="DESELECT")
bpy.context.view_layer.objects.active = BODY
BODY.select_set(True)
bpy.ops.object.shade_smooth()

# ------------------------------------------------------------------ glow, part 1: colour mask
mat = BODY.data.materials[0]
tex_node = next(n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE")
src_img = tex_node.image
if max(src_img.size) > MAX_TEXTURE:
    src_img.scale(MAX_TEXTURE, MAX_TEXTURE)
W, H = src_img.size
px = np.empty(W * H * 4, dtype=np.float32)
src_img.pixels.foreach_get(px)
rgb = px.reshape(H, W, 4)[..., :3]          # sRGB-encoded values (byte image)
mx, mn = rgb.max(-1), rgb.min(-1)
sat = np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0)
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
d = np.maximum(mx - mn, 1e-6)
hue = np.zeros_like(mx)
hue = np.where(mx == r, ((g - b) / d) % 6, hue)
hue = np.where(mx == g, (b - r) / d + 2, hue)
hue = np.where(mx == b, (r - g) / d + 4, hue)
hue *= 60.0
gcfg = CFG["glow"]
mask = ((hue > 165) & (hue < 230) & (sat > gcfg["sat_min"]) & (mx > gcfg["val_min"])).astype(np.float32)
for axis in (0, 1):   # soften the edge (5-tap box blur)
    mask = sum(np.roll(mask, k, axis) for k in (-2, -1, 0, 1, 2)) / 5
mask = np.clip((mask - 0.15) / 0.6, 0, 1)[..., None]

# ------------------------------------------------------------------ armature
arm = bpy.data.armatures.new(f"{KEY}_rig")
RIG = bpy.data.objects.new(f"{KEY}_rig", arm)
scene.collection.objects.link(RIG)
bpy.context.view_layer.objects.active = RIG
bpy.ops.object.mode_set(mode="EDIT")
lift = Vector((0, 0, GROUND))
for name, h, t, parent, up in CFG["bones"]:
    eb = arm.edit_bones.new(name)
    eb.head, eb.tail = Vector(h) + lift, Vector(t) + lift
    eb.align_roll(Vector(up))
    if parent:
        eb.parent = arm.edit_bones[parent]
        eb.use_connect = name.startswith("tail") and (arm.edit_bones[parent].tail - eb.head).length < 1e-6
arm.edit_bones["root"].use_deform = False
bpy.ops.object.mode_set(mode="OBJECT")

# ------------------------------------------------------------------ skin weights (distance to bone, 3 influences)
# Distance is measured in units of each bone's thickness, so the head owns the whole
# skull (the eyeballs ride on the head bone, and the face around them must too) while
# an ear only owns the thin ear. Plain distance split the face between head and neck,
# and the eyes then slid over the face whenever the head turned.
RADIUS = {"head": 0.13, "neck": 0.05, "chest": 0.09, "hips": 0.09}
segs = {bn.name: (Vector(bn.head_local), Vector(bn.tail_local)) for bn in arm.bones if bn.use_deform}


def radius(n):
    return CFG.get("radii", {}).get(n) or RADIUS.get(n) or (0.03 if n.startswith("ear") else 0.08)


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (a + ab * t - p).length


groups = {n: BODY.vertex_groups.new(name=n) for n in segs}
for v in BODY.data.vertices:
    near = sorted((seg_dist(v.co, *ab) / radius(n), n) for n, ab in segs.items())[:3]
    w = [(1.0 / max(dist, 0.05) ** 6, n) for dist, n in near]
    tot = sum(x for x, _ in w)
    for x, n in w:
        if x / tot > 0.02:
            groups[n].add([v.index], x / tot, "REPLACE")

# ------------------------------------------------------------------ glow, part 2: keep it where it belongs
# The texture is an AI patchwork atlas, so colour alone also catches stray bluish texels on
# legs and ears. Rasterise the faces that may glow (outer tail, the core) into UV space and
# keep the glow only there. Dark texels on the outer tail are energy too: TRELLIS often
# paints the plume edge near-black.
uvl = BODY.data.uv_layers.active.data


def raster(polys):
    region = np.zeros((H, W), bool)
    for poly in polys:
        uv = [Vector((uvl[li].uv[0] * W, uvl[li].uv[1] * H)) for li in poly.loop_indices]
        for k in range(1, len(uv) - 1):
            a_, b_, c_ = uv[0], uv[k], uv[k + 1]
            x0, x1 = int(max(0, min(a_.x, b_.x, c_.x) - 2)), int(min(W - 1, max(a_.x, b_.x, c_.x) + 2))
            y0, y1 = int(max(0, min(a_.y, b_.y, c_.y) - 2)), int(min(H - 1, max(a_.y, b_.y, c_.y) + 2))
            den = (b_.y - c_.y) * (a_.x - c_.x) + (c_.x - b_.x) * (a_.y - c_.y)
            if x1 < x0 or y1 < y0 or abs(den) < 1e-9:
                continue
            gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            l1 = ((b_.y - c_.y) * (gx - c_.x) + (c_.x - b_.x) * (gy - c_.y)) / den
            l2 = ((c_.y - a_.y) * (gx - c_.x) + (a_.x - c_.x) * (gy - c_.y)) / den
            region[y0:y1 + 1, x0:x1 + 1] |= (l1 >= -0.02) & (l2 >= -0.02) & (1 - l1 - l2 >= -0.02)
    return region


def bone_share(poly, names):
    idx = {groups[n].index for n in names}
    vw = [sum(gg.weight for gg in BODY.data.vertices[i].groups if gg.group in idx) for i in poly.vertices]
    return sum(vw) / len(vw)


polys = BODY.data.polygons
TAILS = [c for c in ("tail", "tailb") if f"{c}.0" in groups]   # tailb: a second tail (Zapi L6+)
outer_tail = raster([pp for pp in polys if bone_share(pp, [f"{c}.{i}" for c in TAILS for i in (2, 3, 4)]) > 0.5])
tail = raster([pp for pp in polys if bone_share(pp, [f"{c}.{i}" for c in TAILS for i in (1, 2, 3, 4)]) > 0.5])
core_at = Vector(CFG["core"]) + lift
core = raster([pp for pp in polys if (pp.center - core_at).length < 0.07])
if CFG.get("glow_bones") is not None:   # the cyan feature isn't a tail (Bubo: the ear tufts)
    tail = (raster([pp for pp in polys if bone_share(pp, CFG["glow_bones"]) > 0.5])
            if CFG["glow_bones"] else np.zeros((H, W), bool))
    outer_tail = np.zeros((H, W), bool)   # dark texels there are feathers, not energy
mask = mask * (tail | core)[..., None]

# ------------------------------------------------------------------ eyes, part 1: find them, darken the painted ones
# Painted eyes can't blink or look around. Real eyeballs go on top of them, and the
# painted eye underneath becomes a dark socket (Zapi's dark eye rims).
EYES = {}
if "eyes" not in CFG:
    print(f"WARNING: {KEY} has no 'eyes' entry, so it keeps painted eyes (no blinks or glances). "
          "Measure the pupils with measure.py and add one.")
if "eyes" in CFG:
    bvh = BVHTree.FromObject(BODY, bpy.context.evaluated_depsgraph_get())
    er = CFG["eyes"]["r"]
    socket = np.zeros((H, W), bool)
    for side in ("L", "R"):
        ex, ez = CFG["eyes"][side]
        hit, nrm, fi, _ = bvh.ray_cast(Vector((ex, -3, ez + GROUND)), Vector((0, 1, 0)))
        above = bvh.ray_cast(Vector((ex, -3, ez + GROUND + 1.6 * er)), Vector((0, 1, 0)))
        luv = sum((uvl[li].uv for li in polys[above[2]].loop_indices), Vector((0, 0))) / polys[above[2]].loop_total
        fur = rgb[min(H - 1, int(luv.y * H)), min(W - 1, int(luv.x * W))].copy()
        show = CFG["eyes"].get("show")
        if show:
            # Meshy sculpts brow tufts and lashes in front of the eye, so one ray can hit a
            # tuft whose normal points up: the ball then floats and the iris looks up. Average
            # the normal over a ring of rays around the pupil instead.
            ring = [bvh.ray_cast(Vector((ex + er * 0.8 * math.cos(a), -3, ez + GROUND + er * 0.8 * math.sin(a))),
                                 Vector((0, 1, 0))) for a in np.linspace(0, 2 * math.pi, 8, endpoint=False)]
            nrm = sum((r_[1] for r_ in ring if r_[0]), nrm).normalized()
        fwd = (nrm * 0.5 + Vector((0, -1, 0)) * 0.5).normalized()
        center = hit - nrm * er * CFG["eyes"].get("sink", 0.55)   # sink < 0.55: a deep face disc (Bubo)
        if show:
            # push the ball into the head until only `show` of its surface is outside the face
            # (0.22 is what the 0.55 sink gives on a flat face); keeps the far eye inside the
            # silhouette in the scoreboard's three-quarter view
            gold = math.pi * (3 - math.sqrt(5))
            sph = [Vector((math.cos(gold * i) * math.sqrt(1 - (1 - 2 * (i + 0.5) / 160) ** 2), 1 - 2 * (i + 0.5) / 160,
                           math.sin(gold * i) * math.sqrt(1 - (1 - 2 * (i + 0.5) / 160) ** 2))) * er for i in range(160)]
            ew = CFG["eyes"].get("shape", {}).get("width", 1.0)   # the ball is stretched sideways
            for o_ in sph:
                o_.x *= ew

            def outside(c):
                n_ = 0
                for o in sph:
                    loc, sn, _, _ = bvh.find_nearest(c + o)
                    n_ += (c + o - loc).dot(sn) > 0
                return n_ / len(sph)
            for _ in range(40):
                if outside(center) <= show:
                    break
                center = center - fwd * er * 0.05
            print(f"eye {side}: {outside(center):.2f} of the ball outside the face")
        EYES[side] = {"hit": hit, "center": center, "fwd": fwd, "fur": fur}
        # darken the painted eye under the ball; stretched like the ball (shape.width), and a
        # little wider for stretched eyes, where Meshy's painted eye white reaches the corners
        ew = CFG["eyes"].get("shape", {}).get("width", 1.0)
        reach = er * CFG["eyes"].get("reach", 1.1 if ew == 1.0 else 1.25)
        socket |= raster([pp for pp in polys if Vector(((pp.center - hit).x / ew, (pp.center - hit).y,
                                                         (pp.center - hit).z / (1.0 if ew == 1.0 else 0.75))).length < reach])
    SOCKET = socket
mask = np.maximum(mask, (outer_tail & (mx < 0.22))[..., None].astype(np.float32))
print("glow texels:", int((mask > 0.5).sum()), "of", W * H)


def lin(hexstr):
    c = [int(hexstr[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return np.array([x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c], dtype=np.float32)


def to_srgb(c):
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


# ------------------------------------------------------------------ mouth: a jaw that opens
# TRELLIS paints the mouth on a closed muzzle. Cut the surface along the mouth line (from
# the tip back to the corners), hang the lower lip and chin on a `jaw` bone, and put a dark
# inner skin just under the surface across the cut: it stays hidden while the mouth is
# shut and stretches across the gap when the jaw drops. The app opens the jaw live by
# rotating it about its X axis (negative = open), and the good/boost clips use it too.
MOUTH = CFG.get("mouth")
if not MOUTH:
    print(f"WARNING: {KEY} has no 'mouth' entry, so its mouth can't open. "
          "Measure it with measure.py --head and --side and add one.")
if MOUTH:
    MX_ = MOUTH["x"]
    (tip_y, tip_z), (cor_y, cor_z) = MOUTH["tip"], MOUTH["corner"]
    HALF = MOUTH["half"]
    hinge = Vector(MOUTH["hinge"]) + lift
    SLOPE = (cor_z - tip_z) / (cor_y - tip_y)

    def mouth_z(x, y):
        """Height of the mouth plane under (x, y), in lifted space."""
        return tip_z + SLOPE * (y - tip_y) + GROUND

    def below(c):
        return c.z < mouth_z(c.x, c.y)

    def jaw_w(c, lower, on_cut=False):
        """How much of a body point follows the jaw."""
        if not lower:
            return 0.0
        fy = max(0.0, min(1.0, (hinge.y - c.y) / (hinge.y - (cor_y - 0.01))))
        fx = max(0.0, min(1.0, (HALF + 0.02 - abs(c.x - MX_)) / 0.02))
        # in front of the corners the surface is cut, so the change can be sharp; behind
        # them it isn't, so blend over a few mm and let the cheek stretch
        blend = max(0.0005, max(0.0, min(1.0, (c.y - cor_y) / 0.04)) * 0.025)
        fz = 1.0 if on_cut else max(0.0, min(1.0, (mouth_z(c.x, c.y) - c.z) / blend))
        return fy * fx * fz

    bpy.context.view_layer.objects.active = RIG
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.edit_bones.new("jaw")
    eb.head = hinge
    eb.tail = Vector((MX_, tip_y, (tip_z + cor_z) / 2 - 0.01)) + lift
    eb.align_roll(Vector((0, 0, 1)))
    eb.parent = arm.edit_bones["head"]
    bpy.ops.object.mode_set(mode="OBJECT")
    jaw_g = BODY.vertex_groups.new(name="jaw")

    bm = bmesh.new()
    bm.from_mesh(BODY.data)
    bm.faces.ensure_lookup_table()
    dl = bm.verts.layers.deform.verify()
    uvb = bm.loops.layers.uv.active
    in_front = lambda co: co.y < cor_y and abs(co.x - MX_) < HALF   # noqa: E731
    # slice the muzzle with the mouth plane, so the lips get one clean edge (cutting along
    # the existing triangles left a zigzag of fur slivers)
    near = [f for f in bm.faces if all(v.co.y < cor_y + 0.01 and abs(v.co.x - MX_) < HALF + 0.01
                                       and abs(v.co.z - mouth_z(v.co.x, v.co.y)) < 0.03 for v in f.verts)]
    geom = set(near) | {e for f in near for e in f.edges} | {v for f in near for v in f.verts}
    res = bmesh.ops.bisect_plane(bm, geom=list(geom), dist=1e-5,
                                 plane_co=Vector((MX_, tip_y, tip_z)) + lift,
                                 plane_no=Vector((0, -SLOPE, 1)).normalized())
    cut = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge) and len(e.link_faces) == 2
           and in_front((e.verts[0].co + e.verts[1].co) / 2)]
    cut_verts = {v for e in cut for v in e.verts}

    # the inner skin: the faces around the cut, copied 3 mm inwards, NOT cut
    band = {f for v in cut_verts for f in v.link_faces}
    for _ in range(3):
        band |= {g for f in band for v in f.verts for g in v.link_faces}
    sk = bmesh.new()
    sdl = sk.verts.layers.deform.verify()
    suv = sk.loops.layers.uv.new()
    vmap = {}
    for f in band:
        for v in f.verts:
            if v not in vmap:
                nv = sk.verts.new(v.co - v.normal * 0.003)
                w = 0.5 * jaw_w(v.co, True, True) if v in cut_verts else jaw_w(v.co, below(v.co))
                nv[sdl][0] = 1.0 - w          # the skin's own groups: 0 head, 1 jaw
                if w > 0:
                    nv[sdl][1] = w
                vmap[v] = (nv, w)
        nf = sk.faces.new([vmap[v][0] for v in f.verts])
        for lp, v in zip(nf.loops, f.verts):
            lp[suv].uv = (0.5, min(0.98, max(0.02, vmap[v][1])))   # v = jaw share: dark roof → pink tongue
    print(f"mouth: {len(cut)} edges cut, inner skin {len(sk.faces)} faces")

    bmesh.ops.split_edges(bm, edges=cut)
    for v in bm.verts:
        if not v.link_faces:
            continue
        c = sum((f.calc_center_median() for f in v.link_faces), Vector()) / len(v.link_faces)
        on_cut = v.is_boundary and in_front(v.co)
        w = jaw_w(v.co, below(c), on_cut)
        if w <= 0:
            continue
        d = v[dl]
        for gi in list(d.keys()):
            d[gi] *= 1.0 - w
        d[jaw_g.index] = w
    bm.to_mesh(BODY.data)
    bm.free()
    BODY.data.update()
    uvl = BODY.data.uv_layers.active.data
    polys = BODY.data.polygons

    # TRELLIS paints the mouth on as a smile: it curves up off the straight cut towards
    # the corners and runs on up the cheek. When the jaw drops, that painted line reads
    # as a mouth longer than the opening. Paint it out: dark texels just above the cut
    # near the corners, and around and behind the corners, are filled in from the fur
    # around them. The lip line along the cut itself stays.
    er_ = MOUTH.get("erase", 0.09)

    def smile_zone(c):
        dz = c.z - mouth_z(c.x, c.y)
        if not (0.012 < abs(c.x - MX_) < HALF + 0.05) or dz > 0.055:
            return False
        if cor_y < c.y < cor_y + er_:
            return dz > -0.006
        if cor_y - 0.035 < c.y <= cor_y:
            return dz > 0.004
        return c.y <= cor_y and abs(c.x - MX_) > 0.025 and dz > 0.006   # further forward: clear of the nose

    cheek = raster([pp for pp in polys if smile_zone(pp.center)])
    dark = cheek & (rgb.max(-1) < MOUTH.get("erase_below", 0.64))
    for axis in (0, 1):                       # take the line's soft edge too
        dark = dark | np.roll(dark, 1, axis) | np.roll(dark, -1, axis)
    dark &= cheek
    fill = ~dark
    for _ in range(40):
        if fill.all():
            break
        acc = np.zeros_like(rgb)
        cnt = np.zeros(fill.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            f_ = np.roll(np.roll(fill, dy, 0), dx, 1)
            acc += np.roll(np.roll(rgb, dy, 0), dx, 1) * f_[..., None]
            cnt += f_
        take = ~fill & (cnt > 0)
        rgb[take] = acc[take] / cnt[take][..., None]
        fill = fill | take
    print(f"mouth: painted line erased behind the corners ({int(dark.sum())} texels)")

    me_ = bpy.data.meshes.new("mouth")
    sk.to_mesh(me_)
    sk.free()
    MOUTH_OB = bpy.data.objects.new("mouth", me_)
    scene.collection.objects.link(MOUTH_OB)
    for n in ("head", "jaw"):
        MOUTH_OB.vertex_groups.new(name=n)
    for poly in me_.polygons:
        poly.use_smooth = True
    gimg = bpy.data.images.new(f"{KEY}_mouth", 4, 64, alpha=False)
    vv = (np.arange(64) + 0.5) / 64
    roof, tongue = to_srgb(lin("2A0C0C")), to_srgb(lin("B4525A"))
    gpx = roof[None] * (1 - vv[:, None] ** 1.5) + tongue[None] * vv[:, None] ** 1.5
    gpx = np.repeat(gpx[:, None, :], 4, 1)
    gimg.pixels.foreach_set(np.concatenate([gpx, np.ones((64, 4, 1))], -1).astype(np.float32).ravel())
    gimg.filepath_raw = os.path.join(OUT, f"{KEY}_mouth.png")
    gimg.file_format = "PNG"
    gimg.save()
    mm = bpy.data.materials.new(f"{KEY}_mouth")
    mm.use_nodes = True
    mp = mm.node_tree.nodes["Principled BSDF"]
    mt = mm.node_tree.nodes.new("ShaderNodeTexImage")
    mt.image = gimg
    mm.node_tree.links.new(mt.outputs["Color"], mp.inputs["Base Color"])
    mp.inputs["Roughness"].default_value = 0.45
    mm.use_backface_culling = False
    me_.materials.append(mm)
    MOUTH_OB.parent = RIG
    mod = MOUTH_OB.modifiers.new("rig", "ARMATURE")
    mod.object = RIG



lum = (0.35 + 0.65 * np.clip(mx / 0.8, 0, 1))[..., None]
albedo = rgb * (1 - mask) + to_srgb(lin("8FF2FF")) * lum * mask
if EYES:
    # a deep face disc (Bubo) pokes through under the ball: paint it the disc colour, not a dark hole
    albedo[SOCKET] = to_srgb(lin(CFG["eyes"].get("socket", "2E1810")))
emit = to_srgb(lin("3FE3FF")) * mask * lum


def save_img(name, arr):
    img = bpy.data.images.new(name, W, H, alpha=False)
    img.pixels.foreach_set(np.concatenate([arr, np.ones((H, W, 1), np.float32)], -1).astype(np.float32).ravel())
    img.filepath_raw = os.path.join(OUT, name + ".png")
    img.file_format = "PNG"
    img.save()
    return img


tex_node.image = save_img(f"{KEY}_albedo", albedo)
nt = mat.node_tree
p = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
en = nt.nodes.new("ShaderNodeTexImage")
en.image = save_img(f"{KEY}_emit", emit)
nt.links.new(en.outputs["Color"], p.inputs["Emission Color"])
p.inputs["Emission Strength"].default_value = 3.0
p.inputs["Roughness"].default_value = 0.8
if not p.inputs["Metallic"].is_linked:
    p.inputs["Metallic"].default_value = 0.0
mat.name = f"{KEY}_fur"

am = BODY.modifiers.new("rig", "ARMATURE")
am.object = RIG
BODY.parent = RIG

# ------------------------------------------------------------------ clips
scene.render.fps = 30
PB = RIG.pose.bones
for pb in PB:
    pb.rotation_mode = "XYZ"
RIG.animation_data_create()
CHARACTER = KEY.split("_")[0]
if CHARACTER not in SIGNATURES:
    print(f"WARNING: no signature movement for '{CHARACTER}' in SIGNATURES.")
for name, (end, tracks) in {**CLIPS, **({"signature": SIGNATURES[CHARACTER]} if CHARACTER in SIGNATURES else {})}.items():
    for pb in PB:
        pb.rotation_euler = (0, 0, 0)
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    RIG.animation_data.action = act
    for pb in PB:
        if pb.name == "root":
            continue
        # the second tail (tailb.*, the mirror image of tail.*) copies the tail's keys, mirrored
        mirror = pb.name.startswith("tailb.")
        for f, v in tracks.get(pb.name.replace("tailb.", "tail.") if mirror else pb.name) or [(1, (0, 0, 0))]:
            if mirror:
                v = (v[0], -v[1], -v[2])
            if pb.name == "head":
                v = (v[0], v[1] + CFG.get("head_yaw", 0), v[2])
            pb.rotation_euler = [math.radians(a) for a in v]
            pb.keyframe_insert("rotation_euler", frame=f, group=pb.name)
    act.frame_range = (1, end)
for pb in PB:
    pb.rotation_euler = (0, 0, 0)
RIG.animation_data.action = bpy.data.actions["idle"]
scene.frame_set(1)

# ------------------------------------------------------------------ eyes, part 2: eyeballs and lids on their own bones
# eye.* turns the eyeball (gaze); lid.* rotates the upper lid about the eye's horizontal
# axis (blink, expression). The app drives both live. Neither deforms the body.


def tex(name, w, h, fn):
    img = bpy.data.images.new(name, w, h, alpha=False)
    ys, xs = np.mgrid[0:h, 0:w]
    arr = fn((xs + 0.5) / w, (ys + 0.5) / h).astype(np.float32)
    img.pixels.foreach_set(np.concatenate([arr, np.ones((h, w, 1), np.float32)], -1).ravel())
    img.filepath_raw = os.path.join(OUT, name + ".png")
    img.file_format = "PNG"
    img.save()
    return img


def hexc(hx):
    return to_srgb(lin(hx))


def iris_fn(u, v):
    d = np.hypot(u - 0.5, v - 0.5)[..., None]
    t = np.clip(d / 0.33, 0, 1)
    col = np.where(d < 0.33, hexc("F7B53C") * (1 - t) + hexc("B0580A") * t, hexc("F3ECE3"))
    col = np.where((d > 0.30) & (d < 0.335), hexc("4A2205"), col)
    col = np.where(d < 0.14, hexc("0A0503"), col)
    for gx, gy, gr in ((0.40, 0.62, 0.055), (0.60, 0.42, 0.022)):
        col = np.where(np.hypot(u - gx, v - gy)[..., None] < gr, np.float32(1.0), col)
    return col


def lid_fn(fur):
    def fn(u, v):
        vv = v[..., None]
        return np.where(vv < 0.12, hexc("23100A"), np.where(vv < 0.26, hexc("3A1C12"), fur * np.ones_like(vv)))
    return fn


def tex_mat(name, img, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    pp = m.node_tree.nodes["Principled BSDF"]
    t = m.node_tree.nodes.new("ShaderNodeTexImage")
    t.image = img
    m.node_tree.links.new(t.outputs["Color"], pp.inputs["Base Color"])
    pp.inputs["Roughness"].default_value = rough
    m.use_backface_culling = False
    return m


LID_REST = 20.0   # degrees the lid edge sits above the eye's equator at rest: a smug half-lid
if EYES:
    er = CFG["eyes"]["r"]
    # eye shape (optional, per level): the ball stays round enough to turn, the lids shape the
    # opening. width: ball and lids stretched sideways; open: upper lid edge above the equator
    # (degrees); low: lower lid edge below it (None = no lower lid); tilt: the corner line
    # rises toward the outer corner (degrees). Upper + lower lid edges are great circles, so
    # seen from the front they arch up and down and meet at the corners: an almond.
    SHAPE = CFG["eyes"].get("shape", {})
    EW, OPEN, LOW, TILT = (SHAPE.get("width", 1.0), SHAPE.get("open", LID_REST), SHAPE.get("low"),
                           SHAPE.get("tilt", 0.0))
    iris_img = tex(f"{KEY}_iris", 256, 256, iris_fn)
    eye_mat = tex_mat(f"{KEY}_eye", iris_img, 0.08)
    eye_mat.node_tree.nodes["Image Texture"].extension = "EXTEND"   # sclera beyond the texture edge
    bpy.context.view_layer.objects.active = RIG
    bpy.ops.object.mode_set(mode="EDIT")
    for side, e in EYES.items():
        for kind in ("eye", "lid") + (("lidlow",) if LOW is not None else ()):
            eb = arm.edit_bones.new(f"{kind}.{side}")
            eb.head = e["center"]
            eb.tail = e["center"] + e["fwd"] * er * 1.5
            eb.align_roll(Vector((0, 0, 1)))
            eb.parent = arm.edit_bones["head"]
            eb.use_deform = False
    bpy.ops.object.mode_set(mode="OBJECT")
    TO_BONE = Matrix.Rotation(math.radians(-90), 4, "X")   # sphere pole (+Z) onto the bone's +Y
    WIDE = Matrix.Diagonal((EW, 1.0, 1.0))

    def lid_shell(side, upper, deg):
        """Half of a shell slightly bigger than the ball, cut along the tilted corner line and
        turned `deg` about X (bone space: +Y forward, +Z up, +X = the character's right)."""
        R = er * 1.14
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=24, radius=R, matrix=TO_BONE)
        out = 1.0 if side == "R" else -1.0            # +X points to the outer corner on the right eye
        t = math.radians(TILT)
        n = Vector((-out * math.sin(t), 0.0, math.cos(t)))   # corner line z = out * tan(t) * x
        co = Vector((0, 0, 0))
        if not upper:
            n = -n
            co = -n * R * 0.15   # the lower lid reaches a little above the corner line, so the
            #                      lids overlap at the corners and no eyeball shows when shut
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co,
                               plane_no=n, clear_inner=True)
        uvlay = bm.loops.layers.uv.new()
        for f in bm.faces:
            for lp in f.loops:
                lp[uvlay].uv = (0.5, math.asin(max(-1.0, min(1.0, lp.vert.co.dot(n) / R))) / (math.pi / 2))
        bmesh.ops.transform(bm, verts=bm.verts, matrix=WIDE)
        bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(math.radians(deg if upper else -deg), 3, "X"))
        return bm

    for side, e in EYES.items():
        # eyeball, in the bone's own space (+Y forward), iris on the front pole; the UVs
        # undo the sideways stretch so the iris stays round
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=16, radius=er, matrix=TO_BONE)
        uvlay = bm.loops.layers.uv.new()
        for f in bm.faces:
            for lp in f.loops:
                c = lp.vert.co
                lp[uvlay].uv = (c.x * EW / er * 0.5 + 0.5, c.z / er * 0.5 + 0.5) if c.y > 0 else (0.02, 0.02)
        bmesh.ops.transform(bm, verts=bm.verts, matrix=WIDE)
        me_ = bpy.data.meshes.new(f"eyeball.{side}")
        bm.to_mesh(me_)
        bm.free()
        ball = bpy.data.objects.new(f"eyeball.{side}", me_)
        scene.collection.objects.link(ball)
        me_.materials.append(eye_mat)
        lid_mat = tex_mat(f"{KEY}_lid_{side}", tex(f"{KEY}_lid_{side}", 8, 64, lid_fn(e["fur"])), 0.7)
        parts = [(ball, f"eye.{side}")]
        # upper lid opened OPEN degrees (the app blinks it about X); lower lid fixed
        for kind, upper, deg in (("lid", True, OPEN),) + ((("lidlow", False, LOW),) if LOW is not None else ()):
            bm = lid_shell(side, upper, deg)
            me_ = bpy.data.meshes.new(f"{kind}.{side}")
            bm.to_mesh(me_)
            bm.free()
            ob = bpy.data.objects.new(f"{kind}.{side}", me_)
            scene.collection.objects.link(ob)
            me_.materials.append(lid_mat)
            parts.append((ob, f"{kind}.{side}"))
        for ob, bone in parts:
            for poly in ob.data.polygons:
                poly.use_smooth = True
            ob.parent = RIG
            ob.parent_type = "BONE"
            ob.parent_bone = bone
            bpy.context.view_layer.update()
            ob.matrix_world = RIG.matrix_world @ arm.bones[bone].matrix_local
    for name, tracks in LID_CLIPS.items():
        RIG.animation_data.action = bpy.data.actions[name]
        for bone, keys in tracks.items():
            pb = RIG.pose.bones.get(bone)
            if pb is None:
                continue
            pb.rotation_mode = "XYZ"
            for f, v in keys:
                pb.rotation_euler = [math.radians(a) for a in v]
                pb.keyframe_insert("rotation_euler", frame=f, group=bone)
            pb.rotation_euler = (0, 0, 0)
    RIG.animation_data.action = bpy.data.actions["idle"]
    scene.frame_set(1)

# ------------------------------------------------------------------ screen face (bots): expressions on the face screen
# A bot's face is a dark screen with glowing shapes (AVATAR_EVOLUTION §9), so it gets no
# eyeballs or jaw. Instead: find the screen (dark texels seen from the front), cover it with
# a glass backing, and put one glowing layer per expression just above it. Each layer hangs
# on its own face.<expr> bone (child of head); the clips show one layer at a time by keying
# the bones' scale (1 = shown, ~0 = folded away behind the glass), so expressions play from
# the baked clips with no app code. SCREEN_CLIPS says which face shows when.
FACE_HIDE = 0.001


def sdf_capsule(X, Y, a, b, r):
    ax, ay = a
    bx, by = b
    px, py, dx, dy = X - ax, Y - ay, bx - ax, by - ay
    t = np.clip((px * dx + py * dy) / max(dx * dx + dy * dy, 1e-9), 0, 1)
    return np.hypot(px - dx * t, py - dy * t) - r


def sdf_arc(X, Y, c, R, a0, a1, r, n=24):
    pts = [(c[0] + R * math.cos(math.radians(a0 + (a1 - a0) * k / n)),
            c[1] + R * math.sin(math.radians(a0 + (a1 - a0) * k / n))) for k in range(n + 1)]
    return np.minimum.reduce([sdf_capsule(X, Y, pts[k], pts[k + 1], r) for k in range(n)])


def sdf_ellipse(X, Y, c, rx, ry):
    return (np.hypot((X - c[0]) / rx, (Y - c[1]) / ry) - 1.0) * min(rx, ry)


def sdf_halfplane(X, Y, p, nrm):   # inside where (q - p) . nrm < 0
    return (X - p[0]) * nrm[0] + (Y - p[1]) * nrm[1]


def face_sdf(expr, style, X, Y, A):
    """Signed distance of one expression's shapes; units: screen height = 1, width = A."""
    ex = (A * 0.27, A * 0.73)   # eye centres (screen left = the character's right eye)
    ey, my, cx = 0.60, 0.30, A * 0.5
    S = 0.052                   # stroke radius
    ds = []

    def eyes(kind, side=None):
        for i, x in enumerate(ex):
            if side is not None and i != side:
                continue
            if kind == "arc":            # happy closed eye (an upside-down U)
                ds.append(sdf_arc(X, Y, (x, ey - 0.06), 0.13, 20, 160, S))
            elif kind == "line":         # blink / sleepy
                ds.append(sdf_capsule(X, Y, (x - 0.12, ey - 0.02), (x + 0.12, ey - 0.02), S * 0.8))
            elif kind == "droop":        # yawn: lines sagging outwards
                o = -1 if i == 0 else 1
                ds.append(sdf_capsule(X, Y, (x - 0.12 * o, ey), (x + 0.12 * o, ey - 0.06), S * 0.8))
            elif kind == "dot":
                ds.append(sdf_ellipse(X, Y, (x, ey), 0.11, 0.12))
            elif kind == "ring":         # wow: big outline eyes with a small pupil
                ds.append(np.abs(sdf_ellipse(X, Y, (x, ey), 0.15, 0.16)) - S * 0.75)
                ds.append(sdf_ellipse(X, Y, (x, ey), 0.05, 0.05))
            elif kind == "flat":         # focused: a disc with a flat top
                ds.append(np.maximum(sdf_ellipse(X, Y, (x, ey - 0.02), 0.12, 0.12),
                                     sdf_halfplane(X, Y, (x, ey + 0.05), (0, 1))))
            elif kind == "angry":        # a disc under a brow slanting down to the middle
                inward = 1 if i == 0 else -1
                nrm = (-0.75 * inward, 1.0)
                ds.append(np.maximum(sdf_ellipse(X, Y, (x, ey - 0.02), 0.13, 0.12),
                                     sdf_halfplane(X, Y, (x, ey + 0.02), nrm)))
            elif kind == "squint":       # laughing angry eyes: > <
                inward = 1 if i == 0 else -1
                tip = (x + 0.08 * inward, ey)
                ds.append(sdf_capsule(X, Y, (x - 0.08 * inward, ey + 0.08), tip, S * 0.8))
                ds.append(sdf_capsule(X, Y, (x - 0.08 * inward, ey - 0.08), tip, S * 0.8))
            elif kind == "chevron":      # the winking eye: a sideways V
                inward = 1 if i == 0 else -1
                tip = (x - 0.07 * inward, ey)
                ds.append(sdf_capsule(X, Y, (x + 0.07 * inward, ey + 0.07), tip, S * 0.8))
                ds.append(sdf_capsule(X, Y, (x + 0.07 * inward, ey - 0.07), tip, S * 0.8))

    def mouth(kind):
        if kind == "grin":       # wide smile
            ds.append(sdf_arc(X, Y, (cx, my + 0.16), 0.22, 205, 335, S))
        elif kind == "smile":    # small smile
            ds.append(sdf_arc(X, Y, (cx, my + 0.10), 0.12, 215, 325, S * 0.9))
        elif kind == "frown":
            ds.append(sdf_arc(X, Y, (cx, my - 0.10), 0.12, 35, 145, S * 0.9))
        elif kind == "open":     # laughing: a D on its back
            ds.append(np.maximum(sdf_ellipse(X, Y, (cx, my + 0.08), 0.22, 0.24),
                                 sdf_halfplane(X, Y, (cx, my + 0.08), (0, 1))))
        elif kind == "o":
            ds.append(np.abs(sdf_ellipse(X, Y, (cx, my - 0.01), 0.075, 0.09)) - S * 0.7)
        elif kind == "tall_o":   # yawn
            ds.append(sdf_ellipse(X, Y, (cx, my - 0.02), 0.09, 0.13))
        elif kind == "line":
            ds.append(sdf_capsule(X, Y, (cx - 0.10, my), (cx + 0.10, my), S * 0.8))
        elif kind == "smirk":
            ds.append(sdf_arc(X, Y, (cx + 0.04, my + 0.12), 0.13, 230, 330, S * 0.9))

    rest_eyes = {"happy": "arc", "focused": "flat", "angry": "angry"}[style]
    rest_mouth = {"happy": "grin", "focused": "smile", "angry": "frown"}[style]
    if expr == "rest":
        eyes(rest_eyes); mouth(rest_mouth)
    elif expr == "blink":
        eyes("line"); mouth(rest_mouth)
    elif expr == "happy":
        eyes("squint" if style == "angry" else "arc"); mouth("grin")
    elif expr == "laugh":
        eyes("squint" if style == "angry" else "arc"); mouth("open")
    elif expr == "wow":
        eyes("ring"); mouth("o")
    elif expr == "stare":
        eyes("dot"); mouth("line")
    elif expr == "yawn":
        eyes("droop"); mouth("tall_o")
    elif expr == "wink":   # the character's left eye (screen right) winks, as lid.L does
        eyes("dot", 0); eyes("chevron", 1); mouth("smirk")
    return np.minimum.reduce(ds)


SCREEN_EXPRS = ("rest", "blink", "happy", "laugh", "wow", "stare", "yawn", "wink")
# clip -> [(frame, expression)]; the face holds until the next change
SCREEN_CLIPS = {
    "idle": [(1, "rest"), (58, "blink"), (62, "rest"), (100, "blink"), (103, "rest")],
    "turn": [(1, "rest"), (4, "blink"), (7, "rest")],
    "good": [(1, "rest"), (4, "happy"), (25, "rest")],
    "boost": [(1, "rest"), (3, "wow"), (19, "rest")],
    "laugh": [(1, "rest"), (3, "laugh"), (33, "rest")],
    "wow": [(1, "rest"), (6, "wow"), (39, "rest")],
    "stare": [(1, "rest"), (7, "stare"), (41, "rest")],
    "yawn": [(1, "rest"), (8, "yawn"), (51, "rest")],
    "wink": [(1, "rest"), (4, "wink"), (18, "rest")],
    "signature": [(1, "rest"), (5, "blink"), (8, "rest")],
}

SCREEN = CFG.get("screen")
if SCREEN:
    me = BODY.data
    me.calc_loop_triangles()
    stris = list(me.loop_triangles)
    sbvh = BVHTree.FromPolygons([v.co for v in me.vertices], [t.vertices[:] for t in stris])
    suv = me.uv_layers.active.data
    (bx0, bx1), (bz0, bz1) = SCREEN["box"]
    STEP = 0.004
    NX, NZ = int((bx1 - bx0) / STEP), int((bz1 - bz0) / STEP)
    dark = np.zeros((NZ, NX), bool)
    for j in range(NZ):
        for i in range(NX):
            p, n_, fi, _ = sbvh.ray_cast(Vector((bx0 + (i + 0.5) * STEP, -3, bz0 + (j + 0.5) * STEP + GROUND)),
                                         Vector((0, 1, 0)))
            if p is None:
                continue
            t = stris[fi]
            a, b, c = (me.vertices[k].co for k in t.vertices)
            ua, ub, uc = (Vector((suv[k].uv[0], suv[k].uv[1], 0)) for k in t.loops)
            uv = barycentric_transform(p, a, b, c, ua, ub, uc)
            dark[j, i] = rgb[min(H - 1, int(uv.y % 1 * H)), min(W - 1, int(uv.x % 1 * W))].max() < SCREEN.get("dark", 0.33)
    # the face shapes are bright holes in the dark screen: fill each row and column span,
    # keep both (a convex-ish screen), then shrink by one cell to stay off the white frame
    rowf = np.zeros_like(dark)
    colf = np.zeros_like(dark)
    for j in range(NZ):
        idx = np.flatnonzero(dark[j])
        if idx.size > 2:
            rowf[j, idx[0]:idx[-1] + 1] = True
    for i in range(NX):
        idx = np.flatnonzero(dark[:, i])
        if idx.size > 2:
            colf[idx[0]:idx[-1] + 1, i] = True
    smask = rowf & colf
    smask = smask & np.roll(smask, 1, 0) & np.roll(smask, -1, 0) & np.roll(smask, 1, 1) & np.roll(smask, -1, 1)
    js, is_ = np.nonzero(smask)
    j0, j1, i0, i1 = js.min(), js.max() + 1, is_.min(), is_.max() + 1
    sx0, sx1 = bx0 + i0 * STEP, bx0 + i1 * STEP
    sz0, sz1 = bz0 + j0 * STEP + GROUND, bz0 + j1 * STEP + GROUND
    A = (sx1 - sx0) / (sz1 - sz0)
    print(f"screen x {sx0:.3f}..{sx1:.3f} z {sz0 - GROUND:.3f}..{sz1 - GROUND:.3f} (aspect {A:.2f})")
    crop = smask[j0:j1, i0:i1].astype(np.float32)

    # textures: TH rows x TW columns, row 0 at the bottom (v up)
    TH = 256
    TW = int(TH * A)
    ys, xs = np.mgrid[0:TH, 0:TW]
    U, V = (xs + 0.5) / TW, (ys + 0.5) / TH
    ci = np.clip((U * crop.shape[1]).astype(int), 0, crop.shape[1] - 1)
    cj = np.clip((V * crop.shape[0]).astype(int), 0, crop.shape[0] - 1)
    alpha = crop[cj, ci]
    for axis in (0, 1):   # soften the stair-stepped outline
        alpha = sum(np.roll(alpha, k, axis) for k in range(-3, 4)) / 7
    alpha = np.clip((alpha - 0.5) * 3 + 0.5, 0, 1)

    def rgba_img(name, rgb_, a_):
        img = bpy.data.images.new(name, TW, TH, alpha=True)
        img.pixels.foreach_set(np.concatenate([rgb_, a_[..., None]], -1).astype(np.float32).ravel())
        img.filepath_raw = os.path.join(OUT, name + ".png")
        img.file_format = "PNG"
        img.save()
        return img

    glass = np.ones((TH, TW, 3), np.float32) * hexc(SCREEN.get("glass", "10151F"))
    sheen = np.clip(1 - np.abs((U * A * 0.6 + V) - 1.15) / 0.12, 0, 1) * (V > 0.55)   # a soft diagonal glint
    glass = glass + sheen[..., None] * 0.06
    glass_img = rgba_img(f"{KEY}_screen", glass, alpha)
    FACE_RGB = hexc(SCREEN["color"])
    X_, Y_ = U * A, V
    face_imgs = {}
    for expr in SCREEN_EXPRS:
        d = face_sdf(expr, SCREEN["style"], X_, Y_, A)
        cov = np.clip(0.5 - d * TH, 0, 1) * (alpha > 0.5)
        face_imgs[expr] = rgba_img(f"{KEY}_face_{expr}", np.ones((TH, TW, 3), np.float32) * FACE_RGB, cov)

    def screen_mat(name, img, emit, cutout):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        pp = nt.nodes["Principled BSDF"]
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = img
        t.extension = "EXTEND"
        nt.links.new(t.outputs["Color"], pp.inputs["Base Color"])
        # the glass is only satin: the grid follows the bumpy generated surface, so a sharp
        # gloss breaks into blotches; the faces are pure light with no reflection
        pp.inputs["Roughness"].default_value = 0.38 if cutout else 1.0
        if not cutout:
            pp.inputs["Specular IOR Level"].default_value = 0.0
        if cutout:   # glTF MASK (rendered with the opaque body, no sorting against the faces)
            rnd = nt.nodes.new("ShaderNodeMath")
            rnd.operation = "ROUND"
            nt.links.new(t.outputs["Alpha"], rnd.inputs[0])
            nt.links.new(rnd.outputs[0], pp.inputs["Alpha"])
        else:        # glTF BLEND
            nt.links.new(t.outputs["Alpha"], pp.inputs["Alpha"])
            m.surface_render_method = "BLENDED"
        if emit:
            nt.links.new(t.outputs["Color"], pp.inputs["Emission Color"])
            pp.inputs["Emission Strength"].default_value = emit
        m.use_backface_culling = False
        return m

    # a grid over the screen rectangle, each vertex on the head's surface, lifted by `off`
    # (`lift`: clears the painted face, which Meshy often embosses a few mm)
    GX = 48
    GZ = max(8, int(GX / A))
    grid = []
    for j in range(GZ + 1):
        for i in range(GX + 1):
            x = sx0 + (sx1 - sx0) * i / GX
            z = sz0 + (sz1 - sz0) * j / GZ
            p, n_, _, _ = sbvh.ray_cast(Vector((x, -3, z)), Vector((0, 1, 0)))
            if p is None:
                p, n_ = Vector((x, -0.3, z)), Vector((0, -1, 0))
            grid.append((p, n_.normalized(), (i / GX, j / GZ)))

    def screen_layer(name, off, mat):
        bm = bmesh.new()
        uvlay = bm.loops.layers.uv.new()
        vs = [bm.verts.new(p + n_ * off) for p, n_, _ in grid]
        for j in range(GZ):
            for i in range(GX):
                k = j * (GX + 1) + i
                quad = (k, k + 1, k + GX + 2, k + GX + 1)
                f = bm.faces.new([vs[q] for q in quad])
                for lp, q in zip(f.loops, quad):
                    lp[uvlay].uv = grid[q][2]
        me_ = bpy.data.meshes.new(name)
        bm.to_mesh(me_)
        bm.free()
        ob = bpy.data.objects.new(name, me_)
        scene.collection.objects.link(ob)
        me_.materials.append(mat)
        for poly in me_.polygons:
            poly.use_smooth = True
        return ob

    centre = grid[(GZ // 2) * (GX + 1) + GX // 2][0]
    bpy.context.view_layer.objects.active = RIG
    bpy.ops.object.mode_set(mode="EDIT")
    for expr in SCREEN_EXPRS:
        eb = arm.edit_bones.new(f"face.{expr}")
        eb.head = centre + Vector((0, 0.04, 0))   # behind the glass: a folded face hides here
        eb.tail = eb.head + Vector((0, 0, 0.03))
        eb.align_roll(Vector(FWD))
        eb.parent = arm.edit_bones["head"]
        eb.use_deform = False
    bpy.ops.object.mode_set(mode="OBJECT")
    parts = [(screen_layer("screen", SCREEN.get("lift", 0.007), screen_mat(f"{KEY}_screen", glass_img, 0, True)), "head")]
    for expr in SCREEN_EXPRS:
        parts.append((screen_layer(f"face.{expr}", SCREEN.get("lift", 0.007) + 0.003,
                                   screen_mat(f"{KEY}_face_{expr}", face_imgs[expr], SCREEN.get("emit", 1.6), False)),
                      f"face.{expr}"))
    for ob, bone in parts:
        M = RIG.matrix_world @ arm.bones[bone].matrix_local
        ob.data.transform(M.inverted())
        ob.parent = RIG
        ob.parent_type = "BONE"
        ob.parent_bone = bone
        bpy.context.view_layer.update()
        ob.matrix_world = M

    # which face shows when: scale keys, constant between changes
    prefs = bpy.context.preferences.edit
    old_interp = prefs.keyframe_new_interpolation_type
    prefs.keyframe_new_interpolation_type = "CONSTANT"
    for clip, (end, _) in {**CLIPS, **({"signature": SIGNATURES[CHARACTER]} if CHARACTER in SIGNATURES else {})}.items():
        if clip not in bpy.data.actions:
            continue
        RIG.animation_data.action = bpy.data.actions[clip]
        for f, shown in SCREEN_CLIPS.get(clip, [(1, "rest")]):
            for expr in SCREEN_EXPRS:
                pb = RIG.pose.bones[f"face.{expr}"]
                pb.scale = (1, 1, 1) if expr == shown else (FACE_HIDE,) * 3
                pb.keyframe_insert("scale", frame=f, group=pb.name)
        for expr in SCREEN_EXPRS:   # hold the last face to the clip's end
            pb = RIG.pose.bones[f"face.{expr}"]
            pb.keyframe_insert("scale", frame=end, group=pb.name)
            pb.scale = (1, 1, 1)
    prefs.keyframe_new_interpolation_type = old_interp
    RIG.animation_data.action = bpy.data.actions["idle"]
    scene.frame_set(1)

# glow anchors: the app hangs a soft glow sprite on these
for nm, bone, at in (("core_glow", "chest", Vector(CFG["core"]) + lift),
                     *([("tail_glow", "tail.3", arm.bones["tail.3"].head_local)] if "tail.3" in arm.bones else []),
                     *([("tail_glow_b", "tailb.3", arm.bones["tailb.3"].head_local)] if "tailb.3" in arm.bones else [])):
    emp = bpy.data.objects.new(nm, None)
    scene.collection.objects.link(emp)
    emp.parent = RIG
    emp.parent_type = "BONE"
    emp.parent_bone = bone
    bpy.context.view_layer.update()
    emp.matrix_world = RIG.matrix_world @ Matrix.Translation(at)

# ------------------------------------------------------------------ export (body midline on the origin)
cx, cy = CFG["center"]
RIG.location = (-cx, -cy, 0)
bpy.ops.object.select_all(action="DESELECT")
RIG.select_set(True)
for ob in RIG.children:
    ob.select_set(True)
bpy.context.view_layer.objects.active = RIG
glb = os.path.join(OUT_ROOT, f"{KEY}.glb")
bpy.ops.export_scene.gltf(
    filepath=glb, export_format="GLB", use_selection=True, export_animations=True,
    export_animation_mode="ACTIONS", export_force_sampling=True, export_image_format="WEBP",
    export_cameras=False, export_lights=False)
print("GLB", glb, os.path.getsize(glb) // 1024, "KB")

# ------------------------------------------------------------------ previews (framed from the mesh bounds)
world = bpy.data.worlds.new("Preview")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.4, 0.41, 0.43, 1)
bg.inputs["Strength"].default_value = 0.5
dg = bpy.context.evaluated_depsgraph_get()
pts = [RIG.matrix_world @ v.co for v in BODY.data.vertices]
lo = Vector([min(q[i] for q in pts) for i in range(3)])
hi = Vector([max(q[i] for q in pts) for i in range(3)])
ctr, size = (lo + hi) / 2, max(hi - lo)
for nm, off, e in (("Key", (-1.6, -1.8, 1.4), 120), ("Fill", (1.6, -1.4, 0.3), 35), ("Rim", (0.6, 1.6, 1.1), 140)):
    ld = bpy.data.lights.new(nm, "AREA")
    ld.energy, ld.size = e, 1.5
    ob = bpy.data.objects.new(nm, ld)
    scene.collection.objects.link(ob)
    ob.location = ctr + Vector(off)
    ob.rotation_euler = (ctr - ob.location).to_track_quat("-Z", "Y").to_euler()
cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
scene.collection.objects.link(cam)
scene.camera = cam
cam.data.lens = 60
scene.render.engine = "BLENDER_EEVEE"
scene.view_settings.view_transform = "Standard"
try:
    tree = bpy.data.node_groups.new("Glow", "CompositorNodeTree")
    scene.compositing_node_group = tree
    rl = tree.nodes.new("CompositorNodeRLayers")
    gl = tree.nodes.new("CompositorNodeGlare")
    out = tree.nodes.new("NodeGroupOutput")
    tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    gl.inputs["Type"].default_value = "Bloom"
    for k, v in (("Threshold", 1.4), ("Strength", 0.6), ("Size", 0.5)):
        gl.inputs[k].default_value = v
    tree.links.new(rl.outputs["Image"], gl.inputs["Image"])
    tree.links.new(gl.outputs["Image"], out.inputs[0])
except Exception as exc:  # noqa: BLE001
    print("glow unavailable:", exc)


def shoot(path, cam_loc, target, res):
    cam.location = cam_loc
    cam.rotation_euler = (Vector(target) - Vector(cam_loc)).to_track_quat("-Z", "Y").to_euler()
    scene.render.resolution_x = scene.render.resolution_y = res
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


view = Vector((-0.35, -1.0, 0.18)).normalized()
hero = (ctr + view * size * 2.6, ctr)
head = RIG.matrix_world @ arm.bones["head"].tail_local
bust_target = head - Vector((0, 0, 0.12))
bust = (bust_target + view * size * 1.25, bust_target)
shoot(os.path.join(OUT, "full.png"), *hero, 1024)
shoot(os.path.join(OUT, "bust.png"), *bust, 512)
for name, f in (("turn", 9), ("good", 7), ("boost", 5)):
    RIG.animation_data.action = bpy.data.actions[name]
    scene.frame_set(f)
    shoot(os.path.join(OUT, f"anim_{name}.png"), *hero, 384)
if MOUTH:   # closed / open, from the bust camera and from the side
    RIG.animation_data.action = None
    for pb in PB:
        pb.rotation_euler = (0, 0, 0)
    side = (bust_target + Vector((-1.0, -0.25, 0.05)).normalized() * size * 1.0, bust_target)
    for ang, nm in ((0, "closed"), (-20, "open")):
        PB["jaw"].rotation_euler = (math.radians(ang), 0, 0)
        bpy.context.view_layer.update()
        shoot(os.path.join(OUT, f"mouth_{nm}.png"), *bust, 512)
        shoot(os.path.join(OUT, f"mouth_{nm}_side.png"), *side, 512)
    PB["jaw"].rotation_euler = (0, 0, 0)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f"{KEY}.blend"))
print("done")
