# Dictionary Build Pipeline

Builds the v2 Hebrew dictionary shipped to the game as `data/dictionary.v2.bin` (DAWG-encoded). The pipeline is **lemma-first, multi-source, paradigm-gated** — only inflections (הטיות) derived from approved lemmas via approved paradigms make it into the final list.

See [the plan](../../../.claude/plans/the-biggest-problem-with-twinkly-canyon.md) for the full design.

---

## Quick Start

```bash
# Phase 1: fetch + build HSpell (Linux/WSL only — see 01-fetch-hspell.sh)
bash tools/dictionary-build/01-fetch-hspell.sh

# Phase 2: enumerate, corroborate, filter, inflect
node tools/dictionary-build/02-enumerate.js
node tools/dictionary-build/03a-extract-lemmas.js
node tools/dictionary-build/03b-corroborate-lemmas.js
node tools/dictionary-build/03c-filter-lemmas.js
node tools/dictionary-build/03d-inflect.js

# Phase 2e: human review (only if there are unreviewed entries)
node tools/dictionary-build/04-review-queue.js
# … reviewer fills in review/manual-decisions.tsv …

# Phase 2f: merge + gate
node tools/dictionary-build/05-merge-and-gate.js

# Phase 3: encode
node tools/dictionary-build/06-encode.js
```

If all gates pass, the script emits `data/dictionary.v2.bin` and `data/dictionary.v2.meta.json`.

---

## Layout

| Path | Purpose |
|------|---------|
| `01-fetch-hspell.sh` | Clone + build HSpell. **Requires Linux or WSL** (perl + autotools). |
| `02-enumerate.js` | Run HSpell's `wolig`/`hspell -l` and dump raw surface forms with lemma+paradigm tags. |
| `03a-extract-lemmas.js` | Parse HSpell `wolig.dat` → `output/hspell-lemmas.tsv`. |
| `03b-corroborate-lemmas.js` | Cross-check lemmas against Wiktionary, Wikipedia frequency, legacy 40K. |
| `03c-filter-lemmas.js` | Apply categorical blacklists (proper nouns, foreign, archaic, slurs, brands). |
| `03d-inflect.js` | Generate surface forms via paradigms whitelisted in `config/paradigms-allowed.yaml`. |
| `04-review-queue.js` | Emit unreviewed-lemmas CSV for native-speaker grading. |
| `05-merge-and-gate.js` | Union with legacy 40K, apply EXACT_REJECTS, run quality gates. |
| `06-encode.js` | DAWG-encode the curated list → `data/dictionary.v2.bin`. |
| `dawg.js` | Pure-JS DAWG encoder + decoder (also imported by the runtime). |
| `config/paradigms-allowed.yaml` | Whitelist of HSpell paradigm IDs included in generation. |
| `config/policy-blacklist.txt` | Slurs and policy-excluded lemmas (one per line). |
| `config/brand-blacklist.txt` | Brand names (one per line). |
| `config/archaic-blacklist.txt` | Archaic / Aramaic / liturgical-only lemmas. |
| `config/foreign-allow.txt` | Foreign words explicitly allowed (overrides foreign filter). |
| `config/gold-positive.txt` | Held-out test set: words that must validate ≥ 99%. |
| `config/gold-negative.txt` | Held-out test set: words that must NOT validate ≥ 98%. |
| `review/manual-decisions.tsv` | Reviewer decisions persisted across rebuilds. |
| `output/` | Intermediate pipeline artifacts (gitignored except `curation-report.txt`). |

---

## Licensing

HSpell is **GPLv2**. The generated word list is data, but if this project is ever released under a non-GPL-compatible license, the source has to change. See [LICENSE.md](LICENSE.md) for details before shipping.

---

## Status

The pipeline scripts are **scaffolded but not yet run end-to-end**. Inputs (HSpell build output, Wiktionary dump, Wikipedia frequency list) must be produced first. See each script's header comment for input/output contracts.

The current `data/dictionary.v2.bin` shipped in the repo was generated from the legacy `data/dictionary.base.txt` as a placeholder — same content, new format — so that the runtime swap can be tested independently of the lexicon work.
