# schema/

| File | Written by | Read by |
|---|---|---|
| `layout.schema.json` | Composer | Renderer, Verifier |
| `alert.schema.json` | JMA XML parser (`agents/src/jma/`) | Writer, Composer |
| `municipality.schema.json` | Reader (`agents/src/reader/`) | Writer, Composer |
| `common.schema.json` | shared `$defs` (hazard, level, municipality id) | all of the above |

Validate any document: `pnpm -F agents validate <file.json>` (schema inferred; `--schema` to force).

- Colors are never written into layout JSON. `palette: "cabinet-office-5"` tells the Renderer to use the Cabinet Office five-level tokens.
- Tsunami bulletins carry no five-level value (`level: null`). The Composer maps `tsunami.highest_category` to a level token: `major_warning` → Lv4 token, `warning` → Lv3, `advisory` → Lv2, `forecast` / `cleared` → Lv1 (same ordering as JMA tsunami warning colors).
- Tsunami areas are forecast regions, not municipalities; `agents/src/jma/regions.ts` maps the regions of the demo municipalities only.
- `ja_easy` follows 出入国在留管理庁・文化庁「在留支援のためのやさしい日本語ガイドライン」(2020-08, https://www.moj.go.jp/isa/content/930006072.pdf, step 2 on printed pp.7-9); rules are quoted in `agents/src/writer/rules.ts`, signage conventions (kana with spaces, JMA warning names verbatim) are listed separately there.

## Composer (agents/src/composer/)

- Slots and required cells come from `app/layout/templates.ts` (render seat), read only through `agents/src/composer/template.ts#shapeContract`. A shape may have several layout variants chosen at render time, so the Composer uses the union of their slots and the union of their required roles. It also adds the `languages` cell the contract requires on 16x9 / 9x16 / 32x9 and stops if a required role is missing.
- Template choice: tsunami major warning / warning / advisory and level 4-5 → `evac-now`; level 3 → `evac-prepare`; all areas cleared → `all-clear`; tsunami forecast or level ≤ 2 → no screen. `evac-now` and `evac-prepare` are defined in templates.ts; `all-clear` stops with a reason until it is.
- Shelter: nearest GSI designated emergency evacuation site whose designated hazards match the alert (heavy_rain → inland_flood or flood), excluding any name listed in `conflicts[]`; distance rounded to 10 m and shown once, on the shelter cell.

### Character budgets (provisional, `agents/src/composer/budgets.ts`)

- Headline: ja 12 / ja_easy 18 / en 24 on every shape. The headline uses the JMA warning name verbatim, so the budget is set by the longest official name (ja「レベル４土砂災害危険警報」12, en "Major Tsunami Warning" 21), not by width; the renderer must fit it (two lines on 9x16 / 32x9 where needed).
- Other cells: one line in the cell's track at the action/guide type sizes, with full-width ja ≈ 1 em and en ≈ 0.55 em per character, rounded down. To be replaced by measurements from `scripts/shot.mjs` after integration.
- Over-budget text stops the Composer; it never truncates.
