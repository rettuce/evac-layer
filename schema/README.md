# schema/

Everything in this directory is dedicated to the public domain under CC0 1.0 ([`LICENSE`](LICENSE)), so a receiving system can ship these schemas inside a product of any licence. The rest of the repository is AGPL-3.0.

| File | Written by | Read by |
|---|---|---|
| `layout.schema.json` | Composer | Renderer, Verifier |
| `alert.schema.json` | JMA XML parser (`agents/src/jma/`) | Writer, Composer |
| `municipality.schema.json` | Reader (`agents/src/reader/`) | Writer, Composer |
| `common.schema.json` | shared `$defs` (hazard, level, municipality id) | all of the above |
| `site.schema.json` | the integrator (`data/sites/<id>.json`, one per venue) | Composer, fan-out, app |
| `municipality-preset.schema.json` | the integrator (`data/municipalities/<id>.preset.json`) | Reader, shelters CLI |
| `feed.schema.json` | feed API / webhook (render seat) | other signage systems |
| `export-manifest.schema.json` | `pnpm -F agents export` | systems that take files only |

Validate any document: `pnpm -F agents validate <file.json>` (schema inferred; `--schema` to force).

- `alert.status` is written only for a drill (`drill`, Control/Status 訓練) or test (`test`, 試験) bulletin; a normal bulletin's layout has no `status`, so its bytes are as before. A drill or test screen is never approved by class (`app/layout/gate.ts`).
- Colors are never written into layout JSON. `palette: "cabinet-office-5"` tells the Renderer to use the Cabinet Office five-level tokens.
- Tsunami bulletins carry no five-level value (`level: null`). The Composer maps `tsunami.highest_category` to a level token: `major_warning` → Lv4 token, `warning` → Lv3, `advisory` → Lv2, `forecast` / `cleared` → Lv1 (same ordering as JMA tsunami warning colors).
- Tsunami areas are forecast regions, not municipalities; `data/jma/tsunami-regions.json` maps the regions of the demo municipalities only; a municipality missing from it gets a warning when a tsunami bulletin is processed.
- `ja_easy` follows 出入国在留管理庁・文化庁「在留支援のためのやさしい日本語ガイドライン」(2020-08, https://www.moj.go.jp/isa/content/930006072.pdf, step 2 on printed pp.7-9); rules are quoted in `agents/src/writer/rules.ts`, signage conventions (kana with spaces, JMA warning names verbatim) are listed separately there.

## Composer (agents/src/composer/)

- Slots and required cells come from the render seat's public `resolveTemplate(templateId, shape)` (`app/layout/README.md`), read through `agents/src/composer/template.ts#shapeContract`. The Composer also adds the `languages` cell the contract requires on 16x9 / 9x16 / 32x9 and stops if a required role is missing.
- `pillar` (a column wrapped by LED on four faces, each face repeating a 9:16 screen): the Composer emits it with the 9:16 slots, required roles (languages included) and budgets (`CELLS_OF` in `agents/src/composer/rules.ts`) as a fifth `pillar.json`; the renderer draws the faces at 6616 × 5046 and exports are captured at half scale (3308 × 2523). Until the renderer has the shape, `--skip-browser-shapes pillar` (fanout / replay-pipeline / pipeline) checks it statically only and marks the index row `browser_skipped`, and `export --skip-shapes pillar` leaves it out.
- Action pictogram shows the action, never the hazard (the headline pictogram carries that): `all-clear` → safe_here, tsunami and `secure-now` → go_higher, otherwise directions_run. The Writer is given the pictogram's meaning and writes the action to match; the action text never uses a municipal order name (高齢者等避難・避難指示・緊急安全確保), because the screen comes from a JMA warning (both found by the Vision Verifier on the real replay).
- Template choice: level 5 → `secure-now` (Cabinet Office 緊急安全確保: no shelter or direction cell, action is immediate safety where people are, no evacuation wording); tsunami major warning / warning / advisory and level 4 → `evac-now`; level 3 → `evac-prepare`; all areas cleared → `all-clear`; tsunami forecast or level ≤ 2 → no screen. All four (`secure-now`, `evac-now`, `evac-prepare`, `all-clear`) are defined in templates.ts.
- Shelter: nearest GSI designated emergency evacuation site (text = facility name, `kind` = designation) whose designated hazards match the alert (heavy_rain → inland_flood or flood), excluding any name listed in `conflicts[]`; distance rounded to 10 m and shown once, on the shelter cell. A site without `facing_deg` gets a north-up direction cell (`orientation: "north-up"`, `rotation` = the 8-point map bearing with north up, 270): there the distance moves to the direction cell (`distance_m`), beside the direction word, except on 9x16 `evac-now` / `secure-now`, where a two-line action leaves no room and it stays on the shelter cell. The rule is `northDistanceOn(template, shape)` in `app/layout/northUp.ts`.

### Character budgets (provisional, `agents/src/composer/budgets.ts`)

- Headline: ja 14 / ja_easy 18 / en 24 on every shape. The headline is the JMA warning name verbatim, with 解除 appended when the bulletin clears it, so the ja budget is set by the longest such name (「レベル４土砂災害危険警報解除」14), not by width; the renderer must fit it (two lines on 9x16 / 32x9 where needed). The other languages are the name's entry in JMA's multilingual dictionary (`data/jma/warning-names.json`, an all-clear joins it with the entry for 解除) and ja_easy is the fixed paraphrase in `data/jma/warning-names-ja-easy.json`. Neither is held to the budget, which they exceed (en "Level 4 Urgent Warning (Landslide)" 34): the renderer draws the headline's ja only, and a dictionary entry is never shortened.
- Other cells: one line in the cell's track at the action/guide type sizes, with full-width ja ≈ 1 em and en ≈ 0.55 em per character, rounded down, except where the render seat measured the screen (2026-11-02): on 1x1 the action line holds 6 full-width characters on `evac-prepare` (shelter is required, one line only) and 12 on `evac-now` / `secure-now` / `all-clear` (two lines); the 1x1 ja_easy line holds 24. Budgets are looked up per template and shape (`budgetsFor`).
- Shelter cell: `text.ja` is the GSI facility name only; `kind` (emergency_evacuation_site | evacuation_shelter) lets the renderer draw the fixed multilingual designation label. The name may take two lines.
- Over-budget text stops the Composer; it never truncates.

## Revision loop (agents/src/loop/, `pnpm -F agents pipeline`)

- Compose → verify → send findings back to the Writer → recompose, up to 3 attempts. Findings a rewrite can fix: `over-budget`, `font-size`, `overflow`, `distance-duplicated`. Anything else (a missing required cell, flicker) stops the loop at once, because rewriting text cannot fix it.
- The `static` Verifier checks what needs no rendering (layout schema, duplicated distance, a north-up arrow whose angle contradicts its direction word: `direction-mismatch`). Font size, overflow and flicker need the browser Verifier, which joins the loop once `/screen` accepts an arbitrary layout via `?src=`.
- Report: `data/reports/<site_id>/<bulletin_id>/report.json` with `--publish` (otherwise under `tmp/pipeline/`) (every attempt with its Writer source and findings, outcome and reason) plus `layouts/<shape>.json` from the last attempt.
- Until the API key is in place, Writer revisions come from fixture files (`--revisions`); without them the live reviser declines rather than inventing text.
