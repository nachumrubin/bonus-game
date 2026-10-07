# AVATAR_EVOLUTION.md — Boostie Level System & Art Prompt Template

> Design spec for the evolving "Boostie" avatars (October 2026).
> The art comes from outside the codebase (the Boost art director plus an image
> generator). This file is the brief every character follows, so the whole roster
> levels up the same way. Nothing here is wired into the app yet.
>
> Workflow for a new character (prompts, review checklist, known generator
> failures, saving, doc updates): the `boostie-evolution` skill
> (`.claude/skills/boostie-evolution/SKILL.md`). Final sheets live in
> `assets/avatars/evolution/<name>/`.

---

## 1. The level system: 7 levels

Each character evolves through **7 levels**. Progress runs along four axes. Each axis
leads in a different part of the range, so every upgrade feels different instead of
repeating the same small step:

- **Growth** mostly happens in levels 1–4.
- **Maturity** carries levels 2–5.
- **Personality** and **accessories** take over from level 3 to the end.

| Lv | Name | Growth | Maturity | Personality | Accessories | Signature cyan feature |
|---|---|---|---|---|---|---|
| 1 | Hatchling | baby, tiny | pure cute | — | none | not yet (core only) |
| 2 | Cub | bigger, playful | still cute | first hint (a grin, a marking) | none | appears faintly |
| 3 | Juvenile | body stretches | cute → confident | clear | first simple item | grows |
| 4 | Adolescent | **posture change** | confident | defined | functional item (sash, bracers) | half energy |
| 5 | Adult | full size | mature | strong | first armour / outfit pieces | full energy |
| 6 | Champion | adds mass (mane, cape) | commanding | full identity | full outfit | doubles or spreads |
| 7 | Legend | — | regal | legendary | headpiece / crown, ornate | maximum, with a faint aura |

**In the app:** a level-up plays the evolution scene (`src/ui/boostie3d/evolutionScene.js`):
old form charges, white flash, new form pops in. The card copy is in `evolutionData.js`
(`LEVEL_NAMES` = the names above, `CHANGE_LINES` = each character's headline change per
level); add a `CHANGE_LINES` entry for every new Boostie.

### How levels are earned (D-boostie-xp)

XP counts finished games, never the rating: 10 XP per game, +10 for a win, +5 for a draw.
XP goes to the equipped Boostie. Constants: `src/game/account/boostieXp.js`.

| Level | Total XP | Games (half won) | About 3 games a day |
|---|---|---|---|
| 2 | 50 | ~4 | day 1–2 |
| 3 | 150 | ~10 | ~3–4 days |
| 4 | 350 | ~23 | ~1 week |
| 5 | 700 | ~47 | ~2 weeks |
| 6 | 1,200 | ~80 | ~4 weeks |
| 7 | 2,000 | ~133 | ~6–7 weeks |

**Unlocking.** A new player owns every *starter* Boostie. The target roster is 4–5
starters plus 2–3 locked ones. Today both Zapi and Bubo are starters, so nothing is locked.
A locked Boostie (`unlock: 'chain'`) is free when any Boostie reaches level 7: the first
not-owned one in `CHAIN_ORDER`, at level 1. It can also be bought in the store. Bots get
their own single-level 3D avatars, not player Boosties (§9).

## 2. The chest core: the level indicator

Every Boostie has a **cyan Boost core embedded in the centre of its chest**. It is
the same for the whole roster and is how players read a character's level at a
glance. It always stays **cyan**: the core never changes colour. Colour already
means rarity (blue / purple / gold) and the player sides (cyan / gold), and cyan
is the Boost brand. Only its **shape and intensity** step up:

| Lv | Core shape |
|---|---|
| 1 | a **small spark**: a pinpoint of cyan light |
| 2 | a **glowing dot**: small, soft, round glow |
| 3 | a **round orb**: a clear sphere, brighter |
| 4 | an **orb with one thin ring** circling it |
| 5 | a **star-shaped burst**: sharp rays from a bright centre |
| 6 | a **burst with energy lines** spreading out into the fur / feathers / scales |
| 7 | a **crowned core**: a large radiant burst with a halo ring above it (or circling it) and a faint aura around the body |

Each step must be distinguishable at **64px**. The shape carries the meaning, so
it still works for colour-blind players. Watch levels 5 → 6 and 6 → 7: generators
tend to draw the same burst for both, so the level-6 energy lines and the level-7
halo must be big and obvious, not fine detail. Also watch level 7 against level 4:
an orb with a ring near it reads as level 4, so the level-7 core must be a star
burst, never a round orb. The core is always embedded in the chest: no chain,
strap or clasp may cross or touch it, or it reads as a pendant.

## 3. Rules for every character

1. **One headline change per level, visible in the silhouette, plus one smaller
   detail.** If you can't name the headline change, the level isn't distinct enough.
2. **Changes must read from the chest up.** The scoreboard shows a ~76px bust, so
   boots and leg armour are invisible there. Put changes on the head, ears, shoulders,
   chest core and the tail or wings behind the body.
3. **Exactly two cyan elements:** the chest core (shared) and **one signature cyan
   feature** unique to the character (e.g. fox: tail; owl: wing runes; dragon: wing
   membranes). Armour, cloth, trim and face markings stay in metals, fabric and
   natural colours, never cyan.
   The signature feature stays the same body part at every level and in the same
   place. An energy tail stays tail-shaped, low behind the hips, and must not turn
   into wings. When it becomes full energy, it **replaces** the normal body part
   instead of appearing next to it.
4. **Constants across all 7 levels:** face markings, palette, eye colour and the
   signature feature. A level-7 character must be recognisable as the same one from
   level 1.
5. **Accessories express the personality.** Pick an accessory theme per character
   and stay in it: trickster (hood, half-mask, scarf, knives), scholar (glasses,
   book, robes), brute (heavy spiked armour). Generic knight armour is off-brand
   unless the character is a knight.
6. **Body-type change is a deliberate per-character choice.** A quadruped turning
   bipedal at level 4 is the strongest "grew up" moment, but it changes the
   character's identity. Decide it up front for each character. Don't let the
   generator decide.

---

## 4. Prompt template (paste into the image generator)

Image generators can't draw 7 consistent stages in one image, so each character is
**two sheets**: **A = levels 1–4**, **B = levels 5–7**. When generating sheet B,
**attach sheet A as a reference image**.

### 4a. Fill in per character (the only part that changes)

```
NAME:            <name>
SPECIES:         <animal>
PALETTE:         <main colour> with <accent colours>
PERSONALITY:     <one word: cunning / wise / menacing / ...>
SIGNATURE CYAN:  <the one cyan feature and how it grows>
ACCESSORY THEME: <trickster / scholar / brute / ...> — <3–4 example items>
BODY TYPE:       <stays quadruped | becomes bipedal at level 4 | ...>
CONSTANT MARKS:  <face markings, eye colour, anything that never changes>
```

### 4b. Style block (put this at the start of BOTH sheets)

```
Character evolution sheet for a mobile word game called "Boost". One creature shown
at consecutive evolution levels, side by side from left to right on one horizontal
sheet, full body, front three-quarter view, evenly spaced, each one slightly bigger
than the last. Stylized 3D game-character render, similar to the quality of Brawl
Stars, Pokémon and Hearthstone. Every level has a glowing cyan "Boost core" embedded
in the centre of its chest. The core is always cyan and only its shape and
intensity change per level, exactly as described. The only other cyan element is
the creature's signature feature. Armour, cloth and trim are metal and fabric, never
cyan or glowing. No floating orbs, no orbs held in hands. The face markings,
palette and eye colour stay identical at every level. Soft studio lighting, rim
light, plain light-gray background, no text, no numbers, no labels, no watermark.
```

### 4c. Sheet A: levels 1–4

```
[STYLE BLOCK]

The creature is "<NAME>", a <SPECIES> in <PALETTE>, whose personality grows
<PERSONALITY> as it evolves. Its signature cyan feature is <SIGNATURE CYAN>.
Constant marks: <CONSTANT MARKS>. Four levels:

Level 1 (hatchling): tiny, round, baby proportions, huge innocent eyes, pure cute,
no accessories, no signature feature yet. Chest core: a small cyan spark, a
pinpoint of light.

Level 2 (cub): bigger and playful, still cute, a first hint of personality
(<a grin / a marking>), no accessories. The signature cyan feature appears faintly.
Chest core: a small soft glowing cyan dot.

Level 3 (juvenile): the body stretches out, more confident expression, personality
clear, first simple accessory (<one simple item>). The signature feature grows.
Chest core: a clear, brighter round cyan orb.

Level 4 (adolescent): <posture change per BODY TYPE>, defined personality,
narrower confident eyes, a functional accessory (<e.g. sash / bracers from the
theme>). The signature feature is half energy. Chest core: a cyan orb with one
thin ring circling it.
```

### 4d. Sheet B: levels 5–7 (attach sheet A)

```
[STYLE BLOCK]

The same creature as in the reference image, continuing its evolution. Same face
markings, palette, eye colour and signature feature as the reference. Each level is
noticeably taller than the previous one, and level 5 is taller than the level-4
reference. The signature feature stays the same body part, in the same place, as in
the reference (<e.g. the energy tail grows from the base of the spine, stays low
behind the hips and is never wing-shaped>). Once it is fully energy, it replaces the
ordinary <tail / wings> instead of appearing next to it. Gems, clasps and trim are
gold, bronze or a non-cyan colour and never glow. No chain, strap or clasp crosses
or touches the core: it is embedded in the chest, never a pendant. Three levels:

Level 5 (adult): full adult size and proportions, strong <PERSONALITY> expression,
first <ACCESSORY THEME> outfit pieces (<items>). The signature feature is fully
made of cyan energy. Chest core: a star-shaped cyan burst with sharp rays from a
bright centre.

Level 6 (champion): more presence and mass (<mane / cape / larger wings>), a
commanding pose, the full <ACCESSORY THEME> outfit. The signature feature doubles
or spreads. Chest core: a cyan burst with clearly visible energy lines radiating
outward from it through the chest <fur / feathers / scales> and reaching the
shoulders.

Level 7 (legend): regal and legendary, an ornate <ACCESSORY THEME> headpiece
(<crown / hood circlet / horned helm>), the most refined outfit. The signature
feature at its maximum. Chest core: a radiant star-shaped cyan burst with long
sharp rays, bigger and brighter than level 6 and never a round orb, with a large,
obvious halo ring floating just above it, and a visible soft cyan glow outlining
the whole body. It should look
clearly rarer and more powerful than level 6, and still recognisably the same
character.
```

---

## 5. Worked example: Zapi the fox

```
NAME:            Zapi
SPECIES:         fox
PALETTE:         orange with cream chest, dark-brown ear tips and paws
PERSONALITY:     cunning
SIGNATURE CYAN:  the tail: a cyan tip at level 2, half energy at 4, a full energy tail at 5 that replaces the fur tail, two energy tails at 6–7; always low behind the hips, never wing-shaped
ACCESSORY THEME: trickster: hood, half-mask, scarf, small throwing knives
BODY TYPE:       quadruped at levels 1–3, becomes bipedal at level 4
CONSTANT MARKS:  cream lightning-bolt mark on the forehead (all levels), dark eye rims, amber eyes
```

The bolt is cream, not cyan. A cyan bolt would be a third cyan element and break
rule 3.

### Review of the first spec-driven sheets (October 2026)

**Sheet A (levels 1–4): accepted.** Use it as the reference image for sheet B.

| Lv | Headline change | Core | Tail |
|---|---|---|---|
| 1 | sitting baby kit | spark ✓ | none ✓ |
| 2 | playful, grin | dot ✓ | faint cyan tip ✓ |
| 3 | stretched body, scarf | orb ✓ | grows ✓ |
| 4 | bipedal, sash + pouch, bracers | orb + ring ✓ | half energy ✓ |

**Sheet B (levels 5–7): regenerate.** The accessory ladder is good and should be
kept: vest + scarf + knives → cape with the hood down → hood up with a circlet and
an ornate robe. Problems:

- The energy tails are drawn as large plumes behind the shoulders, so they read as
  wings, and the orange fur tail is still visible next to them.
- The level-5 and level-6 cores are the same star burst; the level-6 energy lines
  are missing. The level-7 halo is too small to read at 64px.
- Levels 5–7 are about the same height, and level 5 is no taller than level 4.
- The level-7 body aura is barely visible.

The sheet B template above now includes these fixes.

**Sheet B, second attempt: accepted, with inpaint fixes.** The heights step up, the
energy tail replaces the fur tail, the L6 lines reach the shoulders, and the L7
halo and body glow show clearly. Each level has a distinct change in the bust view
(vest + scarf → cape collar + energy lines → hood + circlet + halo). To fix by
inpainting, not by regenerating:

- L7: the circlet gem is cyan (third cyan element). Make it gold or crimson.
- L7: the left energy tail rises behind the shoulder and reads as a wing. Lower it
  behind the hip.
- L6 (optional): the two tails merge into one plume. Separate them.
- L6–7 (optional): the shoulder clasps glow cyan where the energy lines end. Make
  them plain bronze.

**Final (October 2026):** all four fixes are applied (crimson circlet gem, low left
tail on L7, two separate tails on L6, bronze clasps). Zapi passes the spec at all
7 levels and is the reference character for the rest of the roster.
Sheets: `assets/avatars/evolution/zapi/zapi_sheet_a_levels_1-4.png` and
`zapi_sheet_b_levels_5-7.png`.

---

## 6. Bubo the owl

```
NAME:            Bubo
SPECIES:         eagle owl
PALETTE:         warm tawny brown with cream speckled breast, dark-brown wing bars, gold beak and talons
PERSONALITY:     wise
SIGNATURE CYAN:  the two ear tufts on top of the head: brown at level 1, faint cyan tips at 2, half cyan energy at 4, full energy tufts at 5 that replace the feather tufts, longer branching tufts at 6–7; always on top of the head above the eyes, never covered by a hat
ACCESSORY THEME: scholar: round gold spectacles (clear lenses), scroll satchel, quill, deep-forest-green scholar's robe with a high collar
BODY TYPE:       stays a bird; at level 4 the round fluffball becomes a tall, upright owl
CONSTANT MARKS:  cream facial disc with a dark-brown rim, white V-shaped brows above the beak (all levels), bright golden-yellow eyes
```

Choices made up front: the tufts are the signature because they sit on the head
and always show in the bust (wing runes would be too fine at 76px, and energy
wings would look like Zapi's tails). No mortarboard, because it would cover the
tufts, so the L7 headpiece is a circlet worn below them. The robe is forest green
to set Bubo apart from Zapi's crimson; navy was avoided because it drifts to cyan.

### Review log (October 2026)

**Sheet A (levels 1–4): accepted as generated.** Fluffball → cyan tuft tips →
spectacles → satchel and quill. Core ladder correct. Known flaws, accepted: the L3
core sits off-centre on the right breast (centre it when cutting out the level),
and L4 is taller but not much sleeker than L3.

**Sheet B (levels 5–7): accepted after one inpaint round.** The Zapi-derived
template worked first time: tufts stayed on the head, circlet below them, amber gem
and gold clasps not glowing, wings brown. Two new problems, both fixed by inpainting
and now written into §2 and §4d:

- A gold chain between the shoulder clasps ran through the core on L5–7, so it
  read as a pendant. Removed the chain.
- The L7 core came out as a round orb with a small ring, which looks like L4 at
  64px. Inpainted into a large radiant star burst.

Accepted deviations: the L7 ring circles the burst instead of floating above it
(§2 now allows both), and L7 is about the same height as L6.

Sheets: `assets/avatars/evolution/bubo/bubo_sheet_a_levels_1-4.png` and
`bubo_sheet_b_levels_5-7.png`.

---

## 7. 3D reference sheets (one per level, for Meshy)

TRELLIS builds the 3D model from pictures. Anything it can't see, it invents, and
that's where the flaws come from. Zapi L3, made from the evolution sheet alone, came
out with three ears and a smeared far eye, because its head was turned away from the
body. So each level gets its own **3D reference sheet** showing the character from
several angles. The sheet is made after the evolution sheets are final. Attach the
evolution sheet as the reference.

Rules for the sheet:
- **Four views in one row**, evenly spaced, each in its own equal-width column at the
  same scale: front, front three-quarter, side (facing left), back. `meshy_generate.py
  --split 4` cuts it into equal columns, so the views must not overlap.
- **The same neutral pose in every view**, with the head facing the same way as the
  body. Both eyes are visible and the same size in the front view. Ears upright and
  clearly separate. The tail (or wings) is raised to the side so it doesn't cover the
  body.
- **Bipedal levels: arms relaxed and held a little away from the body, hands open**
  (add it to the pose line). Arms against the sides, or a hand on the hip as in the
  concept, merge into the body in 3D and can't be rigged. Used for Zapi L4.
- **No glow haze, particles, motion blur or strong shadows.** TRELLIS turns haze into
  lumps. The cyan parts are drawn as solid bright cyan; the 3D build adds the glow.
- Soft, even studio lighting on a plain light-grey background.

```
<NAME> the <ANIMAL>, level <N>, exactly as level <N> in the attached evolution
sheet: same colours, markings, outfit, chest core and signature feature.
A character turnaround sheet for 3D modelling: four views of the same character in
one row, evenly spaced, each in its own equal-width column at the same scale, not
overlapping: front view, front three-quarter view, side view facing left, back view.
The same neutral standing pose in every view, the head facing the same way as the
body. Front view: both eyes fully visible and the same size, both <ears / ear tufts>
upright and clearly separate. The <tail / wings> held up and to the side so it doesn't
cover the body or legs.
The cyan parts are solid, bright cyan with no glow haze. No particles, no motion blur,
no strong shadows. Soft even studio lighting, plain light-grey background. Same 3D
render style as the reference.
```

Check before generating: four views, the same character in all of them, nothing
cropped, the views not touching. If the generator can't keep the character
consistent across four views, ask for **front and side only** (`--split 2`) or a
single **front three-quarter view with the face toward the viewer** (worked for Zapi
L3: `Blender designs/boosties/sources/zapi_l3_ref_a.png`).

## 8. 3D upgrades every level gets

`Blender designs/boosties/build_boostie.py` applies these to every generated mesh (Meshy
meshes are normalised first with `normalize_glb.py` and skip the smooth rebuild). The
level's `LEVELS` entry has to provide the measurements.

| Upgrade | Why | Needs in `LEVELS` |
|---|---|---|
| **Smooth body**: thicken thin parts, voxel-fuse, relax, reduce to ~19k faces, copy the painting across | TRELLIS builds bodies from flat planes with sharp edges | nothing (tune with `smooth`) |
| **Real eyes that act**: eyeballs and lids on their own bones; blinks, glances and mood lids in the app; optional lower lid and almond/slanted shape | Painted eyes never blink, so the character reads as dead; a round ball with no lower lid reads as a googly eye | `eyes`: pupil x/z and radius; `show` for Meshy meshes; `shape` (width, open, low, tilt) for the character's eye shape |
| **A mouth that opens**: muzzle sliced along the lip line, lower jaw on a `jaw` bone, a dark inner skin across the gap; used by good, boost, laugh, wow and an idle "heh" | A face that only blinks still reads as a mask; the mouth gives laugh/wow reactions | `mouth`: midline x, lip line at the tip and corners, half width, hinge |
| **Signature movement**: one short clip of the character's own, played every 10–20 s, also on the board | Each Boostie should move in a way that's recognisably theirs | an entry in `SIGNATURES` per character |
| **Glow**: tail/core repainted bright cyan, emission map, glow sprites | TRELLIS paints the cyan dull | `core` position |
| **Rig**: weights in units of bone thickness, so the head owns the whole face | Otherwise the eyes slide over the face | `bones` |

Signature movements (one per character, small, under 1 s):

| Character | Signature |
|---|---|
| Zapi | Double ear twitch, left ear leading, the tail tip answering |
| Bubo | The owl head swivel: a quick turn and a curious sideways tilt, tufts perking |

Shared clips (every Boostie, `CLIPS` in `build_boostie.py`): idle, turn, good, boost,
laugh, wow, stare, yawn and **wink**. Wink is the only clip that keys the lids
(`LID_CLIPS`): `lid.L` shuts (−82°), holds and opens over 22 frames while `lid.R`
squints, the head tilts and the jaw grins. In every other clip the app drives the lids
live, so the Phase 3 player must let the wink's lid tracks through while it plays.
`add_wink.py` patched the 14 models built before the clip existed.

---

## 9. Bot avatars (Easy, Medium, Hard)

The three bot opponents get their own 3D models: single level, no evolution, no chest-core
ladder. They keep the current portraits' head (`assets/avatars/{green,yellow,red} bot.png`):
a round glossy white helmet, a dark glass screen as the face, coloured ear pads and an
antenna with a cyan ball. The full body and its armour grow with the difficulty.

| Bot | Colour | Screen face | Height | Body |
|---|---|---|---|---|
| Easy | lime green | happy arc eyes, wide smile | ≈ head height (chibi) | round egg torso, waist band, stubby legs |
| Medium | amber yellow | focused flat-top eyes, small smile | ≈ 1.5 × head | sturdier, shoulder pads, chunky boots |
| Hard | crimson red | angry slanted eyes, frown | ≈ 2 × head | chest armour, big shoulder armour, forearm guards, heavy boots |

Rules: only the antenna ball is cyan; the screen face and chest light are drawn as solid
flat glowing shapes in the bot's colour. Arms held away from the body (rigging). Still cute
at every difficulty, never scary.

Prompts: `docs-md/image-prompts/13–15_bot_*_turnaround.md` (Easy first; Medium and Hard
attach the earlier bots so the three read as one family). Then the Part 2 pipeline:
Meshy → `normalize_glb.py` → `build_boostie.py` (`bot_easy` / `bot_medium` / `bot_hard`,
already accepted by `scripts/optimize-boosties.mjs`).

**Built (October 2026).** All three were accepted on the first ChatGPT pass and built with
Meshy (four-view split), then `build_boostie.py` keys `bot_easy` / `bot_medium` / `bot_hard`:
- Bones: root, hips, chest, neck, head, `antenna` (glows through `glow_bones`), the arms as
  `wing.L` / `wing.R` (so the shared good / boost / laugh / wow clips swing them, as they
  do Bubo's wings) and `leg.L` / `leg.R`. The ear pads are rigid on the head.
- Signature (`SIGNATURES["bot"]`): an antenna wobble, a springy flick with a small head bob.
- Screen face (`screen` entry, no `eyes` / `mouth`): the build finds the dark screen from the
  front, covers the painted face with a satin glass layer and adds eight glowing face layers
  (rest, blink, happy, laugh, wow, stare, yawn, wink) on `face.<expr>` bones. The clips
  switch faces by keying those bones' scale (`SCREEN_CLIPS`): idle and turn blink, good is
  happy, boost and wow are wow, and laugh / stare / yawn / wink show their own face. Each
  bot keeps its personality at rest: Easy happy arcs and a grin, Medium flat-topped focused
  eyes and a small smile, Hard angry brows and a frown (its laugh squints > <).
- App files: `assets/boosties/bot_<x>.glb` (~0.65 MB, `optimize-boosties`) and
  `assets/avatars/bots/bot_<x>_{bust,full}.webp` (`render_stills.py` + `stills_to_webp.py`).
  `avatarScreens.js` shows the stills (`botStillSrc`), and `botModelSrc` gives the model.

Possible later: the chest light glowing in the bot's colour.

**In the app (Phase 3, Oct 2026):** `src/ui/boostie3d/` plays the models live on the
scoreboard. It drives blinks, gaze and lids itself (the idle clip is held paused), plays
turn / good / boost from the game directives, and snaps bot screen faces to one face at a
time (the exported scale keys are LINEAR, so blends would sink a face behind the glass).
The wink clip's lid tracks pass through the live lid controller.

