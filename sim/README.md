# sim — web simulator of the concourse

The look-C concourse from `demo/blender/build_scene.py`, in the browser: the room is baked once in Blender
and drawn unlit; the 22 display faces (4 pillars × 4 faces, 3 ribbon panels, 3 wall panels) are the app's
`/screen` page in iframes placed in 3D (`DESIGN.md`).

## Run

```sh
# 1. the app that serves /screen (any free port; 3150–3152 are used by other worktrees)
cd app && pnpm dev --port 3153

# 2. the simulator (standalone package: not in the pnpm workspace)
cd sim && pnpm install --ignore-workspace
cp .env.example .env            # VITE_SCREEN_ORIGIN=http://127.0.0.1:3153
pnpm dev                        # http://127.0.0.1:3160
pnpm build                      # type-check + sim/dist/
```

UI (top left): content `平常時` / `EVAC LAYER` (由利本荘市, the 2026-10-21 flood replayed at real speed from
just before the level-4 bulletin); render `Textured` (baked colour × AO) / `AO` (white × AO) / `Wire` (edges
on black, displays only); camera presets (every still camera of `build_scene.py`, 1.2 s ease-in-out-cubic
flight; dragging during a flight cancels it). Bottom right: fps.

## Regenerate the model

```sh
blender -b -P sim/blender/export_glb.py            # ~4 min on an M-series GPU (Metal)
blender -b -P sim/blender/export_glb.py -- --size 1024 --floor-size 2048 --ao-samples 32
```

Writes `sim/public/room.glb` (baked colour embedded; display faces and cameras carry `extras`),
`sim/public/tex/<group>_ao.jpg` and `sim/public/crops.json`. The script loads `build_scene.py` without
modifying it, so a change to the room geometry or the cameras there is picked up by re-running this. If only
the canvas crops / seam changed, `blender -b -P demo/blender/build_scene.py -- --crops-json sim/public/crops.json`
is enough: the viewer reads crops from that file first.

Polyhaven textures (CC0) are fetched by `demo/blender/polyhaven.py` into `demo/assets/textures/` on first run.

## Dependencies

| package | license |
|---|---|
| three 0.187 | MIT |
| animejs 4.5 | MIT |
| vite 8 / typescript 5 / @types/three (dev) | MIT / Apache-2.0 / MIT |

Room textures: Poly Haven `marble_01`, `ash_veneer` (CC0). Fonts come from the app's `/screen` page.
