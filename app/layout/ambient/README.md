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
| `brush-flow` | 筆の流れ | wgl painterly-flow (principle only, new code) | thick oil strokes (28–56 design px wide, 7 × 16 px long, one per 60 px cell) following a value-noise flow field that drifts over 5 min; each stroke is a body colour with a lighter crest, and together they cover the paper like a painting (2026-11-04: the first round's thousands of thin pale strokes read as a texture, not a painting) |
| `ink-bloom` | 滲みの網点 | wgl bloom-field | a slowly morphing field printed as blue and coral halftone dots; flat red/blue areas become pale dots that shrink at the edges |
| `etched-streams` | 細線の流れ | wgl streamline-etch | streamlines of a stream function with two vortices as thin etched lines (never crossing) and one small red ring at a vortex; no periodic draw-on/draw-off, the vortices only orbit over 15 min. White lines on a near-black ground (`ink: 'light'`, inverted 2026-11-04) |
| `half-discs` | 半円の構成 | wgl semicircle-collage | tinted squares each carrying a half disc, quarter disc, disc or small square that turns once in 4–8 min; red and black turned into pale terracotta and grey |
| `quad-subdivision` | 分割 | wgl recursive-subdivision | squares split into four where a field is high, drawn as hairlines with a breathing dot in each cell; dark ground turned into paper |
| `module-field` | モジュール場 | wgl module-field | a grid of eight geometric modules with registration crosses and a few red cells; modules grow and shrink slowly instead of switching off and on (which would read as blinking) |

To add a scene: write `scenes/<name>.ts` exporting an `AmbientScene` (`id`, `name`, `ink: 'dark' | 'light'` for the overlay colour, `render`), add it to `AMBIENT_SCENES` in `registry.ts`, and add a row here with the reference and what was changed from it.
