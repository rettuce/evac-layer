---
name: evac-contract
description: The contract between the agents (Composer, Writer, Verifier), the renderer (app/) and the demo, as fixed during the build. Use before changing a layout JSON field, a template, a shape, a DOM attribute the Verifier reads, or anything another part of the repository depends on.
---

# evac-contract

The layout JSON is the intermediate form: the Composer writes it, the renderer draws it, the Verifier checks it. `schema/layout.schema.json` is the machine-checked version; this is the reasoning behind it. Change the contract in one place and tell every part that reads it.

## Layout JSON

- `shape`: `16x9`, `9x16`, `32x9`, `1x1`, `pillar`. `template`: `evac-prepare` (level 3), `evac-now` (level 4), `secure-now` (level 5), `all-clear`, `shelter-direction`.
- `alert.level` is the display level 1–5. Tsunami bulletins have no Cabinet Office level, so the Composer maps major warning → 4, warning → 3, advisory → 2, forecast / cleared → 1.
- `cells[].role`: `headline`, `action`, `direction`, `shelter`, `languages`, `source`. `text` keys: `ja` (required), `ja_easy`, `en`, `zh_hans`, `zh_hant`, `ko`, `th`, `vi`, `fil`, `id` (that order is the band's order; `action` and `languages` carry all ten).
- `motion`: `scale-in` once on appearance, `pulse` at 1 Hz or slower, `static`. There is no blinking.
- Colours are the Cabinet Office 2020 warning-level colours, held by the renderer as tokens; the Composer never writes a colour.
- Every screen carries its sources (`pdf` with page, `gsi`, `jma` with bulletin id) in `sources[]`; the source cell shows only the issuer, its time and the municipality (気象庁 10/21 19:45 発表・由利本荘市 / JMA 19:45, Oct 21 · Yurihonjo).

## Rules the parts rely on

- A drill bulletin (Control/Status 訓練, `alert.status: "drill"`) carries a drill word in every language of the headline (ja: 【訓練】 prefix, by code) and in every language but ja of `action` / `languages`; the Verifier's `drill-marker` check sends the Writer back otherwise.
- A tsunami region downgraded from a warning or advisory to 津波予報（若干の海面変動） gets an all-clear screen: headline 「〈last warning name〉解除」, action "stay out of the sea, away from the coast" with the all-clear pictogram `safe_here` (the action pictogram shows the action only; the hazard is the headline's) (`situation.caution: "sea_level_change"`). A forecast that arrives on its own shows nothing.
- The headline is the JMA warning name verbatim, set by code (Meteorological Service Act art. 23), with 解除 appended on an all-clear. The Writer writes the other languages only.
- Level 5 (`secure-now`) never shows a shelter or a direction and never uses evacuation wording: moving may itself be dangerous.
- An all-clear appears only for a warning that was shown on screen.
- The action pictogram shows the action, never the hazard: all-clear → `safe_here`, tsunami and level 5 → `go_higher`, otherwise `directions_run`.
- The action text never uses a municipal order name (高齢者等避難, 避難指示, 緊急安全確保); the screens come from JMA warnings, not from the city. English text carries no Japanese script.
- The shelter cell holds the GSI facility name only; `kind` tells the renderer which designation label to draw. Distance appears once, on the shelter cell.
- `languages` is required on 16x9, 9x16, 32x9 and pillar.
- Type sizes come from viewing distance (1 inch per 10 ft) on a 55-inch panel: 11 m → 144 px, 5 m → 64 px, 2 m → 28 px at a 1080 px short side.

## DOM the Verifier reads

`.evac-screen` carries `data-shape`, `data-template`, `data-level`, `data-ready="1"`, `data-dropped="<cell>:<reason>,…"`, `data-overflow="<cell>:<lang>,…"` (`lang` is a text key, `ja` for code-written text, `pictogram`, or `screen`) and `data-missing-required`. Each cell carries `data-cell-id`, `data-role`, `data-priority`, `data-motion`.

## Pillar

A column 1.062 m square wrapped by LED from 0.40 to 3.60 m: 6616 × 5046 logical px (four faces of 1654 px at 1577 px/m, the density of a 55-inch 9:16 panel), exported and recorded at half scale, 3308 × 2523. In an alert the same screen repeats on every face so that everyone sees the same information from any side; the ambient layer treats the four faces as one continuous picture. The Composer emits pillar with the 9:16 cells; the Verifier counts face 0 only.

## Files

`data/layouts/<municipality>/<bulletin>/<shape>.json` and `index.json` (every recorded bulletin, with `screen` and a reason when there is none); `data/reports/<municipality>-<bulletin>/report.json`; `data/sites/<id>-demo.json` (hand-written; `replay` sets the demo window); `data/approvals.json` (written by /admin, not committed).
