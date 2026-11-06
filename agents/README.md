# agents/

Reader, Writer, Composer, Verifier, the JMA XML parser and the revision loop. TypeScript on Node 22, run with `tsx`.

| Command | What it does |
|---|---|
| `pnpm -F agents test` | unit and sample-based tests (needs the raw inputs below) |
| `pnpm -F agents validate <json>` | validate a layout / alert / municipality / shelters / site / municipality preset file against `schema/` |
| `pnpm -F agents jma <bulletin.xml>` | parse one JMA XML bulletin into alert JSON |
| `pnpm -F agents replay --municipality <id> [--summary]` | recorded JMA bulletins that concern a municipality, in issue order, as alert JSON |
| `pnpm -F agents shelters [id...]` | GSI shelter CSVs → `data/municipalities/<id>.shelters.json` (names and CSV list from `<id>.preset.json`) |
| `pnpm -F agents reader --municipality <id> [--dry-run] [--model sonnet\|haiku]` | municipal PDFs → municipality knowledge file (text-layer check, citations, structured outputs); the PDF list is `data/municipalities/<id>.preset.json` |
| `pnpm -F agents writer --dry-run --alert <xml>` | the Writer request, printed without calling the API |
| `pnpm -F agents compose ...` | alert + municipality + site + Writer output → five layout JSONs (16x9, 9x16, 32x9, 1x1, and pillar, which repeats the 9:16 cells on four faces) |
| `pnpm -F agents verify --layout <fixture>` | rule-based inspection of the rendered screen |
| `pnpm -F agents pipeline ...` | compose → verify → revise (≤ 3) → `tmp/pipeline/` (`--publish`: `data/layouts/<site_id>/` and `data/reports/<site_id>/`) |
| `pnpm -F agents fanout [--sites <id,...>] --verifier static\|browser\|vision --writer placeholder\|live` | replay every recorded bulletin of each site's municipality through the loop → `data/layouts/<site_id>/` and `data/reports/<site_id>/`. Default: every site in `data/sites/`; `--municipalities <ids>` means every site in those municipalities (`--skip-browser-shapes pillar` checks a shape statically only) |
| `pnpm -F agents export --site <site_id>` | approved screens of `data/layouts/<site_id>/` → PNG + self-contained HTML per shape and `manifest.json` (pillar captured at half scale, 3308 × 2523; `--skip-shapes` leaves shapes out) |
| `pnpm -F agents live --site <site_id> (--bulletin <id> \| --clear)` | writes `data/live/<site_id>.json` (`{bulletin_id, updated_at}`), the current bulletin of a site without `replay`; the renderer shows it when it is approved and the site has auto publish on |

A site is `data/sites/<site_id>.json` (`schema/site.schema.json`); several sites may share a municipality, and each gets its own screens. Approvals are keyed `<site_id>/<bulletin_id>`; an older `<municipality>/<bulletin_id>` key is read as the municipality's only site and ignored with a warning when it has two or more. `browser`/`vision` verification and `export` need the app running (`pnpm -F app dev`) at `EVAC_URL`.

### Settings

Read from the environment, then from `.env` at the repository root.

| Variable | Default | Used for |
|---|---|---|
| `EVAC_DATA_DIR` | `<repo>/data` | sites, layouts, reports, municipalities, approvals, live state (the app reads the same variable; `NUXT_DATA_DIR` remains its alias) |
| `EVAC_RAW_DIR` | `<repo>/data/raw` (gitignored) | non-redistributed inputs: `gsi-shelters/<id>_1.csv`, `<id>_2.csv` from https://hinanmap.gsi.go.jp/hinanjocp/defaultFtpData/csv/ and the municipal PDFs listed in each preset |
| `JMA_FEED_DIR` | `<EVAC_RAW_DIR>/jma-feed` | a recording of the JMA XML long feeds as `bodies/<YYYYMMDD>/<id>.xml` (https://www.data.jma.go.jp/developer/xml/feed/) |
| `JMA_SAMPLES_DIR` | `<EVAC_RAW_DIR>/jma-samples/unzipped` | the official JMA sample bulletins (https://xml.kishou.go.jp/), for the municipalities in `data/samples/` |
| `EVAC_URL` | `http://127.0.0.1:3150` | the app for browser verification and export |
| `CHROME_PATH` | first of the usual macOS / Linux Chrome and Chromium paths | headless Chrome for browser verification and export |

Commands that need a raw input stop with exit 1 and say what is missing and where to get it. Tsunami forecast regions → municipalities are `data/jma/tsunami-regions.json`; a municipality missing from it gets a warning when a tsunami bulletin is processed.

## 実データ（気象庁 長期フィードの記録, 2026-10-11 〜 11-02）

The long feeds were recorded hourly from 2026-10-11 (20,592 bulletin bodies, 23 days; not redistributed here). `replay` only reads bulletins of the four supported types (VPWW55, VPWW56, VXKOnn, VTSE41); all 703 recorded bulletins of these types parse and validate. No archive of past bulletins exists, so these and the official samples are the only real data the demo can replay. No bulletin is invented or edited. The recording never carried a tsunami warning for any of the five municipalities, so `data/samples/<id>.json` names official JMA sample bulletins (read from `JMA_SAMPLES_DIR`, unmodified) that `replay` adds to the recording: 輪島市 and 吉田町 replay the 2016-09-01 VTSE41 drill series, in which 石川県能登 is under 津波注意報 and then cleared, and 静岡県 is under 大津波警報 and then downgraded to a forecast, which clears the screen with a sea-level caution. A warning screen is taken down only by a bulletin that says the warning ended, as an all-clear or as a downgrade to a forecast; if a later bulletin simply stopped listing the region, the screen would stay up. JMA states clearances explicitly, and no recorded or sample bulletin does otherwise, so this case is documented rather than handled. Drill bulletins (Control/Status 訓練) are shown with the drill word opening the headline in every language and the action in every language but Japanese.

Bulletins that concern the three municipalities surveyed first (city code in the body, or the municipality's tsunami forecast region):

| Code | 輪島市 17204 | 吉田町 22424 | 横浜市 14100 |
|---|---|---|---|
| VPWW55 大雨 (R6) | 27 | 13 | 0 |
| VPWW56 土砂災害 (R6) | 12 | 7 | 5 |
| VXKOnn 指定河川洪水予報 | 0 | 0 | 0 |
| VTSE41 津波 | 0 | 0 | 0 |
| VPWW53 / VPWW54 (transition formats) | 140 / 140 | 106 / 106 | 79 / 79 |
| VPWW58 / VPWW59 / VPWW61 | 22 / 12 / 21 | 19 / 16 / 10 | 25 / 18 / 11 |
| VPHW50 / VPHW51 | 4 / 4 | 0 / 0 | 0 / 0 |

由利本荘市 05210 and 柏崎市 15205 were added on Day 2 and 3. Of the four replayable types, 由利本荘市 has VPWW55 20, VPWW56 33 and VXKO55 9 (the 子吉川 flood sequence of 2026-10-21), and 柏崎市 VPWW55 30 and VPWW56 44 (`data/layouts/<site_id>/index.json`); the transition-format counts were not recorded for them.

Highest level for the municipality in the replayable bulletins: 由利本荘市 level 5 (子吉川 氾濫特別警報 2026-10-21 19:45, 20:15 and 21:15), 柏崎市 level 4 (土砂災害 10-31 16:53 and 18:39), 輪島市 level 3 (大雨 2026-10-20 05:00 and 10-21 12:15; 土砂災害 10-21 13:04), 吉田町 level 2 in the recording (大雨 10-20 09:55) and display level 4 from the official sample 大津波警報, 横浜市 none (土砂災害 bulletins list the city with no warning in force). Nationally the recording also holds level 4 landslide warnings (18 VPWW56) and level 5 flood special warnings (3 VXKO55), none for these three municipalities.

### Reader runs (2026-11-02, first live run)

Municipal PDFs → municipality knowledge file, `pnpm -F agents reader --municipality <id> --model <m> --allow-vision`. The Sonnet output is the published `data/municipalities/<id>.json`. Seconds were only measured for 輪島市 (the other runs went in parallel; later runs record `seconds` in the usage file).

| Municipality | Model | Cost | Input / output tokens | Vision pages | Seconds | Claims | Shelter mentions | Hazards | Conflicts with GSI |
|---|---|---|---|---|---|---|---|---|---|
| 輪島市 17204 | Sonnet 5.5 | $0.257 | 36,703 / 18,320 | 1 | 98 | 146 | 113 | 2 | 20 |
| 輪島市 17204 | Haiku 5.5 | $0.009 | 22,690 / 13,790 | 1 | 53 | 35 | 19 | 5 | 12 |
| 由利本荘市 05210 | Sonnet 5.5 | $1.165 | 347,798 / 46,947 | 28 | — | 590 | 59 | 6 | 3 |
| 吉田町 22424 | Sonnet 5.5 | $0.326 | 70,830 / 18,442 | 1 | — | 168 | 42 | 7 | 1 |
| 横浜市 14100 | Sonnet 5.5 | $0.583 | 241,367 / 10,068 | 0 | — | 67 | 0 | 13 | 0 |
| 柏崎市 15205 | Sonnet 5.5 | $0.541 | 73,485 / 39,390 | 0 | — | 331 | 305 | 7 | 2 |

Haiku was 30× cheaper on 輪島市 but kept 19 of the ~110 listed facilities and restated table headers as hazards; Sonnet listed nearly every facility and recovered the tsunami heights (8.3 m, 16.6 m) from the glyph-dropping map through Vision, so Sonnet is the Reader model. 横浜市's guidebook has no shelter list (shelters come from GSI). Every conflict is a real mismatch kept off the screens: 2012 map names no longer in GSI, 旧 prefixes in the 2026 city list, and a GSI typo (ＷＡＪＩＭＡ ＭＥＭＯＲＩＡＬ GIM for GYM).

### What the real data caught

**A text layer that silently drops characters.** The 輪島市 tsunami hazard map has a text layer, but its CID fonts lack a ToUnicode map, so extraction loses glyphs (「最大津波 16.6m」 becomes 「最 津波 16.6m」, 「石川県」 becomes 「川県」). Character counts and script ratios both pass it, and the same symptom decodes fine in other PDFs, so the check marks such files `suspect` and stops; a person clears a file after a spot check, or `--allow-vision` reads the page images with `{method: "vision", cited_text: null}` provenance.

**A Level 5 special warning that lost its level.** The 2026-10-21 20:15 and 21:15 子吉川 bulletins list 由利本荘市 under 浸水想定地区（氾濫発生情報）, keyed by the breach point rather than a water-level station, so the city got no level and the Composer would have shown nothing during a Level 5 warning. Breach areas now take the forecast area's level, a fixture of the nine real bulletins guards it, and wherever a level still cannot be derived the Composer stops with that reason instead of treating the city as below the threshold.

**An all-clear for something never shown.** The first fan-out over the recorded feed produced nine all-clear screens out of 22 for advisories that had never been displayed (for example a Level 2 heavy-rain advisory lifted on 10-16). The Composer is stateless per bulletin, so the replay keeps, per hazard, whether a screen is showing, and an all-clear appears only after one was.

**A pictogram that said something else than the text.** The Vision Verifier (`--verifier vision`: Sonnet looks at each rendered shape with the bulletin beside it) found 25 action pictograms that contradicted the screen in its first pass over 由利本荘市 and 輪島市 (go_higher on an all-clear, directions_run on a level 3 warning), all Composer defects. After that fix, a second pass found three where the text and pictogram still disagreed (「浸水に警戒」 under a rain cloud, 「川の増水に注意」 under the "safe here" shield): the Composer picked the pictogram while the Writer wrote the text without knowing it. The action pictogram now shows only the action (all-clear → safe_here, tsunami and level 5 → go_higher, otherwise directions_run), the Writer is given its meaning, and an action-cell mismatch goes back to the Writer. The Writer then borrowed 高齢者等避難, the name of an order only a municipality issues, so a lint keeps those names out of the action. Nineteen runs (2026-11-02 to 11-05) cost $11.34 in Vision checks; findings of the first five are kept in `data/verifier-findings/`, the run-by-run table is in `docs/evaluation.md`.

The recorded feed also held status words absent from the official samples (警報から注意報, 危険警報から注意報); the parser stopped on them, and only the two words that actually occur were added.
