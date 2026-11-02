# agents/

Reader, Writer, Composer, Verifier, the JMA XML parser and the revision loop. TypeScript on Node 22, run with `tsx`.

| Command | What it does |
|---|---|
| `pnpm -F agents test` | unit and sample-based tests (`JMA_SAMPLES_DIR`, `JMA_FEED_DIR`, `EVAC_RAW_DIR` point at the non-redistributed inputs) |
| `pnpm -F agents validate <json>` | validate a layout / alert / municipality / shelters file against `schema/` |
| `pnpm -F agents jma <bulletin.xml>` | parse one JMA XML bulletin into alert JSON |
| `pnpm -F agents replay --municipality <id> [--summary]` | recorded JMA bulletins that concern a municipality, in issue order, as alert JSON |
| `pnpm -F agents shelters [id...]` | GSI shelter CSVs → `data/municipalities/<id>.shelters.json` |
| `pnpm -F agents reader [--dry-run] [--model sonnet\|haiku]` | municipal PDFs → municipality knowledge file (text-layer check, citations, structured outputs) |
| `pnpm -F agents writer --dry-run --alert <xml>` | the Writer request (live call on Day 2) |
| `pnpm -F agents compose ...` | alert + municipality + site + Writer output → four layout JSONs |
| `pnpm -F agents verify --layout <fixture>` | rule-based inspection of the rendered screen |
| `pnpm -F agents pipeline ...` | compose → verify → revise (≤ 3) → `data/reports/` |

## 実データ（気象庁 長期フィードの記録, 2026-10-11 〜 11-02）

The long feeds were recorded hourly from 2026-10-11 (20,592 bulletin bodies, 23 days; not redistributed here). `replay` only reads bulletins of the four supported types (VPWW55, VPWW56, VXKOnn, VTSE41); all 703 recorded bulletins of these types parse and validate. No archive of past bulletins exists, so these and the official samples are the only real data the demo can replay. No bulletin is invented or edited.

Bulletins that concern the demo municipalities (city code in the body, or the municipality's tsunami forecast region):

| Code | 輪島市 17204 | 吉田町 22424 | 横浜市 14100 |
|---|---|---|---|
| VPWW55 大雨 (R6) | 27 | 13 | 0 |
| VPWW56 土砂災害 (R6) | 12 | 7 | 5 |
| VXKOnn 指定河川洪水予報 | 0 | 0 | 0 |
| VTSE41 津波 | 0 | 0 | 0 |
| VPWW53 / VPWW54 (transition formats) | 140 / 140 | 106 / 106 | 79 / 79 |
| VPWW58 / VPWW59 / VPWW61 | 22 / 12 / 21 | 19 / 16 / 10 | 25 / 18 / 11 |
| VPHW50 / VPHW51 | 4 / 4 | 0 / 0 | 0 / 0 |

Highest level for the municipality in the replayable bulletins: 輪島市 level 3 (大雨 2026-10-20 05:00 and 10-21 12:15; 土砂災害 10-21 13:04), 吉田町 level 2 (大雨 10-20 09:55), 横浜市 none (土砂災害 bulletins list the city with no warning in force). Nationally the recording also holds level 4 landslide warnings (18 VPWW56) and level 5 flood special warnings (3 VXKO55), none for these three municipalities.

### What the real data caught

**A text layer that silently drops characters.** The 輪島市 tsunami hazard map has a text layer, but its CID fonts lack a ToUnicode map, so extraction loses glyphs (「最大津波 16.6m」 becomes 「最 津波 16.6m」, 「石川県」 becomes 「川県」). Character counts and script ratios both pass it, and the same symptom decodes fine in other PDFs, so the check marks such files `suspect` and stops; a person clears a file after a spot check, or `--allow-vision` reads the page images with `{method: "vision", cited_text: null}` provenance.

**A Level 5 special warning that lost its level.** The 2026-10-21 20:15 and 21:15 子吉川 bulletins list 由利本荘市 under 浸水想定地区（氾濫発生情報）, keyed by the breach point rather than a water-level station, so the city got no level and the Composer would have shown nothing during a Level 5 warning. Breach areas now take the forecast area's level, a fixture of the nine real bulletins guards it, and wherever a level still cannot be derived the Composer stops with that reason instead of treating the city as below the threshold.

**An all-clear for something never shown.** The first fan-out over the recorded feed produced nine all-clear screens out of 22 for advisories that had never been displayed (for example a Level 2 heavy-rain advisory lifted on 10-16). The Composer is stateless per bulletin, so the replay keeps, per hazard, whether a screen is showing, and an all-clear appears only after one was.

The recorded feed also held status words absent from the official samples (警報から注意報, 危険警報から注意報); the parser stopped on them, and only the two words that actually occur were added.
