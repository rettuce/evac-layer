# Ambient layer

What a screen shows while there is no alert: a generative scene on a canvas, with a clock and the site name on top.

## How a frame is decided

- `pickAmbient(siteKey, epochMs, pinnedSceneId?)` hashes `siteKey` and the hour slot `floor(epochMs / 3600 s)`. The hash picks the scene, the overlay corner (D21 variants A–D: top-left, top-right, bottom-left, bottom-right) and the scene seed. Adjacent hours never repeat a scene while more than one is registered: two scenes alternate, three or more come in per-site shuffled rounds (stateless; see `sceneIndex`).
- `scene.render(ctx, t, seed, shape)` is a pure function of its arguments. `t` is the clock time in ms (virtual or real), so the same `t` draws the same picture. Scenes never read `Date.now()` or `Math.random()`.
- The site key is `seed=` on `/screen` (default: the layout name) and, in live mode, the `site` query or else the municipality code.
- `/screen?…&scene=<id>` pins a scene (demo recordings). Unknown ids fall back to the hourly pick. The corner still follows `t`, so a recording that must not change picks a fixed `t` range as well.
- The root element carries `data-scene`, `data-corner` and `data-slot`.

## Overlay (after wgl ss design D21)

Values are in 720-short-side units and scaled by `min(width, height) / 720`, as in ss.

| | value |
|---|---|
| outer margin | 48 |
| track / gutter / pitch | 192 / 24 / 216 |
| block | 2 tracks (408), anchored to one corner on the outer margin |
| site name | 24 / 32 |
| time (HH:MM, JST) | 144 / 144, tabular figures |
| sweep | a 48-long segment travels the rule under the time once a minute |

The overlay is drawn on the scene's canvas (`drawOverlay`, after `scene.render`), not as DOM on top, so the frame has a single composited layer: with a DOM overlay the clock digits' edges differed by 1/255 between runs (2 of 9 captures), drawn on the canvas 9 of 9 are identical. Fonts are loaded explicitly before the first draw (`data-ready` waits for them). Under the site name every scene carries one fixed notice, `OUTAGE_NOTICE`: 停電時は館内放送・ラジオの指示に従ってください / In a power outage, follow staff announcements and radio (a signage screen goes dark in a blackout, so the ambient layer says where to turn before it happens). Japanese then English, at 0.22 of the clock size in the clock's ink, wrapped and balanced within the area the block sits in (the front face on a pillar); never blinks. Vertical hairlines mark the track edges, counted from the side the block is anchored to. Ink-edge snapping (ss `inkAlign`) is not implemented, so the time's glyph edge sits a few px inside the margin.

## Scenes

| id | name | reference | what changed |
|---|---|---|---|
| `color-planes` | 色面 | the colour-plane study (direction 2, `app/shots/ambient.html`) | 3–7 soft radial planes (count by shape) on a pale ground, low saturation, each drifting on its own 90–150 s period; Canvas 2D only, so no blur filter |
| `clock-grid` | 時計と幾何 | direction 1 of the ambient study (`app/shots/ambient.html`, after wgl ss D21) | a dark-ink ground with the D21 modular grid drawn in paper-coloured rules across the whole canvas (one picture round a pillar); the hourly seed picks a design number (track subdivisions 1–3, module row height) and the emphasised cells; those cells breathe on a 60 s cosine (no blinking). Draws its own grid, so the clock overlay skips its rules (`drawsGrid`) |

To add a scene: write `scenes/<name>.ts` exporting an `AmbientScene` (`id`, `name`, `ink: 'dark' | 'light'` for the overlay colour, `render`), add it to `AMBIENT_SCENES` in `registry.ts`, and add a row here with the reference and what was changed from it.
