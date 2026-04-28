---
name: Boost Premium Design System
description: New-gen UI overhaul completed April 2026 — dark navy gradient backgrounds, glossy gradient buttons with icon badges and arrow indicators, app-wide CSS class system
type: project
---

New premium design system implemented across the single-file index.html app in April 2026.

**Why:** Visual modernization to match a "next-gen mobile game" aesthetic — reference design was boost_aaa_mobile_menu_locked_logo.html.

**How to apply:** When making UI changes, use these classes and patterns:

## CSS classes added

- `.bd` — base glossy gradient button (blue by default; used app-wide)
- `.bd.g` — green variant
- `.bd.b` — blue variant  
- `.bd.bd-cyan` — cyan variant
- `.bd.bd-dark` — dark navy variant (for secondary menu items)
- `.bd.bd-gold` — gold variant (for highlight/share actions)
- `.hbtns .bd` — home menu treatment: adds right-side icon badge + left-side arrow
- `.bd-icon` — circular icon badge (position:absolute, right side in RTL)
- `.bd-text` — text wrapper for title + subtitle
- `.bd-title` — main button label
- `.bd-sub` — subtitle line (hidden on short screens via @media max-height:700px)

## Background
All non-game screens (#sh, #so, #ss, #scoin, #sprofile, #sauth-signup, #sauth-login, #sav-gallery, #sstats) get:
```
radial-gradient(circle at 74% 16%,rgba(0,194,255,.42),transparent 30%),
radial-gradient(circle at 20% 92%,rgba(32,61,176,.35),transparent 34%),
linear-gradient(145deg,#02061e 0%,#06133d 41%,#03759f 100%)
```

Game screen (#sg) keeps its original blue-teal background — do NOT change.

## Panels / overlays
- `.ovc` — overlay card: rgba(6,19,61,.94) + blur backdrop + rgba border
- `.sbox` — setup/auth panel: rgba(6,19,61,.88) + same treatment
- `.ovb.p` — primary overlay button: blue gradient (NOT gold anymore)
- `.db` — difficulty choice buttons: translucent dark with white border

## Key constraint
The file is a single 1.1MB index.html with all CSS/JS inline. No build step.
Game-board tiles, cell colors, and rack use the old beige/cream palette intentionally — do not change those.
