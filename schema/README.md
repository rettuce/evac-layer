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
