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

## What the rendered screen reports

The root `.evac-screen` element carries `data-shape`, `data-template`, `data-variant`, `data-level`, `data-ready="1"` once fonts are loaded and the fit loop has finished, `data-dropped="<cell id>:<reason>,..."` (reasons: `no-slot`, `duplicate-role`, `overflow`), `data-overflow` (cells, or `screen`, that still overflow after every optional cell was dropped) and `data-missing-required`. Each cell carries `data-cell-id`, `data-role`, `data-priority` and `data-motion`.

## Templates

| Template | Required on 16x9 / 9x16 / 32x9 | Required on 1x1 |
|---|---|---|
| `evac-now` | headline, action, direction, shelter (not on 32x9), languages, source | headline, action, direction, source |
| `evac-prepare` | headline, action, shelter, languages, source | headline, action, shelter, source |
| `secure-now` | headline, action, languages, source (no shelter or direction slot) | headline, action, source |
| `all-clear` | headline, action, languages, source | headline, action, source |
| `shelter-direction` | not defined yet (`TemplateNotDefinedError`) | |

## `/screen` URL parameters

| Parameter | Meaning |
|---|---|
| `shape` | `16x9` \| `9x16` \| `32x9` \| `1x1` (falls back to the viewport aspect) |
| `layout` | fixture name in `app/fixtures/` (default `wajima-tsunami`) |
| `src` | dev only: same-origin path (starting with `/`) of a layout JSON to render instead of a fixture; anything else shows `data-error="src-rejected"`. In dev, `/api/layout?file=<absolute path>` serves `.json` files inside the repository (403 for anything else, 404 outside dev) |
| `variant` | layout variant index for the template and shape (default 0) |
| `clock=virtual&t=<ms>` | render the state at `t` only; `window.evacClock.set(ms)` steps time and resolves after the frame is committed |
| `mode=scenario&scenario=switch&t_switch=<ms>[&t_clear=<ms>]` | ambient, then 300 ms black, then the alert; optional 1 s crossfade back |
| `mode=scenario&scenario=ambient[&seed=…&site_name=…]` | ambient layer only |
| `mode=live&municipality=<code>[&speed=600&reset&clock=virtual&t=…&site_name=…]` | replay the municipality's bulletins in compressed time and show the pre-generated layout for the current one (`data/layouts/<code>/index.json` + `<bulletin>/<shape>.json`); all screens polling the same municipality and speed switch together. Root `[data-mode="live"]` carries `data-ready`, `data-live-index`, `data-bulletin`, `data-showing`, `data-missing-layout` |
