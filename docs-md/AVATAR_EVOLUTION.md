# AVATAR_EVOLUTION.md — Boostie Level System & Art Prompt Template

> Design spec for the evolving "Boostie" avatars (October 2026).
> The art comes from outside the codebase (the Boost art director plus an image
> generator). This file is the brief every character follows, so the whole roster
> levels up the same way. Nothing here is wired into the app yet.

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
| 7 | a **crowned core**: a radiant burst with a halo ring above it and a faint aura around the body |

Each step must be distinguishable at **64px**. The shape carries the meaning, so
it still works for colour-blind players.

## 3. Rules for every character

1. **One headline change per level, visible in the silhouette, plus one smaller
   detail.** If you can't name the headline change, the level isn't distinct enough.
2. **Changes must read from the chest up.** The scoreboard shows a ~76px bust, so
   boots and leg armour are invisible there. Put changes on the head, ears, shoulders,
   chest core and the tail or wings behind the body.
3. **Exactly two cyan elements:** the chest core (shared) and **one signature cyan
   feature** unique to the character (e.g. fox: tail; owl: wing runes; dragon: wing
   membranes). Armour, cloth and trim stay in metals and fabric, never cyan.
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
markings, palette, eye colour and signature feature as the reference. Three levels:

Level 5 (adult): full adult size and proportions, strong <PERSONALITY> expression,
first <ACCESSORY THEME> outfit pieces (<items>). The signature feature is fully
made of cyan energy. Chest core: a star-shaped cyan burst with sharp rays from a
bright centre.

Level 6 (champion): more presence and mass (<mane / cape / larger wings>), a
commanding pose, the full <ACCESSORY THEME> outfit. The signature feature doubles
or spreads. Chest core: a cyan burst with thin energy lines spreading from it into
the <fur / feathers / scales>.

Level 7 (legend): regal and legendary, an ornate <ACCESSORY THEME> headpiece
(<crown / hood circlet / horned helm>), the most refined outfit. The signature
feature at its maximum. Chest core: a radiant cyan crowned core with a halo ring
floating just above it and a faint cyan aura around the whole body. It should look
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
SIGNATURE CYAN:  the tail: a cyan tip at level 2, half energy at 4, a full energy tail at 5, two energy tails at 6–7
ACCESSORY THEME: trickster: hood, half-mask, scarf, small throwing knives
BODY TYPE:       quadruped at levels 1–3, becomes bipedal at level 4
CONSTANT MARKS:  cyan lightning-bolt mark on the forehead (from level 2), dark eye mask, amber eyes
```

Mapping the existing October 2026 fox sheets onto the 7 levels (for review only;
they predate the core ladder and the trickster theme):

| Lv | Existing image | Gap vs this spec |
|---|---|---|
| 1 | sheet 2, #1 (sitting kit) | core already present (should be a spark) |
| 2 | sheet 2, #2 | — |
| 3 | sheet 2, #3 | no first accessory yet |
| 4 | sheet 2, #5 (bipedal, sash) | — |
| 5 | sheet 1, #2 | knight armour → swap for trickster gear |
| 6 | sheet 1, #4 | knight armour, cyan armour trim |
| 7 | sheet 1, #5 | cyan armour trim, crown → trickster headpiece |

Levels 5–7 should be regenerated with sheet B above. Every core also needs to match
§2, since the current sheets use the same orb at every level.
