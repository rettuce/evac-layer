# Integrating EVAC LAYER with any signage system

EVAC LAYER turns an official JMA warning into approved emergency screens for five shapes (16:9, 9:16, 32:9, 1:1 and the four-faced pillar). Any signage CMS can take them in one of three ways. Every way delivers the same thing and follows the same rule: **only bulletins an operator approved, at sites with auto publish switched on**. Everything else stays ambient.

The payload is fixed by [`schema/feed.schema.json`](../schema/feed.schema.json): the site, `state` (`ambient` | `alert`), the alert (hazard, Cabinet Office level, template), one layout JSON per shape, PNG/HTML asset URLs, the sources (municipal PDF page, GSI data, JMA bulletin id) and `approved_at`.

## 0. Register the screen

A site (one venue; its screens share the coordinates) is one JSON file in `data/sites/`, and the only thing it has to know is where it stands. Today the repository holds one site per municipality; a second site in the same municipality is not wired up yet (the four-location comparison in `demo/sites/` is outside the contract):

```json
{
  "id": "05210-demo-honjo-station",
  "municipality_id": "05210",
  "lat": 39.38633978,
  "lng": 140.0563304,
  "facing_deg": 0
}
```

`facing_deg` is the compass direction the viewer faces when looking at the screen; the arrow to the evacuation site is rotated against it. From these coordinates the Composer picks the nearest GSI designated evacuation site and writes its name, direction and distance into every layout for this site. The municipality code is written by hand today; it selects which bulletins apply and which hazard-map knowledge file the Reader produced.

Then generate and approve the set once, in calm times:

```sh
pnpm -F agents fanout --municipalities 05210 --verifier vision --writer live   # every recorded bulletin → layouts for every shape (the recorded JMA feed is replayed; the live receiver is not in this repository)
```

Open `/admin`, review the screens and approve the set, then switch automatic delivery on for the site (`POST /api/admin/site` with `{"site_id": "...", "auto_publish": true}`). An approval is bound to the layout files it was given for (a digest of the shape JSONs is stored with it), so a bulletin whose screens were regenerated is held back as stale until someone approves it again. From here on the site receives guidance for its own spot through any of the three ways below.

## 1. Pull — poll a feed

Poll `GET /api/feed/<site_id>` every few seconds. It returns what the site should show now. Send the last `ETag` back as `If-None-Match`; an unchanged state answers `304` with no body, so polling is cheap. No authentication: the feed only ever contains approved, public information.

```sh
curl -s -H 'If-None-Match: "<etag from last time>"' https://<host>/api/feed/05210-demo-honjo-station
```

When `state` is `alert`, show `assets["16x9"].png` (or the HTML, or render `layouts["16x9"]` yourself) full screen; when it returns to `ambient`, go back to your normal content. Use the shape that matches the panel.

## 2. Push — receive a webhook

Register a URL once (admin token required) and EVAC LAYER posts the feed body to it whenever the site's state changes:

```sh
curl -s -X POST https://<host>/api/admin/subscriptions \
  -H 'Authorization: Bearer <admin token>' -H 'Content-Type: application/json' \
  -d '{"site_id":"05210-demo-honjo-station","url":"https://cms.example/hooks/evac","secret":"<shared secret>"}'
```

Each delivery carries four headers: `X-EvacLayer-Event: alert` or `clear`, `X-EvacLayer-Timestamp` (Unix seconds), `X-EvacLayer-Delivery` (a UUID per delivery) and `X-EvacLayer-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<delivery>.<event>.<raw body>")>`. Before acting, verify the signature, reject a timestamp older than 5 minutes and reject a delivery id you have already seen; otherwise a captured `clear` could be replayed to take down a live alert. Failed deliveries are retried five times (1, 2, 4, 8, 16 s) and a newer state cancels pending retries. Targets must be `http(s)`; URLs that resolve to loopback, private, link-local or other non-public ranges are refused (set `NUXT_WEBHOOK_ALLOW_PRIVATE=1` for a CMS on the same LAN), and redirects are not followed.

```js
// receiver (Node)
const expected = 'sha256=' + createHmac('sha256', secret)
  .update(`${req.headers['x-evaclayer-timestamp']}.${req.headers['x-evaclayer-delivery']}.${req.headers['x-evaclayer-event']}.${rawBody}`)
  .digest('hex')
```

A minimal signage client that works from the feed alone is in [`examples/minimal-cms`](../examples/minimal-cms/README.md).

## 3. Static export — files only

For systems that can only take image or HTML files:

```sh
pnpm -F agents export --site 05210-demo-honjo-station --out dist/
```

This writes `dist/<site>/<bulletin_id>/<shape>.{json,png,html}` and `dist/<site>/manifest.json` (fixed by [`schema/export-manifest.schema.json`](../schema/export-manifest.schema.json)). PNGs are rendered at the panel's native size. Each HTML file is self-contained: styles, pictograms and only the font subsets the screen uses are embedded, so it opens offline and matches the PNG pixel for pixel (the language rotation is frozen on the language shown at capture). Screens are read through the same approval gate as the live feed; unapproved bulletins are skipped with the reason.

## In the author's own installations

The signage systems the author runs in venues take EVAC LAYER through this same generic HTTP surface: they receive the approved screen URLs and an `alert` / `clear` event (the webhook above, or the feed), show the emergency layer over the ambient content, and remove it on `clear`. Nothing in EVAC LAYER depends on any particular signage system, and nothing system-specific is needed to build your own emergency layer.

## What every integration must keep

- Keep `sources` in the feed as delivered (municipal PDF page, GSI evacuation site data, JMA bulletin id). The screen itself names only the issuer, its time and the municipality; the full attribution may live on the receiving system's information screen. GSI data requires its attribution and the notice that facility details should be confirmed with the municipality.
- Do not edit warning names or levels: the headline is the JMA warning name, used verbatim.
- Do not add blinking. Motion is limited to one scale-in on appearance and a brightness pulse at or below 1 Hz.
