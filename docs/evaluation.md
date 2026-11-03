# Evaluation

Numbers from the pipeline runs of 2026-11-02 over the recorded JMA feed (2026-10-11 to 11-02) for five municipalities. Every figure below comes from files in this repository or from the fan-out console output of that run; where a figure was not recorded, the table says **not measured** instead of estimating it.

## Screens produced

| Municipality | Recorded bulletins | Screens | Layouts (× 5 shapes) | Why no more screens |
|---|---|---|---|---|
| 由利本荘市 05210 | 62 | 6 | 30 | level 2 or lower, or an all-clear for something never shown (`data/layouts/05210/index.json`) |
| 輪島市 17204 | 39 | 7 | 35 | same (`data/layouts/17204/index.json`) |
| 柏崎市 15205 | 74 | 3 | 15 | same (`data/layouts/15205/index.json`) |
| 吉田町 22424 | 20 | 0 | 0 | highest level in the period was 2 |
| 横浜市 14100 | 5 | 0 | 0 | no warning in force for the city |

All 16 screens pass the static, browser and Vision checks on all five shapes (16:9, 9:16, 32:9, 1:1, pillar).

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

Every finding in runs 1 and 2 was a real defect: the Composer or the renderer was changed, and the next run no longer reported it (the `fix` field in each findings file). The overflows in runs 3 and 4 were the renderer's header bar; once it was fixed, run 5 passed every screen on the first attempt without calling the Writer.

## Vision false positives

| | Count | Evidence |
|---|---|---|
| Vision findings (runs 1–10) | 35 | 25 + 8 + 1 + 1; the overflows in runs 3 and 4 came from the browser check, not Vision |
| Confirmed defects | 33 | runs 1 and 2 (`fix` filled in `data/verifier-findings/2026-11-02-vision-run{1,2}.json`) |
| Clear false positive | 1 | run 9, 輪島市 10-21 19:42 all-clear: the finding's own text says the headline "matches" and "does not contradict" the bulletin, yet it is filed as bulletin-mismatch (`data/reports/17204-VPWW55-202610211942-7720a18f5cfa/report.json`) |
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
| Vision, per check (one shape of one screen) | $0.0111 | $5.476 over 494 checks, runs 1–11 |
| Writer, per bulletin, one call | $0.167–$0.170 | 柏崎市, three bulletins, Opus 5.5 (`data/writer/15205/`) |
| New screen, steady state (Writer once + Vision on 5 shapes) | $0.222 | 柏崎市 run: Writer $0.506 + Vision $0.160 over 3 screens |
| Development total so far | about $11.62 | Reader $2.881 + Writer about $3.26 + Vision $5.476 |
| Development total per screen shown | about $0.72 | over the 16 screens, including every re-run while the defects above were fixed |

The Writer total ($0.83 before the Vision work, then $1.273, $0.054, $0.596 and $0.506) comes from the fan-out output and the agents seat log. Per-call Writer usage is kept only for the latest generation of each bulletin (`data/writer/`, $1.527 now), so the earlier part is not verifiable from the repository alone.
