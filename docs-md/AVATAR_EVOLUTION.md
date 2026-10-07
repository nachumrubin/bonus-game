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
   Getting bigger is not a change: levels 5–7 must differ even at the same size. Level 6
   **doubles the signature feature into something countable** (four horns, four wings,
   twice the frills) and level 7 **transforms its shape** (a crown of horns, a fan crest).
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
ordinary <tail / wings> completely: no trace of the old part remains next to or under
it. The energy version keeps the exact shape of the real body part (<e.g. solid spiral
ram horns>): solid, with a crisp hard outline, like polished glowing cyan crystal, never
flames, smoke, mist or hair. <If bipedal from level 4: All three levels stand upright on
two legs like level 4 in the reference, never on four legs, never hunched.> Anatomy at
every level: exactly two legs and two arms, each arm ending in one hand; no extra legs, no
extra arms, never a four-legged body with arms on top. Both hands are empty: every prop is
strapped to the back or tucked into the belt, with straight, unbroken handles. Keep the
friendly, stylized face and proportions of the reference. The three levels must look
clearly different even at the same size: the change is in the shape, not only the scale.
The outfit is a few large
readable pieces, not busy armour: no bells or dangling ornaments. Gems, clasps and trim are
gold, bronze or a non-cyan colour and never glow. No chain, strap or clasp crosses
or touches the core: it is embedded in the chest, never a pendant. Three levels:

Level 5 (adult): full adult size and proportions, strong <PERSONALITY> expression,
a light outfit with only a few <ACCESSORY THEME> pieces (<items>). The signature feature
is fully made of cyan energy. A relaxed standing pose. Chest core: a star-shaped cyan burst with sharp rays from a
bright centre, no lines or crackles around it yet.

Level 6 (champion): the headline change is the signature feature doubling into
something you can count (<a second pair of horns / wings, twice the frills>). More
presence and mass (<mane / pauldrons>), a wide power stance with fists clenched. Chest core: a cyan burst with clearly visible energy lines radiating
outward from it through the chest <fur / feathers / scales> and reaching the
shoulders.

Level 7 (legend): the headline change is the signature feature transforming its shape
(<a crown of horns / a fan crest / wings rising above the head>). Regal and legendary,
an ornate <ACCESSORY THEME> headpiece (<crown / hood circlet / horned helm>), a heroic
pose with the chest out and the chin up, different from level 6. Chest core: a radiant star-shaped cyan burst with long
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
| Rocco | The head-butt: rears back, butts down sharply, a small rebound; ears flick back, tail tip wags |

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


---

## 10. Next three Boosties: Rocco, Lumi, Drako (planned October 2026)

Picked to cover what Zapi (cunning) and Bubo (wise) don't: a brave one, a cute one and
a proud one, each with a different palette and a signature feature in a different
place on the bust (horns on top, frills at the sides, wings behind). Sheet prompts:
`docs-md/image-prompts/16–21_*_sheet_{a,b}.md`.

### Rocco the ram

```
NAME:            Rocco
SPECIES:         mountain ram
PALETTE:         slate-grey curly wool, cream face and muzzle, charcoal hooves, warm brown leather
PERSONALITY:     brave
SIGNATURE CYAN:  the two curled horns: brown nubs at 1, cyan tips at 2, half-turn curl with cyan streaks at 3, half energy at 4, crystal horns growing from short brown roots at 5, a second smaller pair at 6 (four horns), all four huge at 7, forming a crown of horns; always from the top of the head curling back and down beside the ears, never covered by a helmet
ACCESSORY THEME: Viking blacksmith: leather bracers, tool belt with a small hammer, fur shoulder mantle, iron pauldrons, rune hammer
BODY TYPE:       quadruped at levels 1–3, becomes bipedal at level 4
CONSTANT MARKS:  cream blaze from forehead to muzzle, curly grey wool fringe between the horns, dark-grey nose, steel-blue eyes (round pupils; changed from amber in Oct 2026 so he doesn't share Zapi's eye colour)
```

Choices: the L7 headpiece is a rune circlet below the horns, not a horned helm, so the
horns stay visible. No blacksmith apron: it would cover the core. Round pupils, not a
real goat's horizontal ones, which read as creepy at bust size. Signature movement: a
head-butt nod with a snort.

### Lumi the axolotl

```
NAME:            Lumi
SPECIES:         axolotl
PALETTE:         soft peach-pink skin, cream belly, rosy cheeks, gold and magenta accents
PERSONALITY:     cheerful
SIGNATURE CYAN:  the six gill frills (three each side): pink stubs at 1, cyan tips at 2, longer with cyan edges at 3, half energy at 4, full crystal frills at 5 that replace the pink frills, doubled to six long streamers a side at 6, one big fan crest behind the head at 7; always beside the head behind the cheeks, never covered by headphones or a hat
ACCESSORY THEME: party DJ: pink star headband (on the forehead), headphones around the neck, open gold sequin jacket, sequin cape, DJ crown
BODY TYPE:       round and chubby on four little legs at 1–3, stands upright on the hind legs from level 4 (stays chubby, keeps the tail)
CONSTANT MARKS:  big glossy dark-brown eyes with white highlights, darker pink spots on back and legs, wide happy smile, two rosy cheek spots, cream belly, long pink tail
```

Choices: the stars (asked for as sunglasses, drawn as a star headband) always sit on the forehead, because the 3D build adds
real eyes and anything over them would break blinks and gaze. Headphones sit around the
neck so they never cover the frills. The jacket is open at the front so the core shows.
Signature movement: a happy wiggle with the frills rippling.

### Drako the dragon

```
NAME:            Drako
SPECIES:         dragon
PALETTE:         deep royal-purple scales, gold belly plates, cream horns and claws, crimson and gold accents
PERSONALITY:     proud
SIGNATURE CYAN:  the wing membranes: purple nubs at 1, small wings with faint cyan membranes at 2, bigger at 3, half energy at 4, solid cyan crystal membranes at 5, a second smaller pair at 6 (four wings), all four spread with the tips above the head at 7; the wing bones always stay purple, the wings grow from the shoulder blades and are never a cape
ACCESSORY THEME: royal: crimson waist sash, gold arm bands, gold pauldrons, short scepter, crown
BODY TYPE:       quadruped at levels 1–3, becomes bipedal at level 4
CONSTANT MARKS:  two short cream horns curving back, a row of cream back spikes, gold belly plates, bright gold eyes (round pupils)
```

Choices: no royal cape, because it would hide the wings. The sash is tied at the waist,
never across the chest, so it never crosses the core. Wings need extra bones in the 3D
rig (like Bubo's), so Drako is the most rigging work of the three. Candidate for the
coin-price store Boostie. Signature movement: a wing flare with a proud chest puff.

### Review log: sheet A (October 2026)

All three sheet A's were **accepted as generated** on the first pass: core ladder, one
cyan feature each, height progression and the level-4 stand-up all correct. The spec
was updated to match the sheets (sheet B keeps what was drawn):

- Rocco's horns came out brown, not grey. The block and sheet B now say brown.
- Lumi's eyes are dark brown, not black, and the star sunglasses are a star headband
  (still off the eyes, which is what matters for the 3D eyes). She also has darker pink
  spots, now a constant mark.
- Off-centre cores: Drako L4, Lumi L3 and L4. Centre them in the turnaround prompts.

Sheets: `assets/avatars/evolution/{rocco,lumi,drako}/<name>_sheet_a_levels_1-4.png`.

### Review log: Rocco sheet B, first two attempts (October 2026)

Both **rejected**, and the fixes are now in the §4d template:

- **Broken anatomy** (missed in the first review, caught by the user): level 5 drawn as a
  centaur, with four legs plus two arms; a third leg behind the hammer on level 7. Fix:
  "exactly two legs and two arms … never a four-legged body with arms on top".
- **Held props drawn wrong**: the hammer handle a stub vanishing into the head, gripped
  at odd angles (L6, L7). Fix: hands stay empty, props are strapped to the back or belt.
  This also helps the 3D build, where a prop fused to a hand can't be rigged. Drako's
  scepter moved to the sash for the same reason.
- "Fully cyan energy" drawn as fluffy flames or blue hair instead of horns, with the old
  brown horns still underneath. Fix: the energy part keeps the real part's exact shape,
  "like polished glowing cyan crystal, never flames, smoke, mist or hair", and no trace of
  the old part remains.
- One attempt put level 5 back on four legs. Fix: "all three levels stand upright on two
  legs like level 4".
- Busy armour with dangling gold bells, and levels 6 and 7 in nearly the same pose. Fix:
  "a few large readable pieces, no bells"; level 7 gets "a different, prouder pose".

### Review log: sheet B, third attempt (October 2026)

With the anatomy, empty-hands and crystal-energy lines in §4d, all three sheet B's were
**accepted as generated**: two legs and two arms on every level, props worn (hammer on
the back, scepter in the sash), signature parts solid cyan crystal with no trace of the
old part, the core ladder right, the headpieces placed as specified. Notes for the
turnarounds:

- Rocco L5–6: the dark knob below the left fist is the hammer's handle end, not a hand.
  Say so in the turnaround prompt so Meshy doesn't model a third hand. The horns grow at
  6–7 but don't reach a double curl (accepted).
- Drako L5 and L7 cores sit off-centre, and L5 already shows lightning lines. Centre the
  core and drop the L5 lines in the turnarounds.
- Lumi L7's halo is faint; make it clearer in the turnaround.

Sheets: `assets/avatars/evolution/{rocco,lumi,drako}/<name>_sheet_b_levels_5-7.png`.

### Third sheet B superseded: levels 5–7 too alike (October 2026)

The user's review: the accepted sheet B's levels 5–7 look almost the same, only bigger
(and with more outfit). The template's "the signature feature doubles or spreads" was too
vague, so the generator just scaled it. Now (§3 rule 1, §4d): level 5 has a light outfit,
level 6 **doubles** the signature into something countable, level 7 **transforms** its
shape, with a different pose per level and "clearly different even at the same size".

| | L5 | L6 | L7 |
|---|---|---|---|
| Rocco | one pair of crystal horns, strap and belt only | **four horns**, fur mantle, shoulders twice as wide | four huge horns forming a **crown of horns**, circlet, crimson cape |
| Lumi | three short fronds a side, open jacket | **six long streamers a side**, sequin cape | one **fan crest** behind the head, crown, taller |
| Drako | two wings, sash and arm bands only | **four wings**, pauldrons, scepter in the sash | four wings fully spread, tips above the head, long swept horns, crown |

The level 5–7 turnaround prompts were removed; they get rewritten from the new sheets.
Four horns and four wings need extra bones in the 3D rig.

### Review log: sheet B, fourth attempt (October 2026)

With the doubling / transforming ladder, all three were **accepted as generated** and pass
the same-size test: Rocco 2 → 4 horns → crown of horns; Lumi short fronds → wide
streamers → tall fan crest; Drako 2 → 4 wings → 4 wings spread above the head with long
horns. Two legs and two arms at every level, hands empty, props worn. Accepted deviations
and turnaround notes:

- Rocco keeps short brown horn roots under the crystal horns at 5–7 (a nice link to
  level 4). L7 shows a thin gold chain near the core; the turnaround says no chain.
- Lumi's fronds keep a little pink at the base, about four fronds a side at L5. Her L7
  halo floats to one side; the turnaround puts it directly above the core.
- Drako's core is off-centre on all three; the turnarounds centre it.

The level 5–7 turnaround prompts were rewritten from these sheets
(`image-prompts/26–28, 33–35, 40–42`).

### Review log: Rocco turnarounds (October 2026)

The generator ignored most of the turnaround prompts and returned seven **four-legged**
rams, each with its own outfit. The user liked how different every level looks and chose
to **use them as they are**, so Rocco stays a quadruped at every level (§3 rule 6) and his
3D models no longer match sheets A and B. Known deviations, accepted:

- Not one consistent ram: amber or blue eyes, slate, tan or red-brown fur, a goatee at L5.
- No baby stage: every level is the same size with full curled horns.
- Cyan beyond the core and horns (ankle bands, harness gems, L7 body lines and forehead mark).
- Cores don't follow the §2 ladder.

The images came unordered; they were ranked by outfit (simplest first) and youth of the
face: L1 collar and ankle bands, L2 plain harness, L3 harness and saddlebags, L4 wool and
blue scarf, L5 grey armour harness, L6 gold collar armour and blue cloth, L7 full gold
armour. Saved as `Blender designs/boosties/sources/rocco_l<N>_turnaround.png`.

### Rocco 3D models (October 2026)

All seven turnarounds went through Meshy (`meshy_generate.py --split 4`) and
`build_boostie.py` (`rocco_l1`–`rocco_l7`). The rig is a quadruped like Zapi's, plus
rigid `horn.L` / `horn.R` bones; `glow_bones` is just the two horns, so only the horn
stripes and the core glow. Ankle bands, harness gems and armour stay plain. Every level
gets the same steel-blue iris, so the turnarounds' mixed eye colours don't show.
Eye fixes after the first phone check: L1 had a black ring round each eye (the default
dark socket plus Meshy's painted liner), fixed with a cream-tan `socket` and `reach` 1.5.
L4's right eye sat too deep; a bigger ball (`r` 0.038), a tan socket and `show` 0.32 /
`sink` 0.3 bring it level with the left. All seven are on the scoreboard test page.

### Eye colour, gaze and rim (October 2026)

- **One iris colour per character**, the same at every level (§3 rule 4). It lives in the
  `IRIS` table in `build_boostie.py`: Zapi amber, Bubo bright golden-yellow, Rocco steel
  blue, Lumi violet, Drako bright gold. Before this every build used Zapi's amber.
  Bubo's models and stills were updated by swapping the iris texture (no rebuild).
- **Eyes stay in sync.** The build aims each eyeball half along the face normal, so the two
  eyes splayed 15–47° apart and some looked different ways. `boostieLive.js` now evens
  them out at load (`alignEyes`, 8° outward each) and turns both eyes by the same amount
  when they follow a target (`aimEyes`, at most 26°).
- **Softer rim.** The rim light was a pale, near-white edge on every model, which looked like
  plastic or carved wood. It is now tinted by the surface colour, tighter (power 3) and the
  rim light is about half as strong.
- **Bust framing** in `scoreboard3d.js` and `render_stills.py` uses the head's width as well
  as its height, so wide heads (Rocco's horns) fit the scoreboard frame.

### Review log: Lumi turnarounds (October 2026)

As with Rocco, the generator ignored most of the prompts. The user chose to **use the
seven as they are**, because every level looks clearly different. Known deviations, accepted:

- Upright on two legs at every level (the spec has four legs at 1–3).
- No DJ theme: no star headband, headphones, sequin jacket, cape or crown. Each level
  wears its own gold-and-purple harness or collar instead.
- Skin drifts from pink (L1–2) through lavender to deep purple galaxy (L7). Every level
  keeps a different set of spots.
- Blue-violet eyes, not dark brown. The 3D build follows the images: Lumi's iris is
  **violet** (`IRIS` in `build_boostie.py`).
- Cyan beyond the core and frills: forehead marks, bracer gems, tail glow.
- Every level is the same size, and the frills don't follow the fronds → streamers → fan
  crest ladder.

The images came unordered; they were ranked by outfit and how far the skin has moved
from pink to purple: L1 no outfit, L2 harness with a silver star core, L3 purple straps
and bracers, L4 purple-and-gold collar with ankle bands, L5 gold collar with purple gloves
and feet, L6 moon mark and galaxy core, L7 leaf shoulder armour and crystal crest. Saved as
`Blender designs/boosties/sources/lumi_l<N>_turnaround.png`.
