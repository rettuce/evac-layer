# app/layout — public surface

`app/layout/` is plain TypeScript with no Vue or browser dependency, so the renderer (`app/`), the Composer and the Verifier (`agents/`) read the same rules.

## Exports other packages may use

Anything not listed here is internal and may change shape without notice. The signature of `resolveTemplate` is stable; a change goes through the coordinator first.

| Export | File | Contract |
|---|---|---|
| `resolveTemplate(templateId, shape): ResolvedTemplate` | `templates.ts` | `{ required: Role[]; slots: Role[]; variant?: string }`. `slots` = roles that have a place on this shape; `required` = roles that must be present (a subset of `slots`). Both arrays are in a fixed role order, so the result is JSON-comparable. Throws `TemplateNotDefinedError` when the template has no layout for the shape |
| `ResolvedTemplate`, `TemplateNotDefinedError` | `templates.ts` | as above |
| `definedTemplates(): TemplateId[]` | `templates.ts` | template ids that have layouts, sorted |
| `Shape`, `ShapeClass`, `TemplateId`, `Role`, `LangKey`, `Motion`, `AlertLevel`, `LocalizedText`, `LayoutCell`, `EvacScreen`, `ScreenSource`, `DroppedCell`, `DropReason` | `types.ts` | mirror `schema/layout.schema.json`; the schema wins on conflict |
| `SHAPES`, `isShape`, `shapeForViewport` | `shapes.ts` | native pixel size and class of each shape |
| `CABINET_OFFICE_5`, `LEVEL_LABEL_JA`, `contrastRatio`, `relativeLuminance`, `inkOn` | `palette.ts` | level colors (Cabinet Office 2020) and the WCAG contrast math the renderer uses for band text |
| `TYPE_PX`, `LANGUAGE_ROTATION`, `LANGUAGE_ROTATION_MS` | `typography.ts` | the three type steps and the language rotation order and period |
| `PULSE_PERIOD_MS`, `SCALE_IN_MS` | `motion.ts` | motion timing the Verifier can check frames against |
| `liveLayoutGate(approvals, site, municipality, bulletinId)`, `layoutKey`, `Approvals`, `LiveLayoutGate` | `gate.ts` | the approval gate used by `/api/live-layout`: `'ok'` only for an approved bulletin at a site with auto publish on, otherwise `'auto-publish-off'` or `'unapproved'` (the 403 `data.reason`). `Approvals` is the shape of `data/approvals.json` |
| `pickAmbient(siteKey, epochMs, sceneId?)`, `AMBIENT_SCENES`, `AmbientScene`, `overlayGeometry` | `ambient/index.ts` | the ambient layer: hourly deterministic pick of scene, D21 overlay corner and seed; scenes are pure `render(ctx, t, seed, shape)`. See `ambient/README.md` |

## What the rendered screen reports

The root `.evac-screen` element carries `data-shape`, `data-template`, `data-variant`, `data-level`, `data-ready="1"` once fonts are loaded and the fit loop has finished, `data-dropped="<cell id>:<reason>,..."` (reasons: `no-slot`, `duplicate-role`, `overflow`), `data-overflow="<cell id>:<lang>,..."` (what still overflows after every optional cell was dropped; `lang` is the text key that spilled — `ja` for the headline and other code-written text, `ja_easy` / `en` / `zh_hans` / `zh_hant` / `ko` for Writer text, `pictogram` when only the pictogram box spills; `screen` when the page itself overflows), `data-headline-scale="0.85"` when a 9:16 or 1:1 headline was stepped down and `data-missing-required`. Each cell carries `data-cell-id`, `data-role`, `data-priority` and `data-motion`.

## Templates

| Template | Required on 16x9 / 9x16 / 32x9 | Required on 1x1 |
|---|---|---|
| `evac-now` | headline, action, direction, shelter (not on 32x9), languages, source | headline, action, direction, source |
| `evac-prepare` | headline, action, shelter, languages, source | headline, action, shelter, source |
| `secure-now` | headline, action, languages, source (no shelter or direction slot) | headline, action, source |
| `all-clear` | headline, action, languages, source | headline, action, source |
| `shelter-direction` | not defined yet (`TemplateNotDefinedError`) | |

## `/screen` URL parameters

Common to every mode:

| Parameter | Meaning |
|---|---|
| `shape` | `16x9` \| `9x16` \| `32x9` \| `1x1`; falls back to the viewport aspect |
| `clock=virtual&t=<ms>` | render the state at `t` only (no wall clock, no rAF-driven motion). `window.evacClock.set(ms)` steps time without reloading and resolves once the frame is committed; `window.evacClock.now()` reads it back. Defined only in virtual mode |

### Alert screen (default mode)

| Parameter | Meaning |
|---|---|
| `layout=<name>` | fixture in `app/fixtures/` (default `wajima-tsunami`) |
| `src=<path>` | render a layout JSON fetched from a same-origin path instead of a fixture. Dev: any path starting with `/` (e.g. `/api/layout?file=<absolute path>` for a `.json` inside the repository). Production: only `/api/live-layout?…` and `/api/admin/preview-layout?…`. Rejected values show `[data-error="src-rejected"]`; fetch failures `[data-error="src-load-failed"]` |
| `variant=<n>` | layout variant for the template and shape (default 0; 32x9 `evac-now` has 1 = wide direction) |

Ready: `.evac-screen[data-ready="1"]`.

### Scenario (`mode=scenario`)

| Parameter | Meaning |
|---|---|
| `scenario=switch&t_switch=<ms>[&t_clear=<ms>]` | ambient until `t_switch`, 300 ms black, then the alert scales in; from `t_clear` a 1 s crossfade back to ambient |
| `scenario=ambient` | ambient layer only |
| `seed=<text>`, `site_name=<text>` | ambient site key for the hourly pick (default: layout name) and the site label (default: municipality name) |
| `scene=<id>` | pin the ambient scene (also in live mode); see `layout/ambient/README.md` |

The alert layer is mounted hidden from the start, so `.evac-screen[data-ready="1"]` is also the ready signal here.

### Live replay (`mode=live`)

| Parameter | Meaning |
|---|---|
| `municipality=<code>` | 5-digit code; reads `data/layouts/<code>/index.json` (or the agents replay fixture) |
| `speed=<n>` | replay time compression (default 600) |
| `from=<ISO>&to=<ISO>` | replay only bulletins issued in this window; elapsed 0 is the first bulletin inside it. The demo uses `from=2026-10-21T11:00+09:00&to=2026-10-22T07:00+09:00&speed=1200` (05210: 9 bulletins in 56 s) |
| `site=<id>` | site whose auto-publish switch gates the screen (default: `site` in index.json) |
| `reset` | restart the shared replay origin for this municipality and speed |
| `site_name=<text>` | ambient label (default: municipality name) |

Only bulletins that are approved and belong to a site with auto publish on are shown; others stay ambient. All screens polling the same municipality and speed switch together. Ready: `[data-mode="live"][data-ready="1"]`. State attributes on that root: `data-live-index`, `data-bulletin`, `data-showing`, `data-missing-layout` (no file), `data-unapproved` (gated), `data-unapproved-count`.

## Other pages

| URL | Meaning |
|---|---|
| `/admin` | municipality picker, bulletin list, four-shape previews, Verifier result, approval and per-site auto publish. Ready: `.admin[data-ready="1"]`; asks for the admin token when the server has one |
| `/dashboard[?clock=virtual&t=<ms>]` | totals over `data/` with a count-up. Ready: `.dashboard[data-ready="1"]` |

## Server API

| Route | Access | Meaning |
|---|---|---|
| `GET /api/replay?municipality&speed[&from][&to][&t][&reset]` | public | replay rows inside the window and the current index |
| `GET /api/live-layout?municipality&bulletin&shape[&site]` | public, gated | layout JSON only for an approved bulletin at an auto-publish site; 403 with `data.reason` = `auto-publish-off` \| `unapproved` |
| `GET /api/dashboard` | public | totals and per-municipality rows (every municipality with a knowledge file or layouts); NG found / fixed are counted from `data/verifier-findings/*.json` (one finding per entry, fixed when `fix` is filled) with the per-run counts and the file names |
| `GET /api/feed/<site_id>` | public, gated | the site's feed (`schema/feed.schema.json`); ETag / If-None-Match |
| `GET /delivery/<site>/<bulletin>/<shape>.{png,html,json}` | public, gated | exported files from `dist/` while the bulletin is deliverable |
| `POST /api/admin/subscriptions` | admin | register a webhook `{site_id, url, secret}`; see `app/README.md` Delivery |
| `GET /api/admin/catalog`, `GET /api/admin/preview-layout`, `POST /api/admin/approve`, `POST /api/admin/site` | admin | Bearer `NUXT_ADMIN_TOKEN` when set; otherwise local only (loopback address, local Host, not cross-site, JSON POST bodies). Writes go to `data/approvals.json` |
| `GET /api/layout?file=<absolute path>` | dev only | any `.json` inside the repository, for the Verifier; 404 in production |

## Headline band

- The band carries the warning level as text (警戒レベル4, `levelLabelFor`): beside the headline on 16:9, under it on 32:9.
- 9:16 and 1:1: the level label sits under the headline inside the band, right-aligned, with the headline pictogram spanning both rows. The band is at least 200 (one headline line + label); the headline may take 2 lines (the band grows further only then); if it still does not fit, its size steps down once to 0.85 × the derived size, and anything left is reported as overflow.
- When a `languages` cell is on screen, the action cell no longer repeats the easy-Japanese line under its pictogram (it appears once, labelled).
- `all-clear` shows no level label: a cleared bulletin has no warning level, the white band is only the colour of level 1.

## Pillar (`shape=pillar`)

- A square column wrapped in LED from 0.40 m to 3.60 m above the floor: logical canvas 6616 × 5046 = four faces of 1654 × 5046 side by side (face 0 is the front, then 1, 2, 3 to the right). The outer 37 px of each face lie on the rounded corner and carry no text.
- Each face uses the 9:16 template's cells, drawn at 1.6x (`PILLAR.faceScale`; the column is read from 2–5 m) and rearranged by `pillarFace`: band and a large action pictogram fill the upper column (2.2–3.6 m); action text (up to two lines), easy Japanese, direction and shelter end 1.0 m above the floor (rows bottom-anchored); a level-colour band with the source runs round the foot (0.40–0.75 m). The band runs edge to edge, so it closes into a ring round the column; text and pictograms repeat on every face.
- The outer `.evac-screen` carries `data-shape="pillar"`, `data-faces="4"` and the state of face 0 (`data-overflow`, `data-dropped`, …); it turns `data-ready="1"` when all four faces are fitted. Faces 1–3 are `aria-hidden`.
- Draw at logical pixels and capture at `deviceScaleFactor: 0.5` → 3308 × 2523 (`scripts/shot.mjs` does this).
- Layouts: the Composer writes `pillar.json` (same cells as 9:16); live, feed and `/delivery` serve it like the other shapes.
- Ambient is one picture round the column (alerts repeat per face so everyone sees the same information; the ambient layer should feel like one continuous space): the colour field and the D21 rules run across all 6616 px without seams, and the clock and site name appear once, on face 0 (the front) with their top at 2.0 m.
