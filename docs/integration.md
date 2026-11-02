# Integrating EVAC LAYER with any signage system

EVAC LAYER turns an official JMA warning into approved emergency screens for four shapes (16:9, 9:16, 32:9, 1:1). Any signage CMS can take them in one of three ways. Every way delivers the same thing and follows the same rule: **only bulletins an operator approved, at sites with auto publish switched on**. Everything else stays ambient.

The payload is fixed by [`schema/feed.schema.json`](../schema/feed.schema.json): the site, `state` (`ambient` | `alert`), the alert (hazard, Cabinet Office level, template), the four layout JSONs, PNG/HTML asset URLs, the sources (municipal PDF page, GSI data, JMA bulletin id) and `approved_at`.

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

Each delivery carries `X-EvacLayer-Event: alert` or `clear` and `X-EvacLayer-Signature: sha256=<hex HMAC-SHA256 of the raw body with your secret>`. Verify the signature before acting; reject anything that does not match. Failed deliveries are retried five times with exponential backoff.

## 3. Static export — files only

For systems that can only take image or HTML files:

```sh
pnpm -F agents export --site 05210-demo-honjo-station --out dist/
```

This writes `dist/<site>/<bulletin_id>/<shape>.{json,png,html}` and `dist/<site>/manifest.json` (fixed by [`schema/export-manifest.schema.json`](../schema/export-manifest.schema.json)). PNGs are rendered at the panel's native size. Each HTML file is self-contained: styles, pictograms and only the font subsets the screen uses are embedded, so it opens offline and matches the PNG pixel for pixel (the language rotation is frozen on the language shown at capture). Screens are read through the same approval gate as the live feed; unapproved bulletins are skipped with the reason.

## In a MOJUR installation

MOJUR includes EVAC LAYER as a standard module. It uses the same generic HTTP surface as any other system: it receives the approved screen URLs and an insert / clear event (the webhook above, or the feed), shows the emergency layer over the ambient content, and removes it on `clear`. Nothing in EVAC LAYER depends on MOJUR, and nothing MOJUR-specific is needed to build your own emergency layer.

## What every integration must keep

- Show the sources line as delivered (municipal PDF page, GSI evacuation site data, JMA bulletin time). GSI data requires its attribution and the notice that facility details should be confirmed with the municipality.
- Do not edit warning names or levels: the headline is the JMA warning name, used verbatim.
- Do not add blinking. Motion is limited to one scale-in on appearance and a brightness pulse at or below 1 Hz.
