# Ambient layer

What a screen shows while there is no alert: a generative scene on a canvas, with a clock and the site name on top.

## How a frame is decided

- `pickAmbient(siteKey, epochMs, pinnedSceneId?)` hashes `siteKey` and the hour slot `floor(epochMs / 3600 s)`. The hash picks the scene, the overlay corner (D21 variants A–D: top-left, top-right, bottom-left, bottom-right) and the scene seed. Adjacent hours never repeat a scene while more than one is registered: two scenes alternate, three or more come in per-site shuffled rounds (stateless; see `sceneIndex`).
- `scene.render(ctx, t, seed, shape, frame)` is a pure function of its arguments. `frame` is the whole canvas (`width`, `height`) and the part this screen shows (`view`); the context is already shifted so that canvas coordinates land in the view, so scenes transform relative to it (`save` / `translate` / `restore`, never `setTransform`) and may skip what lies outside the view. Scenes that tile the canvas take each tile's randomness from `cellRandom(seed, i, j)` rather than a running stream, so a part draws exactly as the whole. `t` is the clock time in ms (virtual or real), so the same `t` draws the same picture. Scenes never read `Date.now()` or `Math.random()`.
- The site key is `seed=` on `/screen` (default: the layout name) and, in live mode, the `site` query or else the municipality code.
- `/screen?…&scene=<id>` pins a scene (demo recordings). Unknown ids fall back to the hourly pick. The corner still follows `t`, so a recording that must not change picks a fixed `t` range as well.
- Two shapes override the hashed corner (2026-11-04): a pillar always carries its clock on the front face, top-left, 2.0 m above the floor (`PILLAR_CLOCK_CORNER`, `PILLAR_CLOCK_TOP_M`); on a 9:16 panel the block starts at 36 % of the height (`PORTRAIT_CLOCK_TOP`), so the digits sit a little above mid-height instead of in the top corner. Left or right still follows the hash on 9:16.
- The root element carries `data-scene`, `data-corner` and `data-slot`.

## One room, many screens

`/screen?…&canvas=<W>x<H>&crop=<x>,<y>,<w>,<h>` treats a whole room as one picture: `canvas` is the room's elevation in logical px (all walls side by side; a pillar is its four faces as one strip) and `crop` is this screen's rectangle in it. Every screen of the room draws the same scene with the same seed (`room:<W>x<H>:<canvas_id>`, not the site), so the pieces meet. The room is drawn in fixed 512 px tiles, each with the same transform and bounds whichever screen asks, and copied at whole-pixel offsets; two neighbouring crops match the whole room byte for byte (`test/room.test.ts`, all scenes). The crop is scaled to the screen's width, so give each screen a crop of its own aspect. A pillar window may add `seam=right`: the strip is then drawn face by face with its last quarter on the front, so the one discontinuity of the wrapped picture falls on the front-right edge instead of the front-left (the demo's right-hand columns, whose left face the hero camera sees; `demo/blender/build_scene.py --crops-json` writes which windows). The clock, site name and coordinates stay per screen, in the screen's own corner. `overlay=none` drops them (used by the test). Without `crop` nothing changes.

## Overlay (after wgl ss design D21)

Values are in 720-short-side units and scaled by `min(width, height) / 720`, as in ss.

| | value |
|---|---|
| outer margin | 48 |
| track / gutter / pitch | 192 / 24 / 216 |
| block | 2 tracks (408), anchored to one corner on the outer margin |
| site name | 24 / 32 |
| coordinates (`lat`, `lng` on `/screen`, from the site's site.json) | 0.8 of the site name, 4 decimals, e.g. 39.3863° N, 140.0563° E |
| time (HH:MM, JST) | 144 / 144, tabular figures |
| sweep | a 48-long segment travels the rule under the time once a minute |

The overlay is drawn on the scene's canvas (`drawOverlay`, after `scene.render`), not as DOM on top, so the frame has a single composited layer: with a DOM overlay the clock digits' edges differed by 1/255 between runs (2 of 9 captures), drawn on the canvas 9 of 9 are identical. Fonts are loaded explicitly before the first draw (`data-ready` waits for them). The time sits under the site name; the ambient layer carries nothing else from EVAC LAYER. Vertical hairlines mark the track edges, counted from the side the block is anchored to. Ink-edge snapping (ss `inkAlign`) is not implemented, so the time's glyph edge sits a few px inside the margin.

## Scenes

Palettes are written as the pale tints of the first round and every tint's saturation is multiplied by `SATURATION_GAIN` (1.8, `field.ts`, via `tint(h, s, l, alpha?)`); the whole-room stills at gain 1 read as washed out (2026-11-04).

| id | name | reference | what changed |
|---|---|---|---|
| `brush-flow` | 筆の流れ | rettuce.com/works/machinedrum/03.jpg and the radiant "Luminous Silt" sketch (principle only, new code) | luminous silt: thousands of short glowing strands carried by a curl-noise flow over a dark ground, each alive 2–5 s and respawned where it fades; WebGL (three, one instanced quad per trail piece), every path integrated from its spawn in the vertex shader so a frame depends on t alone (2026-11-05) |
| `ink-bloom` | 滲みの網点 | port of wgl.ie3.jp lab/bloom-field (2026-11-05) | the original's domain-warped fbm field, 24 s cycles with a 3.2 s cross-fade, two-colour risograph classification (blue halftone and plate, misregistered red plate, purple overlap) and three contour lines; the per-pixel classification runs at a third of the resolution and the frame-to-frame blend and paper grain are left out |
| `etched-streams` | 細線の流れ | wgl stream-hatch (provisional, 2026-11-05) | streamlines of a stream function with two vortices as thin etched lines (never crossing) and one small red ring at a vortex; as in the reference the vortices orbit in 30 s, their strength pulses ±40 % over 30 s and a new vortex set blends in over 2.5 s every 20 s. White lines on a near-black ground (`ink: 'light'`) |
| `quad-subdivision` | 分割 | port of wgl.ie3.jp lab/recursive-subdivision (2026-11-05) | the original's quadtree (8 base cells on the short side, churning fbm, two wandering focus points, curl drift, 5.4 s split / merge / settle cascade with a 150 ms stagger per layer, the unfolding every 8th cycle, the dot pop) on its near-black ground; the tree is walked per cell instead of per fragment and the cascade is a function of t |
| `module-field` | モジュール場 | port of wgl.ie3.jp lab/module-field (origin/main, 2026-11-05) | the original's fifteen modules, registration crosses, red cell, 2×2 hero of breathing dots (mask every 30 s), single-cell draw-off / draw-on, chains, zooms and the 15 s sweep; events and rules come from hashes of the period and the cell instead of a running random stream, and the paper grain is left out |
| `painterly-flow` | 厚塗りの流れ | port of wgl.ie3.jp lab/painterly-flow (origin/main, 2026-11-05) | broad strokes along a domain-warped simplex flow field in three layers (block-in, middle, fine) with striations and dry-brush ends, six palettes, 12 s of painting and 2 s of hold, the next palette painting over without wiping, and the display shader's linen weave. The sketch accumulates frame by frame; here a frame is rebuilt from the same stroke order (two finished cycles, then the current one up to its eased progress) with an accumulation buffer per view, so it depends on t alone and a room drawn in tiles matches one drawn whole. The first cycle from a white canvas is not shown (the loop never starts empty), and the simplex noise is a seeded copy instead of simplex-noise + alea |

To add a scene: write `scenes/<name>.ts` exporting an `AmbientScene` (`id`, `name`, `ink: 'dark' | 'light'` for the overlay colour, `render`), add it to `AMBIENT_SCENES` in `registry.ts`, and add a row here with the reference and what was changed from it.
