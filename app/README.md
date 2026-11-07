# EVAC LAYER app (renderer, admin, dashboard)

Nuxt 4 SPA. Screens render offline: fonts are bundled, layouts come from `data/` through the app's own API.

## Development

```sh
pnpm install
pnpm -F app dev            # http://127.0.0.1:3150
node scripts/shot.mjs      # five shapes at native size into app/shots/ (pillar at half scale)
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
| `/screen?shape=16x9&mode=live&site=<site id>` | what the site shows now: its recorded `replay` (window and speed from the site file), or, without `replay`, the bulletin last posted to `/api/admin/live` |
| `/screen?shape=16x9&mode=live&municipality=05210&speed=1200` | the pre-site form: replays the record of the municipality's only site with the window and speed of the query (`&clock=virtual&t=<ms>` for frame-exact recording) |
| `/screen?shape=16x9&layout=<fixture>` | a fixture from `app/fixtures/` (a production `/screen` without `layout` or `src` says the layout is unspecified instead of showing a fixture) |
| `/admin` | bulletins per site, previews for every shape, Verifier result, approval and per-site auto publish |
| `/dashboard` | totals over `data/` (`?clock=virtual&t=<ms>` for the count-up) |

`app/layout/README.md` lists every `/screen` parameter and the data attributes a recorder or Verifier can wait on.

### Sites

A site is one screen location: `data/sites/<site_id>.json` (`schema/site.schema.json`; the file name is the `id`). Its screens live in `data/layouts/<site_id>/` (`index.json` and `<bulletin_id>/<shape>.json`), and approvals are keyed `<site_id>/<bulletin_id>`, so two sites in one municipality never share an approval. APIs take `site` (`site_id` in POST bodies). `municipality` alone still works as an alias when the municipality has exactly one site; with none or several the API answers 400 and asks for `site`. An approval key written before sites (`<municipality>/<bulletin>`) is read as that only site, and ignored with a warning when the municipality has several.

### Data directory

The server reads `data/layouts`, `data/reports`, `data/sites` and `data/municipalities`, and writes only `data/approvals.json` (approval and auto-publish state; a missing file means nothing is approved), `data/subscriptions.json` (webhook registrations with their secrets and the last state each was sent, mode 600) and `data/live/<site_id>.json` (the live state). Delivery assets (PNG/HTML from `pnpm -F agents export`) are read from `dist/` (`NUXT_DIST_DIR` to move it).
`EVAC_DATA_DIR` moves the data directory (shared with `agents`; `NUXT_DATA_DIR` is kept as an alias). The repository root is fixed at build time; when the build runs from another location, point it at the repository too:

```sh
NUXT_REPO_ROOT=/path/to/evac-layer EVAC_DATA_DIR=/path/to/evac-layer/data node app/.output/server/index.mjs
```

### What stays development-only

- `/api/layout?file=<absolute path>` (renders any JSON file inside the repository for the Verifier) returns 404 in a production build.
- `/screen?src=` accepts only the layout store (`/api/live-layout?…`, `/api/admin/preview-layout?…`) in production, so a screen cannot be pointed at a document from elsewhere.
- `/api/demo-site-layout?path=demo/sites/…` (the demo recordings) answers only when the server runs with `EVAC_DEMO=1`.
- A site without `data/layouts/<site_id>/index.json` falls back to the agents test fixtures only on a development server.

### Approval gate

`/api/live-layout?site=<id>&bulletin=<id>&shape=<shape>` returns a layout only when the site has auto publish on and the bulletin is approved for that site in `data/approvals.json`; otherwise 403 and the live screen stays ambient with `data-unapproved`. `/admin` previews read `/api/admin/preview-layout` (same parameters), which skips the gate but needs admin access. `POST /api/admin/approve {site_id, bulletin_id, approved}` binds the approval to the current layout files.

### Live state

A site with `replay` plays the recorded bulletins back from a shared start (the demo). Any other site is live: `POST /api/admin/live {site_id, bulletin_id}` (admin access; `bulletin_id: null` clears) writes `data/live/<site_id>.json` `{bulletin_id, updated_at}`, and `pnpm -F agents live --site <id> --bulletin <id>|--clear` writes the same file. The posted bulletin is shown only when it is approved for the site and auto publish is on; otherwise the site stays ambient. A site with `replay` answers 409. `pnpm -F agents receive --sites <id>` records the JMA long feeds, composes the screens of each new bulletin that concerns the site and writes this same file; a receiver of your own only calls this endpoint.

### Delivery

- `GET /api/feed/<site_id>`: what the site shows now (`schema/feed.schema.json`), by the replay or the live state above. Only approved bulletins at auto-publish sites become `state: "alert"`. `ETag` / `If-None-Match` → 304. No authentication; CORS open.
- `/delivery/<site>/<bulletin>/<shape>.{png,html,json}`: the exported files, served only while the bulletin passes the same gate. A shape without both PNG and HTML is left out of `assets`.
- `POST /api/admin/subscriptions` `{site_id, url, secret}` (admin access, secret ≥ 16 characters): the server checks every subscribed site once a second and posts the feed body when the shown bulletin changes, with `X-EvacLayer-Event: alert|clear`, `X-EvacLayer-Timestamp` (Unix seconds), `X-EvacLayer-Delivery` (a UUID per delivery) and `X-EvacLayer-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<delivery>.<event>.<raw body>")>`. Receivers should reject a bad signature, a timestamp older than 5 minutes and a delivery id they have already seen (otherwise a captured `clear` could be replayed to take down a live alert); failures are retried 5 times (1, 2, 4, 8, 16 s), a newer state cancels pending retries. Targets must be http(s); addresses that resolve to loopback, private, link-local or other non-public ranges are refused at registration and again at connect time, and redirects are not followed. `NUXT_WEBHOOK_ALLOW_PRIVATE=1` allows LAN targets (demo, local CMS). The last state delivered to each subscription is stored with it, so a change that happened while the server was down (an alert that cleared) is sent after a restart.
- `GET /api/admin/subscriptions?site=<id>` lists registrations without their secrets; `DELETE /api/admin/subscriptions/<id>` removes one (204, or 404).
- Limits: run a single server process (several would each deliver); delivery to `https` targets has not been verified yet (tested over local `http` only).

### Access

`/api/admin/*` decides what screens may show. Without `NUXT_ADMIN_TOKEN` it answers loopback clients only, and only when Host is localhost/127.0.0.1/[::1], the request is not cross-site, and POST bodies are JSON (403 otherwise). Behind a reverse proxy every request looks like loopback, so set a token there:

```sh
NUXT_ADMIN_TOKEN=<random secret> node app/.output/server/index.mjs
# /admin asks for the token once and keeps it in sessionStorage; API calls send it as a Bearer token
```
