# sim — design notes (v0, 2026-11-04)

The simulator shows the look-C concourse of `demo/blender/build_scene.py` in the browser, with every
display face driven live by the app's `/screen` page. Everything that is not a display is baked once
in Blender and drawn as an unlit texture; only the displays are rendered at runtime.

## How the displays get into the 3D view (prior art compared)

| | A. CSS3D iframe + depth hole (chosen) | B. DOM → `CanvasTexture` (html2canvas / `HTMLMesh`) | C. same-origin iframe canvas → `CanvasTexture` |
|---|---|---|---|
| reference | three.js `examples/css3d_mixed.html`, `css3d_youtube.html`; discourse 55722 (NoBlending "hole") | three.js `examples/jsm/interactive/HTMLMesh.js`; `jerrykingxyz/THREE.DOMTexture` (MIT, foreignObject SVG) | spec's alternative; three.js `CanvasTexture` |
| what runs the screen | the real `/screen` page in an `<iframe>`, untouched | a rasteriser re-implements CSS (subset) | the page's own `<canvas>` copied per frame |
| EVAC layout (DOM, fonts, pictograms) | exact | fonts/flex/grid partly unsupported; `HTMLMesh` is written for lil-gui | not available: EVAC is DOM, only ambient is a canvas |
| per-frame cost | compositor only (no upload); one iframe per face | rasterise + upload per face per change (0.38 ms/upload measured in 55722, ×22 faces) | one `drawImage`+upload per face |
| occlusion by room geometry | WebGL plane with `blending: NoBlending, opacity: 0` writes depth and clears colour → room in front hides the page, page shows through the hole | native (it is a texture) | native |
| lighting / reflection on screen | none (matches look C: emission only) | full | full |
| post-processing | the hole must be cut after post; we use none | fine | fine |
| known failure | 100 % browser zoom only; WebXR | fidelity | ambient only |

A is chosen because the EVAC layout must look exactly like the app and the budget is one week: the
page renders itself and the browser's compositor places it. B is dropped because the rasteriser
cannot reproduce the layout's fonts and grid, and because 22 faces would upload 22 textures per
change. C is kept in reserve for the ambient-only case (one room canvas, one texture); it cannot
show EVAC. If A falls under 30 fps at 22 faces the fallback is to drop the pillar faces to C for the
ambient mode only.

Decisions inside A:

- The glTF carries each display face as its own mesh (`screen_9x16_i`, `screen_32x9_i`,
  `led_wrap_i_face`) with `extras` (`screen`, `shape`, `canvas: [W, H]`, `crop: [x, y, w, h]`,
  `face_px: [w, h]`, `center`, `normal`, `size`). The WebGL mesh itself is the hole; the CSS3D plane is
  built from `center / normal / size` so a slightly curved LED wrap still occludes exactly.
- A pillar face is its own iframe of the column's `/screen?shape=pillar` page (one DOM element can sit in
  only one `CSS3DObject`), clipped by a div (`overflow: hidden`, iframe offset by `-face * 1654 px`) so the
  four faces show the four quarters of the same layout. 4 columns × 4 + 3 ribbon + 3 wall = 22 faces,
  22 iframes; the four iframes of a column run the same URL and the same clock.
- 1 CSS px = `size / face_px` metres (`CSS3DObject.scale`). The iframe is given the shape's design size
  (`w`/`h` query, pillar fixed at 6616×5046) so the layout draws at its native pixel grid; the compositor
  scales it.
- Two renderers, one camera, one `requestAnimationFrame`: WebGL canvas on top with `pointer-events: none`,
  CSS3D container below. OrbitControls listens on the top-level wrapper; iframes get
  `pointer-events: none` always (the viewer never clicks a screen).
- The page's background is black, so in `Wire` mode only the displays emit and the hole shows nothing else.

## Baking

`sim/blender/export_glb.py` runs `build_scene.py` through `runpy` with `--crops-json` (which returns
before rendering) to reuse its geometry, cameras and the elevation crops without changing it, then:

1. builds look C and the screens (`cut=off`),
2. joins the room into bake groups (shell pieces, columns + cladding, three louver sets, headwall + light
   strips + joints), Smart-UV-projects each group into one UV map,
3. bakes `DIFFUSE` (colour only) and `AO` with Cycles into one image per group and map
   (2048 px, floor 4096), saves them as JPEG (colour) and PNG (AO) under `sim/public/tex/`,
4. rebuilds each group's material as the baked colour image so the glTF exporter embeds it,
5. exports `sim/public/room.glb` (Y-up, cameras, extras). Camera targets and lens live in each
   camera's `extras` because glTF stores no look-at.

The AO image is referenced from the glTF only through `extras.ao` (file name) so the viewer can
switch between colour×AO, white×AO and wire without a second material set in the file.

## What the first run taught (2026-11-04)

- **22 iframes at page size: 6 fps.** The 16 pillar faces each ran a 6616×5046 page, and the ambient
  canvas is sized to the page × devicePixelRatio. Without the pillars: 97 fps; without any iframe: 120 fps.
  CSS `zoom` on a wrapper div lowers the devicePixelRatio the page sees, so the page rasters at the size it
  is drawn: pillars at zoom 0.25 → 94 fps. The zoom is now chosen per face every frame from its projected
  height (`updateZoom`: ladder 0.125 / 0.25 / 0.5 / 1, pillars capped at 0.5), and the `CSS3DObject`
  scale compensates. `zoom` goes on an inner div, not on the CSS3D element, because zoom also scales the
  transform's translation.
- **Black blocks and bands on the wall panels were z-fighting**, not a raster problem: the bezel plane
  (`joint_*`) sits 0.5 mm behind each display face, and from the hero distance (17 m) the depth buffer could
  not separate them. `polygonOffset -4/-4` on the hole material fixes it; a plain-page test of the same
  iframe at zoom 0.125–0.5 never showed the artifact, which is what ruled the compositor out.
- **EVAC LAYER showed the calm screen** until the flood bulletins were approved: live screens only show
  approved bulletins and `data/approvals.json` is gitignored. `sim/scripts/approve-live.sh` does what
  `demo/capture/record.mjs` does before a recording, through the loopback-only admin API.
- Camera flights: position and focal length sampled every 100 ms follow the ease-in-out curve over 1.2 s.

## S-2 (2026-11-04, 田中 FB)

- **Column corners showed a dark line.** Numbers: the LED wrap's face arc length is 1.0471 m (1.000 flat +
  2 × 0.0236 of arc), so the flat CSS3D plane ended 0.5236 m from the column centre while the corner edge is
  at 0.5310 m: a 7.4 mm notch per corner edge that no page covered, and the hole was the curved wrap itself,
  so the arc past the plane's end showed the black CSS3D background. Fix: each face is a flat quad 2 × 0.531 =
  1.062 m wide that meets its neighbours at the corner edge (content 1.4 % larger than on the arc), and the
  depth-only hole is now built from the same extras as the CSS3D plane (`PlaneGeometry`), so hole and page
  are the same rectangle on every display; the glb's display meshes are kept for their extras but hidden.
- The front wall (`wall_front`, behind the hero camera) is removed in the export so the viewer can orbit from
  outside. No display is mounted on it, so the crops and face list are unchanged.
- Calm content can switch between six ambient scenes (`scene=<id>` on every iframe); the buttons are
  disabled while EVAC LAYER is shown because the alert layout covers the scene.

## Not done / open

- Lights are not baked (no `COMBINED`): the view is unlit albedo × AO, which is what the spec's three
  modes need and keeps the bake deterministic and fast (whole bake 80 s on Metal: AO 64 spp, floor 4096).
- The four iframes of a column start their clocks when each page is ready, so the language band of the
  four faces can be offset by the load-time difference; the replay clock itself is shared by the server
  (`sharedReplayOrigin`), so the shown bulletin is the same on every face.
- `demo/blender/build_scene.py` is not modified. If D-7 changes crops or UVs, re-run the export.
