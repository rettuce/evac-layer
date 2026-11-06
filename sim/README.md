# sim — web simulator of the concourse

The concourse of `demo/blender/build_scene.py`, in the browser: the room is baked once in Blender
and drawn unlit; the 22 display faces (4 pillars × 4 faces, 3 ribbon panels, 3 wall panels) are WebGL planes.
平常時 is one pre-rendered loop per scene (`<video>` → `VideoTexture`) shared by all 22 faces, each face showing its
fixed UV crop of the room canvas, with the app's clock overlay drawn on a transparent canvas plane in front;
EVAC LAYER swaps per-face PNG stills of the alert layout every 2.5 s (`DESIGN.md`). The simulator needs no
server besides static files: the loops, the stills, `room.glb` and `crops.json`.

## Run

```sh
# standalone package: not in the pnpm workspace
cd sim && pnpm install --ignore-workspace
pnpm fetch-ambient              # the loops into public/ambient/ (GitHub Release ambient-loops-v1; needs `gh auth`)
pnpm dev                        # http://127.0.0.1:3160
pnpm build                      # type-check + sim/dist/
# VITE_AMBIENT_BASE (.env) overrides where the loops are read from (default `${BASE_URL}ambient/`)
# ?video=8k selects the 8k HEVC loops where they play (default: 4k, since each 8k scene is ~60 MB over Pages)
# keys: ←/→ step the ambient scene, E toggles a random alert set (public/alert/sets.json, stills at
# public/alert/<set>/<face>/<pair>.png; the place variants are left out), D hides every overlay
# ?dev shows the render modes (Textured / AO / Wire) and `copy pose`, which visitors do not need
```

Measured 2026-11-06 (M-series Mac, Chrome, 1848×1388, DPR 1, drawing capped at 60 fps on a 121 Hz screen):
`hero` with EVAC LAYER on all 22 faces runs at 53–57 fps whether the timeline plays or not, frame interval
median 16.7 ms, 0.2 ms of script per frame. The first 4k loop is ready about 6.5 s after the page opens on
localhost; a switch blacks the faces for 300 ms and shows the stills, and a place set that has not been shown
yet is fetched then (about 0.3 s on localhost). `sim/DESIGN.md` has the history, from the iframe faces this replaced.

A card explains the idea on the first visit (remembered in localStorage). Top left: content `平常時` /
`EVAC LAYER` (plays the timeline from level 3); ambient scene for `平常時` (brush-flow / etched-streams /
ink-bloom / painterly-flow / quad-subdivision); camera presets (`hero`, `hero2`, `wall`, `rib`, `col`; a 1.2 s
ease-in-out-cubic flight that dragging cancels). Top right: what the faces show now, with the level colour,
the warning in Japanese and English, the place, the issue time and the shelter, direction and distance.
Bottom right: the place panel and the timeline. The timeline replays 由利本荘市 on 2026-10-21 in 30 s
(平常時 6 s, then level 3 at 15:55, level 4 at 18:15, level 5 at 19:45, 8 s each, looping); the segments jump,
and a selector switches to 柏崎市 (level 4) or the 吉田町 tsunami drill. The place panel switches the level-4
bulletin between four display sites in 由利本荘市 on a small map (© OpenStreetMap contributors): all 22 faces
change together, and so do the shelter, its direction and its distance. `sim/scripts/site-alerts.mjs` writes
those stills, the map and `public/sites/sites.json`. Bottom left: fps, the key hint and a link to the repository.
On a phone the panels fold behind a `panel` button and the timeline takes the bottom.

## Regenerate the model

```sh
blender -b -P sim/blender/export_glb.py            # ~4 min on an M-series GPU (Metal)
blender -b -P sim/blender/export_glb.py -- --size 1024 --floor-size 2048 --ao-samples 32
```

Writes `sim/public/room.glb` (baked colour embedded; display faces and cameras carry `extras`; the front wall
behind the hero camera is left out so the view can orbit from outside),
`sim/public/tex/<group>_ao.jpg` and `sim/public/crops.json`. The script loads `build_scene.py` without
modifying it, so a change to the room geometry or the cameras there is picked up by re-running this. If only
the canvas crops / seam changed, `blender -b -P demo/blender/build_scene.py -- --crops-json sim/public/crops.json`
is enough: the viewer reads crops from that file first.

Polyhaven textures (CC0) are fetched by `demo/blender/polyhaven.py` into `demo/assets/textures/` on first run.

## GitHub Pages (https://rettuce.github.io/evac-layer/)

`.github/workflows/pages.yml` builds the simulator with `VITE_BASE=/evac-layer/` and the app with
`nuxt generate` (`NUXT_APP_BASE_URL=/evac-layer/app/`, `NUXT_PUBLIC_STATIC_SCREEN=1`), puts the app under
`app/` of the site and deploys with `actions/deploy-pages`. On that site `/screen` has no server: it reads
`app/public/static/` (one JSON per replay window and per approved layout, written by
`node sim/scripts/static-screen.mjs` against a dev server and committed), the replay starts at page load,
and approvals / admin are read-only (the EVAC LAYER content shows the bulletins approved at generation).
To check the same thing locally: assemble `sim/dist` + `app/.output/public` as `evac-layer/` and `evac-layer/app/`
under one folder and serve it with `python3 -m http.server`.

## Dependencies

| package | license |
|---|---|
| three 0.187 | MIT |
| animejs 4.5 | MIT |
| vite 8 / typescript 5 / @types/three (dev) | MIT / Apache-2.0 / MIT |

Room textures: Poly Haven `marble_01`, `ash_veneer` (CC0). Fonts: Noto Sans and Noto Sans JP (SIL OFL) from Google Fonts.
