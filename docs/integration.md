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

- `municipality_id` (5-digit JIS code) selects which bulletins apply and which municipality knowledge file is read. `pnpm -F agents site` fills it from the coordinates (below); a code written by hand is kept.
- `facing_deg` is the compass direction the viewer faces when looking at the screen; the arrow to the evacuation site is rotated against it.
- From the coordinates the Composer picks the nearest GSI designated evacuation site that matches the hazard and writes its name, direction and distance into every layout for this site.
- A municipality may have any number of sites; each gets its own screens and approvals.
- Leave out `replay`. It makes a site play back a recording, for the demo only.

To write the file from the coordinates:

```sh
pnpm -F agents site --id my-station-concourse --name "Station concourse, north wall" --lat 39.38633978 --lng 140.0563304 --facing 0
```

It asks the GSI reverse geocoder (https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress) for the municipality code of the point and writes `data/sites/<id>.json`. With `--municipality <code>` the given code is kept and a warning is printed when GSI places the point elsewhere. With `--municipality <code>`, the file is also written when the reverse geocoder does not answer, with the given code and a warning. Without it, when GSI gives no code (no answer within 10 s, or a point outside Japan), nothing is written and the command exits 1. An invalid id or coordinates outside ±90 / ±180 are refused before the request. `--facing` defaults to 0 (north); an existing file is overwritten only with `--force`.

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

Open `/admin`, review the screens of each bulletin and approve them. An approval is per site and per bulletin (`<site_id>/<bulletin_id>`) and is bound to the layout files it was given for, so a bulletin whose wording or arrangement changed is held back until someone approves it again.

Approving a bulletin also approves its class at that site: `<hazard>/<template>/<level>` (for example `flood/evac-now/4`). The class approval is bound to the layout files with the parts that change from bulletin to bulletin taken out: the JMA warning name (the Japanese headline), the source line with the issue time, and the bulletin id. The Composer writes those parts from the parsed bulletin, not the model, so they are left out of the match. The translated headlines stay in, so a class whose translations change is held back. A later bulletin of the same class whose screens carry the approved wording and arrangement is therefore shown without a new approval. Revoking a bulletin (`"approved": false`) revokes every class approved from it, even when its layout files are gone, and the class of its current files. `data/approvals.json` keeps both:

```json
{
  "version": "0.1",
  "layouts": { "my-station-concourse/VXKOii-202610211815-e713da0e3c05": { "approved": true, "updated_at": "2026-11-07T10:08:52.057Z", "digest": "sha256:…" } },
  "sites": { "my-station-concourse": { "auto_publish": true, "updated_at": "2026-11-07T10:08:52.070Z" } },
  "classes": {
    "my-station-concourse/flood/evac-now/4": {
      "approved": true, "updated_at": "2026-11-07T10:08:52.057Z", "digest": "sha256:…",
      "approved_from": "VXKOii-202610211815-e713da0e3c05"
    }
  }
}
```

A file without `classes` (written before classes existed) works as before, bulletin by bulletin.

A class approval only helps if the next bulletin of the class is written with the approved wording. `receive` and `pipeline` take that wording from the Writer cache of the bulletin the class was approved from (`approved_from` in `data/approvals.json`, cached in `data/writer/<municipality>/<bulletin_id>.json`), and fall back to the class cache when there is none. At the end of a run, `fanout` builds the Writer cache of each class of the municipalities it ran, from the bulletin with the latest issue time, and prints one line per class after its table. To rebuild it by hand, run `pnpm -F agents writer --build-class-cache`. Only these two write the class cache. Either source is used only for a bulletin with the same title (`raw_title`, which names the river of a flood forecast) and the same caution (a tsunami clearance down to a sea-level-change forecast has its own wording). Any other bulletin of the class is written by the Writer API, and its new wording is not shown until someone approves it.

Without the page, approve each bulletin and then switch automatic delivery on for the site:

```sh
curl -s -X POST http://127.0.0.1:3150/api/admin/approve \
  -H 'Authorization: Bearer <admin token>' -H 'Content-Type: application/json' \
  -d '{"site_id":"my-station-concourse","bulletin_id":"<bulletin id>","approved":true}'

curl -s -X POST http://127.0.0.1:3150/api/admin/site \
  -H 'Authorization: Bearer <admin token>' -H 'Content-Type: application/json' \
  -d '{"site_id":"my-station-concourse","auto_publish":true}'
```

From localhost no token is needed and the `Authorization` header can be left out; `Content-Type: application/json` is required either way (the `/admin` page does the same calls). `pnpm -F app demo:approve [site id]` approves every screen bulletin of a site and switches its delivery on in one go, for trying the bundled demo. Switching `auto_publish` off stops delivery from the next state change.

## 3. Drive the state

From the JMA feed to the screen, `receive` does the whole round for live sites: it records the JMA XML long feeds, takes each new bulletin that concerns a site, writes, composes and verifies its screens into `data/layouts/<site_id>/`, and sets the last one that passed as the site's current bulletin. When the site already has an approval for the same class, the new bulletin is written with the wording of the bulletin the class was approved from (§2), and the Writer is not called: it is shown as soon as its own screens pass the rule and browser checks, with a report that names the very layout files on screen and no shape left out of the browser check. With `--verifier vision` the Writer is still not called, but the check also calls the Vision model. If a check finds something, the bulletin fails and waits for a person instead of being rewritten. Anything else is not shown until an operator approves it in `/admin` (above); until then the site keeps the bulletin it showed before (`fallback_bulletin_id` in the live state, one step back), or stays ambient when that one is not approved either. The fallback goes back one step only, so two unapproved bulletins in a row bring the site back to ambient. An unapproved all-clear keeps the previous warning on screen until a person approves the all-clear (the safe side). The Writer caches are read with or without an API key: `--writer live` is needed only to write, through the API, a bulletin whose class has no approved wording yet. Each round logs the site's feed state for the bulletin it set (`unknown` when the app cannot be reached). In real operation a screen follows a warning after a delay: the interval between feed reads (10 minutes in the example below) plus the time of the browser check. The simulator and the video replay recorded bulletins, so they switch instantly. Run it beside the app:

```sh
pnpm -F agents receive --sites my-station-concourse --every 600 --verifier browser
# add --writer live to write bulletins of a new class through the API (they then wait for approval)
```

Run only one `receive` process per data directory. Without `--every` it runs one round and exits. To keep it running as a service (launchd, systemd) rather than from cron, give it a longer interval: `pnpm -F agents receive --sites my-station-concourse --every 3600`. `pnpm -F agents record` runs the recording step alone, and `pnpm -F agents pipeline --alert <bulletin.xml> --site <site id> --writer live --publish --go-live` does one bulletin by hand.

A site without `replay` is live. Its state is the bulletin it should show now, kept in `data/live/<site_id>.json`. Set it through the API (admin access) or the CLI, which write the same file:

```sh
curl -s -X POST http://127.0.0.1:3150/api/admin/live \
  -H 'Authorization: Bearer <admin token>' -H 'Content-Type: application/json' \
  -d '{"site_id":"my-station-concourse","bulletin_id":"<bulletin id>"}'      # "bulletin_id": null clears

pnpm -F agents live --site my-station-concourse --bulletin <bulletin id>     # or --clear
```

Posting a bulletin moves the one that was live into `fallback_bulletin_id` (posting `null` clears both). The posted bulletin is shown when it is approved for the site and auto publish is on; otherwise the site keeps showing the fallback if that one is approved, and stays ambient if not. A site with `replay` answers 409.

`receive` writes the same file. If you already run your own JMA receiver, call this instead when a bulletin for the site arrives, after its screens were composed with `pipeline --publish` and approved.

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

The signage systems the author runs in venues will take EVAC LAYER through this same HTTP surface after the hackathon: the design is done, the integration is not. They will receive the approved screen URLs and an `alert` / `clear` event, show the emergency layer over the ambient content, and remove it on `clear`. Nothing in EVAC LAYER depends on any particular signage system.

## 5. What every integration must keep

- Keep `sources` in the feed as delivered (municipal PDF page, GSI evacuation site data, JMA bulletin id). The screen itself names only the issuer, its time and the municipality; the full attribution may live on the receiving system's information screen. GSI data requires its attribution and the notice that facility details should be confirmed with the municipality.
- Keep the data notices visible on the receiving side too. JMA: the bulletins come from JMA's disaster-prevention XML (source: https://xml.kishou.go.jp/), EVAC LAYER rephrases them into *yasashii nihongo* and other languages under its own editorial responsibility, the warning names, levels and areas stay as JMA issued them, and no forecast of its own is made. GSI: the evacuation sites are processed by EVAC LAYER from the GSI designated emergency evacuation site data (https://www.gsi.go.jp/bousaichiri/hinanbasho.html, Public Data License 1.0); the data is registered by municipalities and may be out of date or incomplete, so the latest details should be confirmed with the municipality.
- Do not edit warning names or levels: the headline is the JMA warning name, used verbatim.
- Do not add blinking. Motion is limited to one scale-in on appearance and a brightness pulse at or below 1 Hz.
- Typefaces and colours are fixed and not configurable: the Cabinet Office five-level colours and the bundled Noto fonts keep evacuation guidance looking the same on every screen in a city, and the contrast test (`app/test/contrast.test.ts`) and the Verifier's character-height check hold only for them.
