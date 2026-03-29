# bonus-game
A Hebrew scrabble mobile game.

## Build timestamp automation

You no longer need to manually edit timestamp values in `sw.js` and `index.html`.

Run this before each deploy/build:

```bash
node scripts/stamp-build.js
```

What it updates automatically:
- `sw.js` cache name: `bonus-<timestamp>`
- `index.html` meta version
- `index.html` visible build label
- `index.html` `sw.js?v=<timestamp>` registration query param

### Optional: use a fixed timestamp

```bash
node scripts/stamp-build.js 20260329150000
```

The script expects a 14-digit format: `YYYYMMDDHHmmss` (UTC).
