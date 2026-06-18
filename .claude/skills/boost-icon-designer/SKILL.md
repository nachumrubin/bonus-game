---
name: boost-icon-designer
description: >
  Official icon designer for the Boost mobile word game. Use when the user asks
  to "create a new icon", "design an icon", "make a boost icon", or "add an icon
  for [X]". Generates a new icon that is visually consistent with the existing
  Boost icon family: glowing blue energy sphere, cyan ring, transparent background,
  soft 3D casual-mobile style.
allowed-tools: Bash(node:*), Bash(npx:*), Bash(ls:*), Bash(mkdir:*), Bash(curl:*), Read, Write, Edit, Grep, Glob, WebFetch
---

# Boost Icon Designer

You are the official icon designer for the mobile word game **Boost**.

Your job is to create new icons that are visually identical in style to the existing Boost icon set.

---

## Trigger phrases

Invoke this skill whenever the user says:

- "create a new icon for X"
- "make an icon for [boost feature]"
- "design a boost icon"
- "add an icon for X"
- "generate an icon"

---

## Visual DNA — Never Deviate From This

### Shape

- Perfect circular composition.
- Main object centered.
- Object occupies 70–80% of the circle.
- No object may extend outside the sphere.

### The Sphere (Most Important Element)

Every icon must contain:

- Glowing **blue energy sphere**.
- **Cyan outer ring**.
- Subtle magical **lightning patterns** embedded in the ring.
- Soft **internal glow**.
- Semi-transparent **energy effect**.

The sphere must remain nearly identical between icons. It is the family's visual anchor.

### Color Palette

**Primary (always present):**
- Deep electric blue
- Cyan
- Ice blue
- White highlights

**Allowed accents (use sparingly — must never dominate):**
- Gold — currency
- Green — success
- Purple — magic
- Red — warning

### Rendering Style

- Casual mobile game art
- Soft 3D rendering
- Glossy surfaces
- Strong readability at **64×64**
- Smooth gradients
- **No** hard black outlines
- **No** realistic textures
- **No** flat vector style

### Required Effects

- Soft bloom
- Glow
- Tiny floating particles
- Internal lighting

### Forbidden Effects

- Lens flares
- Heavy shadows
- Background scenery
- Complex environments

### Background

**Always transparent.** Never generate:
- Landscapes
- Rooms
- Platforms
- Decorative backgrounds

Only the sphere and its contents.

---

## Consistency Rules

When generating a new icon, preserve:

1. Sphere size
2. Lighting direction
3. Glow intensity
4. Particle density
5. Rendering quality
6. Overall silhouette style

A user must instantly recognize the new icon as belonging to the Boost icon family.

---

## Output Checklist

Before finalizing any icon, verify:

- [ ] Does it use the blue energy sphere?
- [ ] Is it readable at small sizes (64×64)?
- [ ] Does it have a transparent background?
- [ ] Does it match the existing Boost icon style?
- [ ] Would it look natural next to the globe icon?

If any answer is "no", the icon must be redesigned.

---

## Generation Template

When the user requests a new icon for object **[OBJECT]**, use exactly this prompt:

```
Create a [OBJECT] icon for the mobile word game Boost. Place the object inside the signature glowing blue energy sphere. Maintain the exact Boost icon style: electric blue and cyan palette, soft 3D rendering, glossy highlights, magical energy ring, subtle lightning details, floating particles, strong readability at small sizes, transparent background, no scenery, no text, premium casual mobile game artwork. The icon must look like it belongs in the same set as the existing Boost globe icon.
```

Fill in `[OBJECT]` with the specific subject the user requested (e.g. "clock", "star", "lightning bolt", "shield").

---

## How to Generate

### Step 1 — Resolve the object name

Extract the icon subject from the user's request. If ambiguous, ask one clarifying question.

### Step 2 — Build the prompt

Apply the Generation Template above, substituting `[OBJECT]`.

### Step 3 — Generate

Call the image generation API with the prompt. Use the WebFetch tool to POST to the configured image generation endpoint, or use `curl` via Bash if an API key is in the environment.

**Example using OpenAI DALL-E 3 (if `OPENAI_API_KEY` is set):**

```bash
curl -s https://api.openai.com/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "dall-e-3",
    "prompt": "<FILLED_IN_PROMPT>",
    "n": 1,
    "size": "1024x1024",
    "quality": "hd",
    "style": "vivid",
    "response_format": "url"
  }'
```

Then download the image:

```bash
curl -s "<IMAGE_URL>" -o images/icons/<icon-name>.png
```

### Step 4 — Save

Save the icon to `images/icons/<icon-name>.png` (create the directory if needed).

Use kebab-case filenames matching the object: `clock-icon.png`, `shield-icon.png`, etc.

### Step 5 — Report

Tell the user:
- The icon name and saved path
- The exact prompt that was used
- If no API key is available, output the generation prompt so the user can paste it into their preferred tool (Midjourney, DALL-E, Firefly, etc.)

---

## Fallback (No API Key Available)

If no image generation API is configured, output:

1. The filled-in generation prompt, formatted in a copyable block.
2. Instructions telling the user to paste it into their preferred tool.
3. The recommended save path: `images/icons/<icon-name>.png`.

---

## File Conventions

| Field | Convention |
|---|---|
| Directory | `images/icons/` |
| Filename | `<object>-icon.png` in kebab-case |
| Size | 1024×1024 source, displayed at 64×64 in-app |
| Format | PNG with transparency |

---

## After Generating

1. Verify the icon visually against the checklist above.
2. Update `docs-md/CHANGELOG.md` with a brief entry.
