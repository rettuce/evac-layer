# EVAC LAYER app (renderer, admin, dashboard)

Nuxt 4 SPA. Screens render offline: fonts are bundled, layouts come from `data/` through the app's own API.

## Development

```sh
pnpm install
pnpm -F app dev            # http://127.0.0.1:3150
node scripts/shot.mjs      # four shapes at native size into app/shots/
```

## Tests

```sh
pnpm -F app test   # nuxt build, then node --test app/test/*.test.ts (no extra dependencies)
```

`test/policies.test.ts` covers the pure rules (dev layout bridge paths, trusted `src`, admin access, the live approval gate); `test/server.test.ts` starts the production build twice on a free port with a temporary data directory and checks the gate, the admin refusals and the token mode end to end; `test/delivery.test.ts` checks the feed (ambient before approval, alert with layouts and assets after, ETag, schema check through `pnpm -F agents validate`) and a signed webhook delivered to a local receiver; `test/ambient.test.ts` covers the hourly ambient pick.

## Production build

```sh
pnpm -F app build
HOST=127.0.0.1 PORT=3160 node app/.output/server/index.mjs
```

| URL | What it shows |
|---|---|
| `/screen?shape=16x9&mode=live&municipality=05210&speed=1200` | live replay of the municipality's bulletins over the pre-generated layouts (`&clock=virtual&t=<ms>` for frame-exact recording) |
| `/screen?shape=16x9&layout=<fixture>` | a fixture from `app/fixtures/` |
| `/admin` | bulletins, four-shape previews, Verifier result, approval and per-site auto publish |
| `/dashboard` | totals over `data/` (`?clock=virtual&t=<ms>` for the count-up) |

`app/layout/README.md` lists every `/screen` parameter and the data attributes a recorder or Verifier can wait on.

### Data directory

The server reads `data/layouts`, `data/reports`, `data/sites` and `data/municipalities`, and writes only `data/approvals.json` (approval and auto-publish state; a missing file means nothing is approved) and `data/subscriptions.json` (webhook registrations with their secrets, mode 600). Delivery assets (PNG/HTML from `pnpm -F agents export`) are read from `dist/` (`NUXT_DIST_DIR` to move it).
The repository root is fixed at build time. When the build runs from another location, point it at the data:

```sh
NUXT_REPO_ROOT=/path/to/evac-layer NUXT_DATA_DIR=/path/to/evac-layer/data node app/.output/server/index.mjs
```

### What stays development-only

- `/api/layout?file=<absolute path>` (renders any JSON file inside the repository for the Verifier) returns 404 in a production build.
- `/screen?src=` accepts only the layout store (`/api/live-layout?…`, `/api/admin/preview-layout?…`) in production, so a screen cannot be pointed at a document from elsewhere.

### Approval gate

`/api/live-layout` returns a layout only when the site has auto publish on and the bulletin is approved in `data/approvals.json`; otherwise 403 and the live screen stays ambient with `data-unapproved`. A live screen uses `?site=<site id>` or the `site` in `data/layouts/<code>/index.json`. `/admin` previews read `/api/admin/preview-layout`, which skips the gate but needs admin access.

### Delivery

- `GET /api/feed/<site_id>`: what the site shows now (`schema/feed.schema.json`). "Now" follows the site's `replay` in `data/sites/<id>.json` (`municipality`, `from`, `to`, `speed`; without it the site's municipality, the whole record and the default speed) on the same shared start as `/api/replay`. Only approved bulletins at auto-publish sites become `state: "alert"`. `ETag` / `If-None-Match` → 304. No authentication; CORS open.
- `/delivery/<site>/<bulletin>/<shape>.{png,html,json}`: the exported files, served only while the bulletin passes the same gate. A shape without both PNG and HTML is left out of `assets`.
- `POST /api/admin/subscriptions` `{site_id, url, secret}` (admin access, secret ≥ 16 characters): the server checks every subscribed site once a second and posts the feed body when the shown bulletin changes, with `X-EvacLayer-Event: alert|clear`, `X-EvacLayer-Timestamp` (Unix seconds), `X-EvacLayer-Delivery` (a UUID per delivery) and `X-EvacLayer-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<delivery>.<event>.<raw body>")>`. Receivers should reject a bad signature, a timestamp older than 5 minutes and a delivery id they have already seen (otherwise a captured `clear` could be replayed to take down a live alert); failures are retried 5 times (1, 2, 4, 8, 16 s), a newer state cancels pending retries. Targets must be http(s); addresses that resolve to loopback, private, link-local or other non-public ranges are refused at registration and again at connect time, and redirects are not followed. `NUXT_WEBHOOK_ALLOW_PRIVATE=1` allows LAN targets (demo, local CMS).

### Access

`/api/admin/*` decides what screens may show. Without `NUXT_ADMIN_TOKEN` it answers loopback clients only, and only when Host is localhost/127.0.0.1/[::1], the request is not cross-site, and POST bodies are JSON (403 otherwise). Behind a reverse proxy every request looks like loopback, so set a token there:

```sh
NUXT_ADMIN_TOKEN=<random secret> node app/.output/server/index.mjs
# /admin asks for the token once and keeps it in sessionStorage; API calls send it as a Bearer token
```
