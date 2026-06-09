# Licensing Notes — Dictionary Build Pipeline

## HSpell (AGPLv3 — note: relicensed)

HSpell (https://hspell.ivrix.org.il/) is licensed under the **GNU Affero General Public License version 3** as of HSpell 1.4. (Earlier HSpell releases were GPLv2; the relicensing to AGPLv3 confirmed by the header in `wolig.pl` output: *"licensed under the GNU Affero General Public License (AGPL) version 3"*.)

**AGPLv3 is strictly more restrictive than GPLv2** — it adds the "network use is distribution" clause. For a server-hosted web game like this one, that is the relevant restriction: if HSpell-derived data is served to users over the network, the AGPL position is that you must offer the corresponding source to those users.

The output of this pipeline — `data/dictionary.v2.bin` — is a generated Hebrew word list derived from HSpell's morphological database. There are two reasonable legal positions:

1. **List of words is uncopyrightable data.** A bare list of words is generally not considered a creative work under copyright law (factual / functional). Under this view the binary is not a derivative of HSpell and carries no license obligation.
2. **Derivative work via the generator.** The list was produced by running HSpell's `wolig` against its lexicon. A court might consider that a derivative work, triggering GPLv2 copyleft on the binary.

**Before shipping commercially or under any non-GPLv2-compatible license, get legal sign-off.** If position 2 prevails and the rest of bonus-game is not GPLv2-compatible, options are:

- **Switch source:** rebuild from Hunspell `he_IL` (MPL/GPL/LGPL tri-license, more permissive in practice) or from Wiktionary dumps alone (CC-BY-SA, attribution-only).
- **Dual-host the word list:** ship the dictionary as a separate GPLv2 component the client fetches at runtime; the rest of the app remains under its original license.
- **Commission a clean list:** pay for a permissively-licensed Hebrew lexicon (some commercial Hebrew NLP vendors offer this).

## Wiktionary & Wikipedia inputs

Hebrew Wiktionary and Wikipedia content is **CC-BY-SA 3.0**. Using their content as one of several corroboration signals (we don't ship Wikipedia text — we use it to *gate* which HSpell lemmas appear) is generally fine, but attribution should appear somewhere user-accessible (e.g. the in-app credits screen).

## Existing 40K base list

Origin of `data/dictionary.base.txt` is not documented in the repo. Before deletion (planned in the rollout cleanup commit), confirm whether it carries a license that must be preserved.

---

**Decision needed before promoting `?dict=v2` to default:** which legal position applies, and if (2), which mitigation we take.
