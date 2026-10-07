---
name: boostie-evolution
description: >
  Design a new evolving "Boostie" avatar (7 levels) for the Boost word game and
  turn each level into a live 3D model. Use when the user wants to "create a new
  Boostie / evolving avatar / character", "make evolution sheets for <animal>",
  pastes generated character-evolution sheets for review, asks for inpaint fixes,
  or wants a Boostie level "in 3D", "modelled", "from TRELLIS", rigged, animated or
  made livelier. Part 1 covers the 2D sheets (character block, prompts, review,
  failure modes, saving). Part 2 covers 3D: multi-angle reference sheets, TRELLIS
  generation, and the mandatory upgrades every model gets (smooth body, real eyes
  that act, a mouth that opens, a signature movement, glow, rig).
---

# Boostie Evolution

Each Boostie is one creature drawn at **7 evolution levels**. The image generator
does the art. This skill covers the process around it: filling in the character,
writing the prompts, reviewing each sheet against the spec, fixing problems, and
recording the result.

**Source of truth:** `docs-md/AVATAR_EVOLUTION.md`. It holds the level table (§1),
the chest-core ladder (§2), the rules for every character (§3) and the prompt
templates (§4). Read it at the start of every run and use the prompt text from
there. Don't copy the templates into this skill: the doc is what changes.

**Reference character:** Zapi the fox (§5 of the doc, sheets in
`assets/avatars/evolution/zapi/`). Zapi went through every step below, including
one rejected sheet and one round of inpaint fixes. Use it as the example of a
finished character.

---

# Part 1: the 2D evolution sheets

## The loop

```
1. Character block  →  2. Sheet A prompt  →  3. Review A  ─┐
                                                ▲  fix      │ accepted
                                                └───────────┤
                       4. Sheet B prompt (attach A)  →  5. Review B  ─┐
                                                ▲  fix                  │ accepted
                                                └───────────────────────┤
                                       6. Save sheets  →  7. Update docs
```

The user runs the image generator (ChatGPT) and pastes the results back. Expect two
or three rounds per sheet.

### Getting the images: the prompt folder

Every image the workflow needs gets its own file in `docs-md/image-prompts/`, listed in
priority order in that folder's `README.md`. Each file says what to attach, gives the
prompt in one copyable box, has a short check-before-sending list, and says where the
result will be saved. When the workflow needs a new image (a sheet, a turnaround, an
inpaint fix), add a file there instead of only writing the prompt in chat. When the user
pastes an image back, review it, save it to the path in the file, and tick its row in
the README.

Emailing ChatGPT (`Blender designs/boosties/image_mail.py`) was tried in October 2026
and dropped: ChatGPT's mail trigger couldn't do the job. Don't use it.

---

## Step 1: fill in the character block

Use the block in §4a of the doc. Ask the user for anything they haven't decided.
These need a decision **before** anything is generated, so don't leave them for
the generator:

- **Body type.** Stays quadruped, or becomes bipedal at level 4 (§3 rule 6). It's
  the biggest identity choice, so ask about it explicitly.
- **Signature cyan feature** and how it grows over levels 2–7. It must be a body
  part that stays visible behind or above the bust (tail, wings, horns, crest),
  because the scoreboard shows only a ~76px bust. Check that it's different from
  the existing roster's features (Zapi: tail).
- **Accessory theme**, with 3–4 concrete items, matching the personality
  (§3 rule 5).

Check the block before writing any prompt:

- [ ] **Constant marks are not cyan.** Only the chest core and the signature
      feature may be cyan. Zapi's spec first said "cyan lightning bolt", which
      would have been a third cyan element. Use cream, white, gold or a darker
      shade of the palette instead.
- [ ] **Constant marks appear from level 1.** Don't write "from level 2" for a
      face marking: rule 4 says they never change.
- [ ] **The signature feature has a fixed place.** Write where it sits (e.g. "from
      the base of the spine, low behind the hips"). If it turns into energy,
      say that it **replaces** the normal body part.

## Step 2: sheet A prompt (levels 1–4)

Put together the style block (§4b) and the sheet A template (§4c), with the
character block filled in. Give it to the user as one copyable code block.

If the user's generator accepts reference images, the user can attach the Zapi
sheets **for rendering style only**. Then add this line: "Match the rendering style
and quality of the reference image only; the creature is a different character."

## Step 3 and 5: review a sheet

Look at the pasted image and fill in this table, one column per level:

| Check | Lv … |
|---|---|
| Headline change visible from the chest up | |
| Core shape matches §2 for this level | |
| Signature feature at the right stage, in the right place | |
| Exactly two cyan elements (core + signature) | |
| Taller than the previous level | |
| Constant marks, eye colour and palette unchanged | |

Then check the whole sheet:

- **64px test.** Could the core shapes of neighbouring levels be told apart if
  shrunk to 64px? Look at L5 → L6 and L6 → L7 in particular.
- **Bust test.** Imagine only the head, shoulders and upper chest. Does each level
  still look different?
- **Theme.** Do the accessories stay inside the chosen theme? Generic knight armour
  is off-brand unless the character is a knight.

Give a verdict: **accept**, **accept with inpaint fixes**, or **regenerate**.

- **Inpaint** when the problems are local: a wrong-coloured gem, a misplaced tail,
  a glowing clasp, one wrong item.
- **Regenerate** when the problems are structural: the core ladder is wrong on
  several levels, the signature feature is the wrong shape everywhere, there's no
  height progression, or the silhouettes don't change.

When regenerating, put the fix into the **sheet template in the doc**, not only
into a one-off prompt, so the next character benefits from it. Zapi's first
sheet B produced all the generic rules now in §3 and §4d.

### Known generator failure modes (from Zapi and Bubo)

| Failure | Where | Fix |
|---|---|---|
| Same star burst on L5 and L6 | core | §4d asks for lines "reaching the shoulders" — check they're actually there |
| L7 halo tiny or missing | core | "large, obvious halo ring" |
| Energy tail drawn as wings behind the shoulders | signature | Fix its position: "low behind the hips, never wing-shaped" |
| Normal tail still visible next to the energy tail | signature | "replaces the ordinary tail" |
| L5–7 all the same height, or L5 no taller than L4 | sheet B | "each level noticeably taller; level 5 taller than the reference" |
| Cyan creeps into gems, clasps, trim | L6–7 outfit | Inpaint to gold, crimson or bronze |
| Energy lines end in glowing cyan shoulder discs | L6–7 | Inpaint the clasps to plain bronze |
| L7 body aura barely visible | L7 | "visible soft cyan glow outlining the whole body" |
| Two tails merge into one plume | L6 | Inpaint: "two separate … fanning apart" |
| L1 core drawn as an orb (looks like L3) | turnaround | Edit: "tiny pinpoint spark, no bigger than the eye's pupil" (Bubo `06b`) |
| A chain between the clasps runs through the core, so it reads as a pendant | L5–7 | Inpaint: remove the chain, or hang it well below the core |
| L7 core drawn as a round orb with a ring, which looks like L4 at 64px | L7 core | Inpaint: "a radiant star-shaped burst with long sharp rays, bigger than level 6" |
| Core off-centre (on one breast) | any | Inpaint: "in the centre of the breast"; minor, can also be fixed when cutting the level out |
| A hat or headpiece covers a head-mounted signature | L5–7 | Choose a headpiece that sits below it (Bubo: a brow circlet under the tufts) |

Colour choices: give the outfit a main colour that's different from the rest of
the roster (Zapi crimson, Bubo forest green), and avoid navy and teal, which drift
towards cyan.

Some things look like mistakes but are correct: face markings already present at
L1 (rule 4), and a constant mark drawn in a non-cyan colour when the old spec said
cyan.

## Step 4: sheet B prompt (levels 5–7)

Put together the style block and the sheet B template (§4d). Fill in the
signature-position line with this character's details. Tell the user to
**attach the accepted sheet A** as the reference image.

## Inpaint prompts

Write one short, positive prompt for each fix, saying what should be there. For
example:

- "the gem in the hood circlet is a deep crimson ruby set in gold, not glowing"
- "the cyan energy tail flows from the base of the spine, low behind the hip"
- "plain bronze round shoulder clasps, not glowing"

Then review the edited sheet again with the same table.

## Step 6: save the sheets

Images pasted into the chat are saved under the session's temp `images/`
directory (the path is in the image's `source:` line). Copy the **accepted** files
into the repo:

```
assets/avatars/evolution/<name>/<name>_sheet_a_levels_1-4.png
assets/avatars/evolution/<name>/<name>_sheet_b_levels_5-7.png
```

Use the lowercase character name. After copying, open the saved file with Read to
check it's the final version and not an earlier attempt. Only save rejected
attempts if the user asks.

## Step 7: update the docs

- `docs-md/AVATAR_EVOLUTION.md`: add a section for the character, like Zapi's §5:
  the filled character block, then a short review log (what was accepted, what
  was fixed and how). Put any new generic rule into §3 or §4.
- `docs/asset_inventory.md`: list the sheets under "Boostie evolution sheets".
- `src/ui/boostie3d/evolutionData.js`: add the character's `CHANGE_LINES` (one short
  Hebrew line per level 2–7, the headline change from the review table). The level-up card
  shows it; a unit test fails until it's there.
- `docs-md/TASKS.md`: tick off the character in the "Boostie avatar evolution"
  section and add any follow-ups.
- `docs-md/CHANGELOG.md`: a short entry.

Only docs and images change, so unit tests aren't needed unless code also
changed.

---

# Part 2: from sheet to live 3D model

Boosties are live 3D in the app (three.js `.glb`, decision D-boostie-live-3d). Each
level is generated with Meshy (TRELLIS is the free fallback), then upgraded by one
build script. Do these steps
per level, in order. The spec for the reference sheet and the upgrade table is
`AVATAR_EVOLUTION.md` §7–§8.

```
8. 3D reference sheet (multi-angle)  →  9. Generate (Meshy)    →  10. Inspect raw mesh ─┐
                                                   ▲  regenerate / new sheet             │ ok
                                                   └─────────────────────────────────────┤
          11. Measure + LEVELS entry  →  12. Build (all upgrades)  →  13. Review  →  14. Docs
```

## Step 8: a multi-angle 3D reference sheet for the level

Never generate a 3D model straight from the evolution sheet. A single view makes
TRELLIS invent the hidden side. Zapi L3 got three ears and a smeared far eye that way.
Give the user the §7 prompt, filled in for this level, with the accepted evolution
sheet attached as the reference. Check what comes back:

- [ ] Four views in one row, each in its own equal-width column, not touching:
      front, front three-quarter, side, back.
- [ ] The same character and pose in every view, with the head facing the same way
      as the body.
- [ ] Front view: both eyes visible and the same size; ears or tufts clearly separate.
- [ ] Tail or wings away from the body. No glow haze, particles or motion blur.

If the generator can't keep four views consistent, fall back to front + side, or
to one front three-quarter view with the face toward the viewer. Save it as
`Blender designs/boosties/sources/<name>_l<N>_ref.png`.

## Step 9: generate with Meshy (TRELLIS as a fallback)

Meshy won the October 2026 test (D-boostie-meshy): from the same single front image it
kept the concept's face (marks, brows, eye shape), gave a crisp texture, and invented a
believable back. TRELLIS's result was blurry, with a lumpy tail.

```
cd "Blender designs/boosties"
python meshy_generate.py sources/<name>_l<N>_meshy.glb sources/<name>_l<N>_ref.png --split 4
```

- Feed it the step 8 multi-angle sheet (`--split 4`, front first; the cuts snap to the
  empty gaps between views, so a tail reaching past its quarter is kept whole). Tested on Zapi L3
  (same sheet, 30 credits each, `sources/meshy/compare_l3_trellis_front_4view.png`):
  four views beat the front view alone. The model faces the camera squarely, which
  is what the scoreboard needs; the front-only model kept the image's three-quarter
  turn. The proportions and tail size match the concept, and the face is closest to it.
- If the run is interrupted, resume it with `--task <id>` (add `--multi` for a
  multi-image task). It doesn't use new credits.
- It needs a Meshy Pro key in the `MESHY_API_KEY` environment variable (set by the
  user with `setx`). Never ask for the key in chat or write it into a file.
- About 30 credits a run (Pro: 1000 a month). The free plan can't download Meshy 6/7
  models, so there is no free path.
- The output is about 30k triangles, already remeshed. It also saves
  `_basecolor.png` and `_preview.png`.

**Fallback, TRELLIS** (free, but lower quality):

```
cd "Blender designs/boosties"
python trellis_generate.py sources/<name>_l<N>_trellis.glb sources/<name>_l<N>_ref.png --split 4
```

- `--split N` cuts the sheet into N views and runs TRELLIS in multi-image mode.
  Separate view files can be passed instead, front first.
- It needs `pip install gradio_client` and the user's Hugging Face login
  (`hf auth login`). Check with `hf auth whoami`, and never ask for the token in chat.
- The free quota is a few GPU minutes a day, about 1–2 runs. A quota error says when
  it resets. Don't retry in a loop: tell the user, and suggest PRO for batches.

## Step 10: inspect the raw mesh before building

**Meshy meshes first get normalised.** They come out about twice the TRELLIS size, and
`measure.py` and the build assume a longest side of 1.0:

```
blender -b --factory-startup --python normalize_glb.py -- sources/meshy/<name>_l<N>_4view.glb sources/<name>_l<N>_meshy.glb
```

Measure and build from the normalised file. In its LEVELS entry set
`"smooth": {"enabled": False}` and `"show": 0.22` in `eyes` (Meshy sculpts brow tufts in
front of the eyes; `show` fits the eyeballs into the face instead of trusting one ray).
Meshy surfaces are already smooth, and the rebuild would
throw away Meshy's UVs and texture. Zapi L3 (`zapi_l3`) is the worked example.

**Two tails (Zapi L6–7).** With all four views Meshy merged L6's two energy tails into
one plume. Passing only the front, side and back views (no 3/4 view, where the tails
overlap) gave two tails, plus an extra fur tail between them. Remove extra parts like that
with a `cut` box in the LEVELS entry (check the cut with `measure.py`), and rig the second
tail as `tailb.0–4`: the clips drive it as a mirror of `tail.*`. `zapi_l6` is the example.

**Owls (Bubo).** Rig `wing.L`/`wing.R` from the shoulder down the folded wing (thin
`radii` so the flank stays put); the clips swing them outward. The tufts are `ear.L/R`, and
`glow_bones` says which bones may glow (`[]` while the tufts are plain feathers). The eyes
sit in a deep face disc, so the default sink leaves the painted iris poking out under the
ball: use `eyes.sink` 0.35, `show` 0.5, `reach` 1.5 and `socket` set to the disc colour.
`bubo_l1` is the example.


`python measure.py sources/<name>_l<N>_meshy.glb --spin` renders 4 views. Look for:
extra or missing ears, limbs or tails; a smeared or missing eye; parts merged
together; glow haze turned into lumps. On any of these, regenerate (another
`--seed`), or improve the reference sheet. The build can't fix wrong anatomy.

## Step 11: measure and add the LEVELS entry

1. `python measure.py <glb>` gives front, side and top views with a 0.1 grid. Read off:
   the body midline (`center`), the joints for the bone list (copy the layout of an
   existing level with the same body type; bone names must stay the same, since the
   clips depend on them), and the chest core (`core`).
2. `python measure.py <glb> --head X Z` gives a front close-up with a 0.02 grid. Read
   the two pupil centres and the eye radius into `eyes`. **Every level needs `eyes`**:
   the build prints a WARNING without it, and the character keeps dead painted eyes.
3. `python measure.py <glb> --side Y Z` gives a side close-up with a 0.02 grid. With
   the front close-up, read the mouth into `mouth`: midline x, the (y, z) of the
   lip line just under the nose tip and at the mouth corners, the half width of the
   muzzle, and a jaw hinge back under the eyes. For a beak, the line is where the
   lower half of the beak meets the upper. **Every level needs `mouth`**: the build
   prints a WARNING without it, and the laugh/wow reactions lose their best part.
4. If the head was sculpted turned (the sheet pose), set `head_yaw` so both
   scoreboard copies show the face.
5. New character? Add its **signature movement** to `SIGNATURES` in
   `build_boostie.py`: one short clip, under 1 s, small, recognisable, using bones
   every level of that character has (Zapi: double ear twitch). Record it in the §8
   table.

## Step 12: build (all upgrades are mandatory)

```
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup \
  --python "Blender designs/boosties/build_boostie.py" -- <name>_l<N>
```

Every model gets all of these. Don't skip one to save time:

1. **Smooth body.** Thicken thin parts, voxel-fuse, relax, reduce to ~19k faces, then
   copy the painting across texel by texel. Tune with `smooth` only if the face goes
   too soft or thin parts break up.
2. **Glow.** Teal/cyan texels on the tail and core are repainted bright cyan, with an
   emission map and glow-sprite anchors.
3. **Rig.** Weights are measured in units of each bone's thickness, so the head owns
   the whole face and the eyes can't slide.
4. **Real eyes that act.** Eyeballs and lids on their own bones. The app makes them
   blink (sometimes twice), glance (and look at the other player when they react),
   and set the lids by mood: smug, alert, squint, wide.
5. **A mouth that opens.** The muzzle is sliced along the `mouth` plane, so the lips
   get one clean edge. The lower lip and chin hang on a `jaw` bone, and behind the
   cut sits a dark inner skin that stretches across the gap. Opening = negative X
   rotation of `jaw`. The good, boost, laugh and wow clips use it, and the app adds
   a small two-beat "heh" every 12–24 s.
6. **Clips.** idle, turn, good, boost, laugh, wow, stare, yawn, wink (shared, with
   anticipation and overshoot) plus the character's `signature`, which the app plays every
   10–20 s, also on the board. Wink also keys the lids (`LID_CLIPS`); models built before it
   were patched with `add_wink.py`.

Treat any `WARNING` line in the output as a failed step.

**Screen-face characters (the bots).** A painted screen face replaces upgrades 4 and 5: give
the entry a `screen` (`box` to search for the dark screen, `style` happy/focused/angry,
`color`, optional `emit` and `lift`) and no `eyes` / `mouth` (their two WARNINGs are
expected). The build covers the screen with a satin glass layer and adds one glowing layer
per expression on `face.<expr>` bones; `SCREEN_CLIPS` shows one at a time by keying the
bones' scale, so blinks and reaction faces play from the baked clips. Review with
`screen_check.py` (renders `out/<key>/face_<expr>.png`). Arms are named `wing.*` so the
shared clips swing them; the antenna is a `glow_bones` bone.

## Step 13: review

- Read `out/<name>_l<N>/mouth_*.png`: closed, the seam is invisible; open, it
  shows the dark inner mouth, not orange fur or a hole into the body.
- Read `out/<name>_l<N>/full.png`, `bust.png` and `anim_*.png`. Compare with the
  sheet: colours, markings, the core shape for this level (§2), and the signature
  feature.
- Copy the `.glb` to `tools/3d-spike/models/`, add it to `MODELS` in the test page
  (with `signature`, `laugh` and `wow` in `clips`), and check it there. Lively look: the eyes stay seated
  while the head turns, blinks close fully, ears and tail follow through, the
  signature plays.
- Republish the test page so the user can check on a phone. The page converts the
  glb to base64 text, because artifacts can't serve `.glb`.

Known 3D failure modes:

| Failure | Cause | Fix |
|---|---|---|
| Extra ear, smeared far eye | single view with the head turned | multi-angle sheet (step 8) |
| Body looks like sharp geometric pieces | raw TRELLIS planes | the smooth rebuild (on by default) |
| Eyes slide over the face when the head turns | face weighted to neck/ears | the bone-thickness weights (`RADIUS`, `radii`) |
| Model renders white in the artifact | texture fetch blocked by the sandbox | the page hides `createImageBitmap` during parse (already in place) |
| Energy tail dark or black-edged | TRELLIS paints cyan dull | the glow repaint (on by default; tune `glow` thresholds) |
| One scoreboard copy shows the back of the head | head sculpted turned | `head_yaw` |

## Step 14: docs

`docs/asset_inventory.md` (which levels have models), `docs-md/TASKS.md`,
`docs-md/CHANGELOG.md`, and the §8 signature table. The `.glb` files and the
`sources/` folder stay out of git until the user decides otherwise (see TASKS).

---

## Not in scope yet

How levels are earned, where the level is stored, and loading the `.glb` in the real
app screens are code tasks. Check `docs-md/TASKS.md` and use the
`boost-development-workflow` skill.
