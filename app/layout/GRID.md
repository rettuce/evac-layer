# Alert layout grid (v1 proposal, 2026-11-04)

The alert screens sit on the same modular grid as the ambient overlay (wgl ss design D21), so the switch from ambient to alert keeps the page skeleton: outer margin, track edges and the block anchored to a corner stay where they were. Everything below is written in **design units**: the short side of a panel is 720 units, as in ss (`unit = min(width, height) / 720`; on a 1080 px short side one unit is 1.5 px). A pillar face is 720 units wide as well (`unit = 1654 / 720 = 2.297 px`), so its type is 1.53× a panel's, close to the 1.6× the faces used before.

Review set: `app/shots/layout-review/proposal.html` (built by `build-proposal.mjs` in that folder; `G` toggles the grid, `K` the cap/baseline marks; `?shape=16x9&px=1.5` renders one shape at panel size).

## 1. Tokens (shared with D21)

| token | units | note |
|---|---|---|
| unit `u` | 8 | every grid line is a multiple of 8 |
| outer margin `M` | 48 | all four sides; the source folio and the languages band keep it inside their bands |
| gutter `g` | 24 | between modules and between the parts of one block |
| module `s` | 48 | the small module; a track is three modules and two gutters |
| track `T` | 192 | D21 track; pitch `T + g = 216` |
| block gap | ≥ 48 | between information blocks (2× the gutter), so blocks read as separate areas |
| group gap | the long side's remainder | tracks are counted from both ends of the long side (D21 corners A/B); what does not fit a track becomes one wide gutter between the two groups (16:9: 80, 32:9: 64) |

Short side: `48 + 3 × 192 + 2 × 24 + 48 = 720`, three tracks, nine modules. The long side never divides by the pitch (1280 and 2560 are 5.6 and 11.5 pitches), which is why the tracks are anchored from both ends instead of being stretched.

## 2. Type scale

Letter height follows the signage rule of 1 inch per 10 ft (`1/120` of the viewing distance), measured as **cap height** and snapped to a multiple of 8. Cap height, not font size, is the unit, because the cap line and the baseline are what sit on the grid; the font size follows from the font's cap ratio (Noto Sans JP 0.741 and Noto Sans 0.714 as measured in Chrome; the ratio is read at run time, never hard-coded). Kanji rise about 0.15 em above the cap line; that overshoot is kept inside the line box (line heights are multiples of 8 and at least the cap + 16) and is never clipped.

| cap (units) | font (JP) | reads from | used for |
|---|---|---|---|
| 16 | 21.6 | 1.8 m | labels and the source on panels read at arm's length |
| 24 | 32.4 | 2.7 m | easy-Japanese line on 1:1, labels on 32:9 |
| 32 | 43.2 | 3.7 m | level label (16:9), language lines |
| 40 | 54.0 | 4.6 m | headline (stacked bands), shelter name, distance, direction text (1:1) |
| 48 | 64.8 | 5.5 m | headline (16:9), direction text, language lines (32:9) |
| 56 | 75.6 | 6.4 m | shelter name and distance (32:9) |
| 64 | 86.4 | 7.3 m | action (1:1) |
| 72 | 97.2 | 8.2 m | action (16:9, 9:16, pillar), headline and direction (32:9) |
| 96 | 129.6 | 11.0 m | action (32:9) |

`reads from = cap / 8.76 m` (720 units on a 55" panel: 0.951 mm per unit). Kanji bodies are 1.2× the cap, so Japanese reads from 1.2× the distance in the table. Line heights: cap 72 → 96 (88 where the stack is tight), 64 → 88, 56 → 72, 48 → 64, 40 → 56, 32 → 48, 24 → 32, 16 → 24/32.

Per shape (cap heights):

| step | 16:9 (3–8 m) | 9:16 (2–5 m) | 1:1 (2–5 m) | 32:9 (8–15 m) | pillar (2–5 m, 1.53×) |
|---|---|---|---|---|---|
| headline | 48 (1 line; 40 ×2 lines when longer) | 40 (≤ 2 lines) | 40 (≤ 2 lines) | 72 (≤ 3 lines) | 40 (≤ 2 lines) |
| action | 72 | 72 | 64 | 96 | 72 |
| direction text | 48 | 48 | 40 | 72 | 48 |
| shelter name / distance | 40 / 40 | 40 / 40 | — | 56 / 56 | 40 / 40 |
| languages | 32 | 32 | 24 (ja_easy in the action cell) | 48 | 32 |
| labels / source | 16 / 16 | 16 / 16 | 16 / 16 | 24 / 24 | 16 / 24 |

The level label is 32 on 16:9 (right end of the band, baseline shared with the headline), 24 under the headline on the stacked bands, 32 at the foot of the 32:9 square.

## 3. Alignment rules (what the audit measures)

1. Text: the cap line of the first line and the baseline of every line are on 8-unit lines (cap heights are multiples of 8, line heights too). The ink of the first glyph sits on the block's left line (side bearing measured and removed, as ss `inkAlign`). Nothing is trimmed with `text-box`; the kanji overshoot lives in the line box.
2. Pictograms: the box's four edges are on 8-unit lines; the drawn ink is moved onto the box's left and bottom edge (viewBox margin and rotation measured, as now).
3. Numbers (distance): right-aligned on the group's right line, tabular figures.
4. Bands: four edges on 8-unit lines; the headline band bleeds to the top and sides, the languages band to the bottom and sides, the pillar foot band to the floor.
5. Blocks: the first row of every block (text cap line or pictogram top) in one grid row shares one line; the left ink of every element in a block is on one vertical line; blocks are 48 or more apart, parts inside a block 24 (label to text 16 where the label is a caption).
6. Required cells, `data-*` attributes, the language rotation and the capture time are unchanged from the contract.

## 4. Shapes

Coordinates are `x, y` of the top-left corner, `w × h` of boxes, and the cap line `y` for text. Columns are the D21 tracks: `C1 48 · C2 264 · C3 480` (and, from the right on 16:9, `R1 824 · R2 1040`).

### 16:9 — 1280 × 720 (3–8 m)

```
0    48   240 264  456 480  672 752 824 1016 1040 1232 1280
├────┼─────┼──┼────┼──┼────┼──╳──┼───┼────┼───┼────┼────┤
│ headline band ·················································· │ 0–144
│ action (one line, cap 72) ······································ │ cap 192
│ run 192 │ ↙ 192 │ 南西へ │ gap │ shelter name / kind / 570 m │ 312–528
│ languages band (label 48 · text 264) ········ source → 1232     │ 552–720
```

- Band `0–144`: hazard pictogram 144 at (48, 0); headline cap 48 at x 264, cap 48 (two-line headlines: cap 40, lines at 16 and 72); level label cap 32 right-aligned at 1232, baseline 96.
- Action: one line, cap 72, x 48, width 1184, cap line 192 (12 ja characters = 1176).
- Row 2 `312–528` (one pitch): action pictogram 192 at (48, 312); arrow 192 at (264, 312) with the direction text cap 48 at x 480, cap 384 (centred on the arrow); shelter at x 752–1232 (two tracks and one module; the 80 group gap at 672–752 is the long side's remainder).
- Shelter block: name cap 40 at 312 (≤ 2 lines, 8 characters per line); 24 below the name's last baseline: site pictogram 40, 指定緊急避難場所 cap 16 and the distance cap 40 right-aligned on one baseline; `Emergency evacuation site` cap 16 on the next line.
- Languages band `552–720`: label column 48–240 (cap 16), text from 264 (cap 32), rows at cap 576 and 640; source cap 16 right-aligned at 1232 on the second row's baseline (the second-row language is at most 740 wide, the source 440).

### 9:16 — 720 × 1280 (2–5 m)

```
 0–192   headline band: pictogram 192 at (48,0) · headline cap 40 ×2 at x 264 (32, 88) · level cap 24 right, 144
 240     action cap 72, two lines (240, 328)
 440     action pictogram 160 at (48, 440)
 648     やさしい にほんご cap 16 → text cap 32 at 680 · EN cap 16 at 744 → text cap 32 at 776
 856     arrow 144 at (48, 856) · 南西へ cap 48 at x 264, cap 904
1048     shelter name cap 40 (≤ 2 lines) · 1112: pictogram 40, 指定緊急避難場所 16, 570 m cap 40 right · 1144: Emergency evacuation site 16
1248     source cap 16 (folio in the bottom margin)
```

The block order is read top to bottom: what → do (text, other languages, pictogram) → which way → where → when. Vertical tracks (192 at 48, 264, 480, 824, 1040) are drawn for reference; the rows are set by the blocks on the 8-unit grid.

### 1:1 — 720 × 720 (2–5 m)

```
 0–192   band as 9:16
 240     action cap 64, two lines (240, 328) · ja_easy cap 24 at 424 (no languages cell on 1:1)
 496     action pictogram 144 at (48, 496) · arrow 144 at (264, 496) · 南西へ cap 40 at x 480, cap 548
 680     source cap 16
```

evac-prepare (shelter required instead of direction): the action is one line (ja budget 6), so the row at 424 holds ja_easy and the row from 496 holds the shelter block at x 264 (name cap 40, then pictogram/label/distance rows). 4:5 adds the shelter block under the direction row (see §5).

### 32:9 — 2560 × 720 (8–15 m)

```
0        720 768  960 984 1176 1200 1392 1416 1608 1672 1864 1888 2080 2104 2296 2320 2512 2560
├─square─┼───┼────┼──┼────┼───┼────┼───┼────╳────┼────┼───┼────┼───┼────┼───┼────┼────┤
│ hazard │ action cap 96, two lines (48, 168)      │gap│ ↙ 168 · 南西へ 72 (cap 96)   │
│ 240    │ run 192 at (768, 288)                   │64 │ 鶴舞小学校 56 (264) · 570 m right │
│ head.  │                                         │   │ site 48 · labels 24 (344, 376)    │
│ 72 ×≤3 ├─────────────────────────────────────────┴───┴───────────────────────────────┤
│ level  │ languages band 528–720: label 768 (cap 24) · text 1200 (cap 48) at 552, 624  │
│ source │                                                                               │
```

- Square band `0–720 × 0–720`: pictogram 240 at (48, 48); headline cap 72 from cap 312, up to three lines (line pitch 96, 6 characters per line); level label cap 32 at 600; source cap 24 at 648 (white on the level colour).
- Body: left group 4 tracks (768–1608), right group 4 tracks (1672–2512), gap 64.
- Shelter (inline form, wide columns only): name cap 56 at 264, width 506 (≤ 2 lines), distance cap 56 right-aligned on the first baseline; then site pictogram 48 and the two designation lines at cap 24.

### Pillar — face 720 × 2197 units, four identical faces (2–5 m)

```
   0–192   band as 9:16 (floor 3.60–3.32 m)
 288–696   action pictogram 408 (two tracks; 3.18–2.59 m)
   824     action cap 72 ×2 (824, 920) — eye height, 2.40 m
  1056     やさしい にほんご 16 → 1088 text 32 · 1152 EN → 1184 text 32
  1248     arrow 144 · 南西へ 48 (1296)
  1440     shelter name 40 · 1504 pictogram 40 / 指定緊急避難場所 16 / 570 m 40 · 1536 Emergency evacuation site 16  (ends 1.27 m)
 1960–2197 foot band in the level colour (0.75–0.40 m): source cap 24 at 2040
```

The 16-unit rounded corner on each side of a face lies inside the 48 margin. The band and the foot band run round all four faces; everything between repeats on each face (contract 18:36).

## 5. Any aspect (15-aspect sweep)

The unit stays `min(w, h) / 720`, so type and pictograms keep their size on a given panel height; the long side is re-tiled, not stretched:

- **Landscape family (16:9, 1.25 ≤ a < 2.8)**: tracks from both ends; the left group keeps three tracks (pictogram, arrow, direction), the right group grows by one track for every full 216 of extra width (21:9 → shelter 3 tracks + module), and what is left widens the group gap (2:1 → gap 240). Narrower than 16:9 (3:2, 4:3, 5:4 = 1080–900 wide) the two groups and the languages band cannot all hold their required cells at full size; those three aspects scale the 16:9 page by `width / 1280` (0.84, 0.75, 0.70), as today.
- **Ribbon family (32:9, a ≥ 2.8)**: the square band stays 720; the body takes `floor((L − 792) / 216)` tracks, split evenly (32:9 → 4 + 4, 3:1 → 3 + 3 with the action at cap 72 and the shelter in the row form at cap 48).
- **Portrait family (9:16, a ≤ 0.75)**: the stack is fixed; the action pictogram takes the leftover height (1:2 → 320, 9:16 → 160, 10:16 → 88). 3:4 (960 tall) cannot hold the six required cells and scales the 9:16 page by `height / 1280` (0.75).
- **Square family (1:1, 0.75 < a < 1.25)**: 4:5 (900 tall) adds the optional shelter block under the direction row (180 extra = 48 gap + 120 block + margin).

Open point for the commander: the three narrow landscapes and 3:4 fall back to scaling because the contract's required cells do not fit at the 720 unit; the alternative is to let those aspects drop a type step (action 72 → 56) and the two-line action, which changes the type scale by aspect.

## 6. Templates

- `evac-now` / `evac-prepare`: as drawn (`evac-prepare` requires the shelter and not the direction; on 1:1 the shelter replaces the direction block).
- `secure-now` (Lv5): no direction and no shelter; the row 2 / "where" group is empty, so the action pictogram takes the whole left group (16:9: 408 at (48, 312) is not possible in 216 of height, so the pictogram stays 192 and the row is otherwise empty; 9:16 / pillar: the pictogram grows into the freed rows: 9:16 → 400).
- `all-clear`: Lv1 white band with the 4-unit rule, no level label, no direction/shelter; the same rules as `secure-now` with the `safe_here` pictogram.

## 7. Sources

- wgl ss D21 (`wgl.ie3.jp/src-nuxt/components/three/ssdesigns/designs/D21.vue`): 720-unit grid, margin 48, track 192, gutter 24, ink-edge snapping (`inkAlign`).
- `app/layout/ambient/README.md` "Overlay (after wgl ss design D21)".
- Viewing distance rule: `app/layout/typography.ts` (`LETTER_HEIGHT_PER_VIEW_DISTANCE`), kept; measured as cap height from here on.
- Müller-Brockmann, *Grid Systems in Graphic Design* (1981): modular grid, baseline grid, left-aligned ragged text, numbers as the large element.

## 8. 9:16 as implemented (2026-11-04, 田中's Figma artboard · L-2)

The 9:16 screen is no longer the §4 proposal; it reproduces the artboard (`H213MoFcJtIZ96s6qdmBZ8` node 3212:5, 1080 × 1920) and the four other shapes will follow its hierarchy. Values are px on the 1080 × 1920 canvas (`templates.ts` `PORTRAIT`, `screen.css` `.shape-portrait .is-figma`).

- Column: x 48 to 1043 (right margin 37). Every pictogram is placed by its **ink** (`PictogramMark fitInk`: the box is the drawn ink, measured from the rasterised SVG, rotation included), every text by its box at x 48 / 184 / 196 / 248 / 340 as on the artboard.
- Band 0–200: hazard ink 124 at (34, 38); headline 76 / 1.1 at (184, 26), one line (a longer name steps to 0.85); level label 66 right-aligned at 1043, top 111.
- Stack (grid rows, px): band 200 · 26 · action (text 150 / 1.1, then 54, then the action ink 333) · 62 · direction (arrow ink 109 with 15 above, text 120 at x 196) · 86 · shelter (site ink 162; text column 248: designation 30 #555, name 90 / 1.1 and the distance 90 right-aligned on one row, the figure 8 px below the name's baseline) · 101 · languages (label 30 #555 in a 292 column, text 66 / 1.18, pairs 35 apart) · the rest · source 30 · 29.
- Fit steps, in order: a name that wraps at 90 is set at 72 (`data-shelter-scale="narrow"`); a stack that still overflows sets the languages at 56 (`data-languages-scale="narrow"`); then the contract's headline step and overflow reporting. The five language pairs reserve the tallest pair, so a frame fits at every `t`.
- Checked: 22 bulletins × (9:16, 10:16, 1:2, 3:4) pass `scripts/grid-audit.mjs --app` (0 NG) with the thresholds recalibrated on the artboard: ja line-height ≥ 1.1 em, ink gap ≥ 8 px, pictogram ink inside its cell, action ink ≥ 288 / hazard ≥ 120 / aux ≥ 100 px, cap ≥ 21 px (action ≥ 100, headline ≥ 47). 由利本荘 Lv4 matches the artboard screenshot within 4 px on all 16 elements (`app/shots/layout-review/diff916.mjs`).

## 9. The four other shapes as implemented (2026-11-05, 田中's Figma artboards · L-4)

Each shape reproduces its artboard in file `H213MoFcJtIZ96s6qdmBZ8` the way 9:16 does (§8): grid tracks are the artboard's px, pictograms are placed by ink (`fitInk`), type sizes are set per element (`templates.ts` `type`), and the tracks stay put when a role is absent (`fixedTracks`). Element ink matches the artboard screenshot within 4 px on every measured element (`app/shots/layout-review/diff.mjs <shape>`).

- **16:9** (node 3223:4, 1920 × 1080, `figma-split`): columns 52 · 720 · 1fr · 897 · 52; rows 172 · 24 · 27 · 255 · 90 · 167 · 49 · 1fr · 170 · 20 · 29 · 31. Band: hazard ink 98 at (48, 38), headline 64 at (195, 46), level 64 right-aligned at 1868. Action 120 / 1.25 in the 720 column, the run ink 225 under it (gap 52). Direction (arrow ink 129, text 122) and shelter (site ink 157, kind 32, name 79, distance 92) right-aligned in the 897 column; the shelter owns the rows down to the languages so a two-line name fits. Languages 54 with 24 labels in a 256 column, pairs 31 apart; source 24 right-aligned.
- **32:9** (node 3223:80, 3840 × 1080, `figma-ribbon`): columns 780 · 107 · 1369 · 1fr · 769 · 92; rows 40 · 83 · 185 · 53 · 24 · 30 · 275 · 39 · 1fr · 294. The level colour fills the 780 panel: hazard ink 310 at (79, 91), two-line headline 96 / 1.25 at (60, 480) (`headlineLines: 2`), level 96 at (60, 800). Source 30 on top of the white field, action 150 one line, run ink 344, direction (arrow ink 166, text 170) from x 2979, shelter (site ink 253, kind 32, name 140, distance 150) from x 2256, both ending at x 3748. Languages 90 side by side (1456 columns) on the black band with 30 labels in #bebebe above the text.
- **1:1** (node 3230:4, 1080 × 1080, `figma-square`): columns 48 · 1fr · 7 · 41; rows 200 · 27 · 580 · 33 · 130 · 1fr · 34 · 31. Band: hazard ink 112 at (40, 45), headline 76 at (184, 22), level 66 right-aligned at 1032. Action 150 / 1.1 two lines, the run ink 193 with the easy-Japanese line 64 bottom-aligned to it (`easyInAction`); direction (arrow ink 109, text 120) under them; source 28 right-aligned at 1039. The artboard has no shelter block and no language band, so those cells get no slot.
- **Pillar** (node 3230:68, four faces of 1654 × 5046 in strip px, `figma-face`, `PILLAR.faceScale` 1): columns 80 · 273 · 842 · 377 · 82; rows 320 · 307 · 1132 · 417 · 442 · 216 · 406 · 256 · 275 · 121 · 383 · 1fr · 546. Band 320: hazard ink 186 at (95, 59), headline 90 at (336, 37), level 90 right-aligned at 1582. The run pictogram's ink 842 × 1132 at (353, 627) is the hero; action 190 / 1.15 two lines in 1160; languages 88 with 40 labels centred on their lines (the easy-Japanese line breaks after あぶない as on the artboard); the 32:9 shelter group; direction arrow ink 261 at (130, 4014) with the text 270; the foot band from 4500 carries the source 70 in white at (80, 4740). The artboard's faces 2–4 sit 3 px left of a 1654 pitch; the app uses the pitch.
- Long facility names on every shape but 9:16 (whose artboard rule is §8): the name is set at 80 % first, then takes two lines, then ends in an ellipsis (`-webkit-line-clamp: 2`); the distance and the direction never move, and the direction is never an overflow victim (`fit.ts`). `app/test/shelter-name.test.ts` renders a twenty-character name on all five shapes.
