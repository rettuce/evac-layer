# Integrating EVAC LAYER with any signage system

EVAC LAYER turns an official JMA warning into approved emergency screens for five shapes (16:9, 9:16, 32:9, 1:1 and the four-faced pillar). Any signage CMS can take them in one of three ways. Every way delivers the same thing and follows the same rule: **only bulletins an operator approved, at sites with auto publish switched on**. Everything else stays ambient.

The payload is fixed by [`schema/feed.schema.json`](../schema/feed.schema.json): the site, `state` (`ambient` | `alert`), the alert (hazard, Cabinet Office level, template), one layout JSON per shape, PNG/HTML asset URLs, the sources (municipal PDF page, GSI data, JMA bulletin id) and `approved_at`.

## 0. What you need

- Node 22 and pnpm (`pnpm install` at the repository root).
- Chrome or Chromium for browser verification and export. Set `CHROME_PATH` if it is not at one of the usual macOS / Linux paths.
- An Anthropic API key (`ANTHROPIC_API_KEY`) for the Reader, the live Writer and Vision verification. The bundled demo data runs without one.
- Inputs that are not redistributed in this repository, under `EVAC_RAW_DIR`:
  - GSI designated emergency evacuation sites, `gsi-shelters/<id>_1.csv` and `<id>_2.csv` (https://hinanmap.gsi.go.jp/hinanjocp/defaultFtpData/csv/)
  - the municipality's hazard-map PDFs, as listed in its preset (from the municipality's website)
  - JMA disaster-prevention XML: a recording of the long feeds (https://www.data.jma.go.jp/developer/xml/feed/) under `JMA_FEED_DIR`, or bulletins from your own receiver

A command that needs a missing input stops with exit 1 and says what is missing and where to get it.

Settings are read from the environment, then from `.env` at the repository root (`.env.example` lists them):

| Variable | Default | Used for |
|---|---|---|
| `EVAC_DATA_DIR` | `<repo>/data` | sites, layouts, reports, municipalities, approvals, live state; shared by `agents` and `app` (`NUXT_DATA_DIR` is the app's alias) |
| `EVAC_RAW_DIR` | `<repo>/data/raw` (gitignored) | the GSI CSVs and municipal PDFs above |
| `JMA_FEED_DIR` | `<EVAC_RAW_DIR>/jma-feed` | recorded JMA bulletins as `bodies/<YYYYMMDD>/<id>.xml` |
| `EVAC_URL` | `http://127.0.0.1:3150` | the app, for browser verification and export |
| `CHROME_PATH` | first usual Chrome / Chromium path | headless Chrome |
| `NUXT_ADMIN_TOKEN` | unset | admin API access from anywhere but localhost (sent as `Authorization: Bearer <token>`); without it `/api/admin/*` answers loopback clients only |
| `HOST` / `PORT` | `127.0.0.1` / `3150` | where the production server (`node app/.output/server/index.mjs`) listens. `pnpm -F app dev` is fixed at `127.0.0.1:3150` |

## 1. Register a site

A site is one venue whose screens share the coordinates. It is one JSON file, `data/sites/<id>.json`, checked by [`schema/site.schema.json`](../schema/site.schema.json); the file name is the `id`:

```json
{
  "id": "my-station-concourse",
  "municipality_id": "05210",
  "lat": 39.38633978,
  "lng": 140.0563304,
  "facing_deg": 0,
  "name": "Station concourse, north wall"
}
```

- `municipality_id` (5-digit JIS code) is written by hand; it is not derived from the coordinates. It selects which bulletins apply and which municipality knowledge file is read.
- `facing_deg` is the compass direction the viewer faces when looking at the screen; the arrow to the evacuation site is rotated against it.
- From the coordinates the Composer picks the nearest GSI designated evacuation site that matches the hazard and writes its name, direction and distance into every layout for this site.
- A municipality may have any number of sites; each gets its own screens and approvals.
- Leave out `replay`. It makes a site play back a recording, for the demo only.

`pnpm -F agents validate data/sites/<id>.json` checks the file.

A municipality not yet in `data/municipalities/` needs a preset first, `data/municipalities/<id>.preset.json` ([`schema/municipality-preset.schema.json`](../schema/municipality-preset.schema.json): names, the PDF list and the GSI CSVs). Then:

```sh
pnpm -F agents shelters <id>                                   # GSI CSVs → data/municipalities/<id>.shelters.json
pnpm -F agents reader --municipality <id> --model sonnet       # hazard-map PDFs → data/municipalities/<id>.json, with citations
```

Tsunami bulletins are matched through `data/jma/tsunami-regions.json`, which covers the demo municipalities only; a municipality missing from it gets a warning when a tsunami bulletin is processed.

## 2. Generate and approve

Generate the screens once, in calm times, with the app running (`pnpm -F app dev`):

```sh
pnpm -F agents fanout --sites my-station-concourse --verifier vision --writer live
```

Every recorded bulletin for the site's municipality goes through write → compose → verify → revise, into `data/layouts/<site_id>/` with reports in `data/reports/<site_id>/`. `--verifier static|browser|vision` and `--writer placeholder|live` choose the depth; `--municipalities <ids>` means every site in those municipalities.

Open `/admin`, review the screens of each bulletin and approve them. An approval is per site and per bulletin (`<site_id>/<bulletin_id>`) and is bound to the layout files it was given for, so a bulletin whose screens were regenerated is held back until someone approves it again. Then switch automatic delivery on for the site:

```sh
curl -s -X POST http://127.0.0.1:3150/api/admin/site \
  -H 'Authorization: Bearer <admin token>' -H 'Content-Type: application/json' \
  -d '{"site_id":"my-station-concourse","auto_publish":true}'
```

Approval without a token works only from localhost (the `/admin` page does the same calls). Switching `auto_publish` off stops delivery from the next state change.

## 3. Drive the state

A site without `replay` is live. Its state is the bulletin it should show now, kept in `data/live/<site_id>.json`. Set it through the API (admin access) or the CLI, which write the same file:

```sh
curl -s -X POST http://127.0.0.1:3150/api/admin/live \
  -H 'Authorization: Bearer <admin token>' -H 'Content-Type: application/json' \
  -d '{"site_id":"my-station-concourse","bulletin_id":"<bulletin id>"}'      # "bulletin_id": null clears

pnpm -F agents live --site my-station-concourse --bulletin <bulletin id>     # or --clear
```

The bulletin is shown only when it is approved for the site and auto publish is on; otherwise the site stays ambient. A site with `replay` answers 409.

Call this from your own JMA receiver when a bulletin for the site arrives. Receiving JMA bulletins, and composing screens for a bulletin that was not in the recording, happen outside this repository.

## 4. Receive it

### Pull: poll a feed

Poll `GET /api/feed/<site_id>` every few seconds. It returns what the site should show now. Send the last `ETag` back as `If-None-Match`; an unchanged state answers `304` with no body, so polling is cheap. No authentication: the feed only ever contains approved, public information.

```sh
curl -s -H 'If-None-Match: "<etag from last time>"' http://127.0.0.1:3150/api/feed/my-station-concourse
```

When `state` is `alert`, show `assets["16x9"].png` (or the HTML, or render `layouts["16x9"]` yourself) full screen; when it returns to `ambient`, go back to your normal content. Use the shape that matches the panel.

### Push: receive a webhook

Register a URL once (admin access; the secret is at least 16 characters) and EVAC LAYER posts the feed body to it whenever the site's state changes:

```sh
curl -s -X POST http://127.0.0.1:3150/api/admin/subscriptions \
  -H 'Authorization: Bearer <admin token>' -H 'Content-Type: application/json' \
  -d '{"site_id":"my-station-concourse","url":"https://cms.example/hooks/evac","secret":"<shared secret>"}'
```

`GET /api/admin/subscriptions?site=<site_id>` lists the registrations without their secrets, and `DELETE /api/admin/subscriptions/<id>` removes one (204, or 404).

Each delivery carries four headers: `X-EvacLayer-Event: alert` or `clear`, `X-EvacLayer-Timestamp` (Unix seconds), `X-EvacLayer-Delivery` (a UUID per delivery) and `X-EvacLayer-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<delivery>.<event>.<raw body>")>`. Before acting, verify the signature, reject a timestamp older than 5 minutes and reject a delivery id you have already seen; otherwise a captured `clear` could be replayed to take down a live alert. Failed deliveries are retried five times (1, 2, 4, 8, 16 s) and a newer state cancels pending retries. Targets must be `http(s)`; URLs that resolve to loopback, private, link-local or other non-public ranges are refused (set `NUXT_WEBHOOK_ALLOW_PRIVATE=1` for a CMS on the same LAN), and redirects are not followed.

```js
// receiver (Node)
const expected = 'sha256=' + createHmac('sha256', secret)
  .update(`${req.headers['x-evaclayer-timestamp']}.${req.headers['x-evaclayer-delivery']}.${req.headers['x-evaclayer-event']}.${rawBody}`)
  .digest('hex')
```

A minimal signage client that works from the feed alone is in [`examples/minimal-cms`](../examples/minimal-cms/README.md).

### Files: static export

For systems that can only take image or HTML files:

```sh
pnpm -F agents export --site my-station-concourse --out dist/
```

This writes `dist/<site>/<bulletin_id>/<shape>.{json,png,html}` and `dist/<site>/manifest.json` (fixed by [`schema/export-manifest.schema.json`](../schema/export-manifest.schema.json)). Only approved bulletins are exported; the others are skipped with the reason. The app serves these files under `/delivery/<site>/<bulletin>/<shape>.{png,html,json}` while the bulletin stays approved, and the feed links them in `assets`.

PNGs are captured at each shape's base resolution (pillar at half scale), not at your panel's size. For any other resolution, use the HTML, or open `/screen?w=<px>&h=<px>` with the layout: it picks the nearest base shape and fits its canvas into that size. Each HTML file is self-contained: styles, pictograms and only the font subsets the screen uses are embedded, so it opens offline and matches the PNG pixel for pixel (the language rotation is frozen on the language shown at capture).

### In the author's own installations

The signage systems the author runs in venues take EVAC LAYER through this same HTTP surface: they receive the approved screen URLs and an `alert` / `clear` event, show the emergency layer over the ambient content, and remove it on `clear`. Nothing in EVAC LAYER depends on any particular signage system.

## 5. What every integration must keep

- Keep `sources` in the feed as delivered (municipal PDF page, GSI evacuation site data, JMA bulletin id). The screen itself names only the issuer, its time and the municipality; the full attribution may live on the receiving system's information screen. GSI data requires its attribution and the notice that facility details should be confirmed with the municipality.
- Do not edit warning names or levels: the headline is the JMA warning name, used verbatim.
- Do not add blinking. Motion is limited to one scale-in on appearance and a brightness pulse at or below 1 Hz.
- Typefaces and colours are fixed and not configurable: the Cabinet Office five-level colours and the bundled Noto fonts keep evacuation guidance looking the same on every screen in a city, and the contrast test (`app/test/contrast.test.ts`) and the Verifier's character-height check hold only for them.
