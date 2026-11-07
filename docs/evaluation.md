# Evaluation

Numbers from the pipeline runs of 2026-11-02 to 11-05 over the recorded JMA feed (2026-10-11 to 11-02) for five municipalities. Every figure below comes from files in this repository or from the fan-out console output of that run; where a figure was not recorded, the table says **not measured** instead of estimating it.

## Screens produced

| Municipality | Recorded bulletins | Screens | Layouts (× 5 shapes) | Why no more screens |
|---|---|---|---|---|
| 由利本荘市 05210 | 62 | 6 | 30 | level 2 or lower, or an all-clear for something never shown (`data/layouts/05210-demo-honjo-station/index.json`) |
| 輪島市 17204 | 42 (39 recorded + 3 official JMA samples) | 10 (3 tsunami from the samples) | 50 | same (`data/layouts/17204-demo/index.json`) |
| 柏崎市 15205 | 74 | 3 | 15 | same (`data/layouts/15205-demo/index.json`) |
| 吉田町 22424 | 23 (20 recorded + 3 official JMA samples) | 3 (大津波警報 ×2 and its all-clear, all from the samples) | 15 | highest recorded level was 2 |
| 横浜市 14100 | 5 | 0 | 0 | no warning in force for the city |

All 22 screens pass the static, browser and Vision checks on all five shapes (16:9, 9:16, 32:9, 1:1, pillar).

## Verifier findings per run

A finding is one check failing on one shape of one screen, on the first attempt. Runs 1 to 5 are in `data/verifier-findings/`. Runs 6 to 10 left no findings file; their counts come from the fan-out output, and for runs 9 and 10 also from `data/reports/`.

| Run | Scope | Screens | Shapes | Findings | Kinds | What changed before the run |
|---|---|---|---|---|---|---|
| 1 | 05210, 17204 | 12 | 4 | 25 | pictogram-misuse 21, bulletin-mismatch 4 | first Vision pass |
| 2 | 05210, 17204 | 13 | 4 | 8 | pictogram-misuse 5, bulletin-mismatch 3 | pictograms by template, all-clear headlines (6c757d6) |
| 3 | 05210, 17204 | 14 | 4 | 4 | overflow 4 (browser check) | action pictogram shows the action; its meaning goes to the Writer (50d5843) |
| 4 | 05210, 17204 | 14 | 4 | 4 | overflow 4 (browser check) | no municipal order names in the action (8dedf81) |
| 5 | 17204 | 7 | 4 | 0 | — | renderer header bar fix, overflow tagged by language |
| 6 | 05210 | 6 | 5 (pillar static only) | 0 | — | pillar added to the Composer |
| 7 | 17204 | 7 | 5 (pillar static only) | 0 | — | same |
| 8 | 05210, 17204 | 13 | 5 | 1 | bulletin-mismatch 1 | pillar checked in the browser and by Vision |
| 9 | 05210, 17204 | 13 | 5 | 1 | bulletin-mismatch 1 | no Japanese script in English text (0cacb31) |
| 10 | 15205 | 3 | 5 | 0 | — | 柏崎市 added |
| 11 | 15205 | 3 | 5 | 0 | — | 柏崎 demo site moved off the evacuation site it sat on (nearest was 0 m) |
| 12 | 05210, 17204, 15205 | 16 | 5 | 0 | — | ten languages (th, vi, fil, id added); every bulletin rewritten by the Writer from scratch, one rewrite for a ja_easy headline over budget |
| 13 | 17204 | 10 | 5 | 0 | — | the official JMA sample bulletins VTSE41 of 2016-09-01 (a drill series in which 石川県能登 is under 津波注意報, then cleared) added to 輪島's replay via `data/samples/17204.json`, unmodified: three tsunami screens. A first attempt failed 3 times on one of them because Vision was shown every forecast region of the country instead of the municipality's own; fixed in `vision.ts` (about 20 checks, $0.24, not counted in the totals) |
| 14 | 17204 | 10 | 5 | 0 | — | drill bulletins marked in every language's headline (【訓練】 / DRILL: …) with a new static check `drill-marker`; 輪島 demo site moved off the GSI facility it sat on (nearest site was 0 m, now 230 m). The first pass failed one all-clear screen 3 times because Vision had been told to expect the marker on every cell, while the contract puts it on the headline only; the instruction was corrected and the second pass was 10/10 (both passes counted: 115 checks) |
| 15 | 17204 | 10 | 5 | 0 | — | the drill word reaches the language band: `drill-marker` now covers `action` / `languages` in every language but ja. The three cached drill screens were sent back to the Writer once each (18 findings per shape) and passed on the rewrite; the seven recorded-feed screens were unchanged |
| 16 | 22424, 17204 | 12 | 5 | 0 | — | 吉田町 replays the same drill series (静岡県 under 大津波警報): two display-level-4 screens; the drill word now opens the text in every language and the all-clear keeps "safe now"; 輪島's three drill screens rewritten to the rule; JMA's English warning names given to the Writer. Two passes (the first reused the cached 輪島 text, which already satisfied the position check), 125 checks in all |
| 17 | 22424 | 3 | 5 | 0 | — | a region downgraded from a warning to 津波予報（若干の海面変動） now gets an all-clear with a sea-level caution instead of leaving the warning screen up (found through the samples, see FINDINGS); 吉田町's 09:55 bulletin became its third screen on the first attempt |
| 18 | 22424 | 3 | 5 | 0 | — | the caution all-clear's action pictogram is safe_here again (the action pictogram shows the action only; the hazard is the headline's); Writer text reused from cache |
| 19 | 15205 | 3 | 5 | 0 | — | prompt caching: breakpoints after the Writer's system prompt and municipality block and after the Vision Verifier's system prompt; 柏崎 regenerated twice to measure (Writer rewritten once, Vision twice) |
| 20 | 05210 | 5 | 5 | 5 | missing-source (1:1) | renderer rebuilt on the author's artboards and the Verifier floor lowered to the artboard sizes (16:9 action 120, languages 54 / label 24, source 24; 1:1 languages 56); level 5 keeps shelter and direction. Every 1:1 failed because the figma-square template has no source line, so the 06:20 all-clear had nothing to clear |
| 21 | 05210 | 6 | 5 (1:1 static only) | 0 | — | same renderer, `--skip-browser-shapes 1x1` until the 1:1 source line exists; 6/6 pass, Vision $0.26 (24 checks) |
| 22 | 05210 | 5 | 5 | 5 | font-size (1:1 source) | the 1:1 template gained its source line at the artboard's 24 px (layout 835f36e / 4351a29), below the 28 px fine floor; the 06:20 all-clear again had nothing to clear |
| 23 | 05210 | 6 | 5 | 0 | — | the 1:1 source floor follows the artboard (24 px); 6/6 pass with Vision on every shape, 213 s, Vision $0.33 (30 checks) |

Every finding in runs 1 and 2 was a real defect: the Composer or the renderer was changed, and the next run no longer reported it (the `fix` field in each findings file). The overflows in runs 3 and 4 were the renderer's header bar; once it was fixed, run 5 passed every screen on the first attempt without calling the Writer.

## Vision false positives

| | Count | Evidence |
|---|---|---|
| Vision findings (runs 1–10) | 35 | 25 + 8 + 1 + 1; the overflows in runs 3 and 4 came from the browser check, not Vision |
| Confirmed defects | 33 | runs 1 and 2 (`fix` filled in `data/verifier-findings/2026-11-02-vision-run{1,2}.json`) |
| Clear false positive | 1 | run 9, 輪島市 10-21 19:42 all-clear: the finding's own text says the headline "matches" and "does not contradict" the bulletin, yet it is filed as bulletin-mismatch (`data/reports/17204-demo/VPWW55-202610211942-7720a18f5cfa/report.json`) |
| Disputed | 1 | run 8, same screen: "避難は不要です" was called an assertion the bulletin does not make, while the bulletin's own text still warns of rising rivers. A reasonable reading, but the next run did not repeat it |

False-positive rate: 1 of 35 findings (2.9 %), or 2 of 35 (5.7 %) when the disputed one is counted; 1 to 2 of 479 Vision checks. In both cases the loop sent the screen back to the Writer once and passed it on the second attempt, and the same finding is sent at most twice, so a false positive costs one rewrite and cannot loop.

## Writer lint

| | Value | Source |
|---|---|---|
| Current Writer outputs | 17 (16 bulletins with a screen, plus 輪島市 10-25 15:40, an all-clear that is no longer reachable) | `data/writer/*/*.json` |
| First drafts that broke a lint and were rewritten once | 5 of 17 (29 %) | all five are 由利本荘市 headlines regenerated right after the English-script lint was introduced; the rule they broke was not recorded |
| Breaking a lint after the rewrite | 0 of 17 | `lint: []` in every record; the loop stops instead of publishing text that still breaks a rule |
| First live runs (輪島市 4 drafts, then 由利本荘市 and 輪島市 13 drafts, before the later lints existed) | 0 lint findings | agents seat log (private) |
| First-draft lint rate of the generations in between | **not measured** | those drafts were overwritten when the bulletins were regenerated |

## Reader cost per municipality

From `agents/README.md` (Reader runs, 2026-11-02):

| Municipality | Model | Cost | Claims | Vision pages |
|---|---|---|---|---|
| 輪島市 17204 | Sonnet 5.5 | $0.257 | 146 | 1 |
| 輪島市 17204 (comparison) | Haiku 5.5 | $0.009 | 35 | 1 |
| 由利本荘市 05210 | Sonnet 5.5 | $1.165 | 590 | 28 |
| 吉田町 22424 | Sonnet 5.5 | $0.326 | 168 | 1 |
| 横浜市 14100 | Sonnet 5.5 | $0.583 | 67 | 0 |
| 柏崎市 15205 | Sonnet 5.5 | $0.541 | 331 | 0 |
| Total | | $2.881 | | |

## Cost per screen

| | Value | How |
|---|---|---|
| Vision, per check (one shape of one screen) | $0.0111 | $11.341 over 989 checks, runs 1–19 |
| Writer, per bulletin, one call, ten languages | $0.05–$0.20 | run 12, 16 bulletins, Opus 5.5 (`data/writer/`, $1.462 in all), before prompt caching |
| Writer, per bulletin, with the municipality block cached | $0.06 (first call of a municipality and hazard $0.23) | run 19, 柏崎: 35,675 of 36,376 prompt tokens read from cache on the 2nd and 3rd call; three calls $0.353 against $0.576 uncached (−39 %; −68 % per call at steady state) |
| Vision, per check, with the system prompt cached | $0.0087 | run 19: 1,510 of 5,082 prompt tokens per check read from cache (30 %); the screen images are new every time. 15 checks $0.130 against $0.157–$0.160 before (−17 %) |
| New screen, steady state (Writer once + Vision on 5 shapes) | $0.245 | 柏崎市 in run 12: Writer $0.576 + Vision $0.159 over 3 screens (six languages: $0.222) |
| Development total so far (runs 1–19) | about $21.30 | Reader $2.881 + Writer about $7.08 + Vision $11.341. Runs 20–23 are not in this total: Vision $0.26 in run 21 and $0.33 in run 23; runs 20 and 22 not measured |
| Development total per screen shown | about $0.97 | over the 22 screens, including every re-run while the defects above were fixed |

The Writer total ($0.83 before the Vision work, then $1.273, $0.054, $0.596, $0.506, $1.462 for the ten-language regeneration $0.577 for the three sample tsunami bulletins $0.219 for their drill-marked headlines $0.272 for the drill word in their language band $0.835 for 吉田町's 大津波警報 screens and the prefix rule $0.095 for its all-clear and $0.353 for the caching measurement) comes from the fan-out output and the agents seat log. Per-call Writer usage is kept only for the latest generation of each bulletin (`data/writer/`, $1.462 now), so the earlier part is not verifiable from the repository alone.

## Why these five municipalities

The five cover different hazards and different settings. One data condition applied to all of them: the GSI list of designated emergency evacuation sites had to be downloadable for the municipality (it was for all seven candidates). 由利本荘市 (05210) is a river flood on the 子吉川, and the only municipality whose recorded feed holds a real escalation through levels 3, 4 and 5 (2026-10-21). 輪島市 (17204) stands for the Noto earthquake, with landslide bulletins and the official JMA tsunami sample series. 柏崎市 (15205) is a landslide case near a station. 吉田町 (22424) is a tsunami case on the Pacific coast, where the official drill bulletins (大津波警報・訓練) reach the top of the scale. 横浜市 (14100) is the urban case: under a memorandum with private operators, the city already shows disaster screens on 142 signage sites around 横浜駅, the closest existing practice to what EVAC LAYER adds.

## What a nationwide roll-out would cost in API calls

A rough extrapolation from the figures above; it assumes the same models and prompts, and it counts API calls only (no screens, lines or staff).

| Item | Basis | Estimate |
|---|---|---|
| Reader, once per municipality | $0.26–$1.17 per municipality over the five (page count of the municipal documents) | about 1,740 municipalities × $0.3–1.2 ≈ **$500–2,000, once** |
| Rendered screens per municipality per year | 200 recorded bulletins for 5 municipalities in 23 days (2026-10-11 to 11-02), 16 of them warning-level and thus rendered (the 6 tsunami screens from the official sample series are left out) → about 51 rendered screens per municipality per year | — |
| Writer + Vision per rendered screen | $0.245 steady state (Writer once, Vision on 5 shapes) | **about $13 per municipality per year** |
| All municipalities, one site each | 1,740 × $13 | **about $22,000 per year** |
| Each additional site in a municipality | the Writer output is cached per municipality and hazard, so an extra site pays for Vision only: $0.053 per screen (5 shapes) × 51 | **about $3 per extra site per year**; 10,000 sites nationwide ≈ $22,000 + 8,260 × $3 ≈ **$47,000 per year** |

Caveats: the recording window sits in typhoon season, so the annualised bulletin count is on the high side; prompt caching and the Batch API (half price) would roughly halve the figures.
