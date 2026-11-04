# sim — web simulator of the concourse

The concourse of `demo/blender/build_scene.py`, in the browser: the room is baked once in Blender
and drawn unlit; the 22 display faces (4 pillars × 4 faces, 3 ribbon panels, 3 wall panels) are WebGL planes.
平常時 is one pre-rendered loop per scene (`<video>` → `VideoTexture`) shared by all 22 faces, each face showing its
fixed UV crop of the room canvas, with the app's clock overlay drawn on a transparent canvas plane in front;
EVAC LAYER swaps per-face PNG stills of the alert layout every 2.5 s. Clicking a face opens its live `/screen`
in a new tab (`DESIGN.md`).

## Run

```sh
# 1. the simulator (standalone package: not in the pnpm workspace)
cd sim && pnpm install --ignore-workspace
pnpm fetch-ambient              # the loops into public/ambient/ (GitHub Release ambient-loops-v1; needs `gh auth`)
cp .env.example .env            # VITE_SCREEN_ORIGIN=http://127.0.0.1:3153
pnpm dev                        # http://127.0.0.1:3160
pnpm build                      # type-check + sim/dist/
# VITE_AMBIENT_BASE overrides where the loops are read from (default `${BASE_URL}ambient/`)
# ?video=4k|8k forces the loop tier (default: 8k where HEVC Main 8K plays, else 4k)

# 2. only for opening a face's live /screen by clicking it: the app (any free port; 3150–3152 are used by
#    other worktrees), then once per app checkout approve the flood bulletins the EVAC LAYER content replays
#    (live screens only show approved bulletins; data/approvals.json is gitignored)
cd app && pnpm dev --port 3153
sim/scripts/approve-live.sh http://127.0.0.1:3153
```

Measured 2026-11-04 (M-series Mac, Chrome, 1920×1080, DPR 1): `Textured` with EVAC LAYER on all 22 faces
60–65 fps at `hero`, 100–120 fps at `wide-a` / `wall-final`; the first 10–15 s after a content switch run
at ~10 fps while the 22 pages load. `sim/DESIGN.md` has what made the difference.

UI (top left): content `平常時` / `EVAC LAYER` (由利本荘市, the 2026-10-21 flood replayed at real speed from
just before the level-4 bulletin); ambient scene for `平常時` (six of the app's scenes); render `Textured` (baked colour × AO) / `AO` (white × AO) / `Wire` (edges
on black, displays only); camera presets (every still camera of `build_scene.py`, 1.2 s ease-in-out-cubic
flight; dragging during a flight cancels it). Bottom right: fps.

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
