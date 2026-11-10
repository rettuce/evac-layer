---
name: evac-verify
description: Read Verifier results (data/reports, data/layouts/<id>/index.json, data/verifier-findings) and decide where a finding goes back to — the Writer, the Composer, or the renderer. Use when a screen fails, when a report or finding needs explaining, or before changing the revision loop.
---

# evac-verify

## The three layers

| Layer | What it checks | Where it runs |
|---|---|---|
| static | `schema/layout.schema.json` (required cells per shape, motion, pictogram ids), repeated distance | `agents/src/loop/static-verifier.ts` |
| browser | the renderer's DOM state on `.evac-screen` (`data-overflow`, `data-dropped`, `data-missing-required`), type size per role against the viewing-distance sizes, flicker (≥ 10 % luminance reversals within 1 s) | `agents/src/verifier/browser.ts`, puppeteer against `/screen?shape=<shape>&src=…` |
| vision | Sonnet looks at each rendered shape beside the bulletin: `bulletin-mismatch`, `pictogram-misuse`, `missing-source`; "can it be understood in 3 seconds" is kept as a note, not a finding | `agents/src/verifier/vision.ts` |

The pillar repeats one screen on four faces: the state is read from the outer `.evac-screen`, cells and type only inside `[data-face="0"]`, and Vision sees face 0 only. A face has the pixel density of the 55-inch 9:16 panel, so the 9:16 type sizes apply unscaled.

## Where a finding goes

- Back to the **Writer** (it rewrites its cells, at most twice for the same finding): `over-budget`, `font-size`, `distance-duplicated`, `bulletin-mismatch` on headline / action / direction / languages; `overflow` in a language the Writer writes (`ja_easy`, `en`, `zh_hans`, `zh_hant`, `ko`); `pictogram-misuse` on the action cell (the pictogram is fixed by the template and its meaning was given to the Writer, so the text must follow).
- **Stop** (the loop cannot fix it): `overflow` tagged `ja`, `pictogram` or `screen` → `render-overflow` (Japanese headlines and code-written text are the Composer's budget or the renderer's slot); anything on the shelter or source cells (the Composer writes them from data); `missing-required`; `flicker`; `pictogram-misuse` on any other cell; `direction-mismatch` (a north-up arrow whose angle is not the one its word names, read from the layout by static and from the drawn arrow by browser) and `north-missing` (N or 北 not shown on the dial's circle) go to the Composer or the renderer.
- A stopped or failed screen gets `screen: false` and its reason in `index.json`. Never publish it by hand.

## Reading the files

- `data/reports/<id>-<bulletin>/report.json`: every attempt with its Writer source (`writer-cache`, `writer-api:opus`), findings and, for Vision, a note per shape.
- `data/verifier-findings/<date>-vision-run<n>.json`: one entry per shape per finding, with `fix` once fixed, and run stats (screens, pass, checks, cost).
- Vision sometimes files a finding whose own text says the screen matches the bulletin (輪島市 10-21 19:42). Record it as a false positive; do not loosen the check.
