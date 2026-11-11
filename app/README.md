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

A site is one screen location: `data/sites/<site_id>.json` (`schema/site.schema.json`; the file name is the `id`). Its screens live in `data/layouts/<site_id>/` (`index.json` and `<bulletin_id>/<shape>.json`), and approvals are keyed `<site_id>/<bulletin_id>`, so two sites in one municipality never share an approval. APIs take `site` (`site_id` in POST bodies). `municipality` alone still works as an alias when the municipality has exactly one site; with none or several the API answers 400 and asks for `site`. An approval key written before sites (`<municipality>/<bulletin>`) is read as that only site, and ignored with a warning when the municipality has several. On a server without facility tokens, the server rewrites at startup each such key whose municipality has exactly one site to `<site_id>/<bulletin>` in `data/approvals.json`, so that a site registered later in the municipality does not change whose approval it is. On a server with facility tokens (or a token ledger it cannot read) old keys are neither rewritten nor read as any site's approval, by the server or by `pnpm -F agents export`, and stay in the file as they are.

A site file that cannot be read or is not valid JSON is skipped with one warning, so it does not stop the catalog or the approvals of the other sites.

### Sites over HTTP

Admin access as below; a facility token acts on its own sites only. Errors carry `data.code` (`invalid-request`, `not-found`, `site-id-taken`, `geocoder-unavailable`, and for generations `generation-running`, `generation-rate-limited`, `municipality-not-prepared`, `generation-disabled`).

- `PUT /api/admin/sites/<site_id>` `{lat, lng, facing_deg?, name?, municipality_id?, actor?}`: registers the site (201) or updates its place (200). The id follows `schema/site.schema.json` (3-64 of `a-z 0-9 -`); a new id of five digits only is refused, because it would read as a municipality in an old approval key, and an id that differs from an existing site only in case answers 409 `site-id-taken`. `municipality_id` comes from the GSI reverse geocoder unless given (a given code that differs is kept and reported in `warnings`; without it, a geocoder that does not answer gives 502 `geocoder-unavailable`, and a point in no municipality, at sea or outside Japan, 400 `invalid-request`). The geocoder is not asked when `lat` and `lng` equal the stored ones, and is asked one request at a time. A site created with a facility token carries that token's `facility_id`; an id already used by another facility's site, or by a site without `facility_id`, answers 409 `site-id-taken` to a facility. The operator keeps an existing site's `facility_id` and creates sites without one (assign it with `pnpm -F agents site --facility`). Fields the body leaves out (`name`, `note`, `replay`) are kept, except `facing_deg`, which is part of the place: a body without it removes a stored one (the screens then show a north-fixed compass arrow); the same body twice changes nothing, and a change of `lat`, `lng`, `facing_deg` (including gaining or losing it) or `municipality_id` stamps `location_updated_at` (so does `pnpm -F agents site --force`). `NUXT_REVERSE_GEOCODER_URL` points the lookup elsewhere (tests). Registering an id that has no site file removes whatever is still stored under it (approvals, screens, live state, exports, webhook registrations), so a new site never starts with an earlier one's approvals.
- `GET /api/admin/sites/<site_id>` and `GET /api/admin/sites` (`?facility_id=` narrows the operator's list) answer the site state: the stored `site`, `facility_id` (or null), `auto_publish`, `municipality_prepared` (`data/municipalities/<code>.json` exists), `needs_generation` (no screens; or the place changed after the start of the last successful generation; or, when no generation has succeeded yet, after `index.json` was last written), `last_generation` (the latest generation job, below), `classes` (one per `<hazard>/<template>/<level>`, standing for the newest screen of the class: `bulletin_id`, `synthetic` (the id starts with `SYN-`), `digest`, `outcome` `pass`/`fail` from its report or `pending` without one, `unchanged` (once a job has run: the digest equals the one recorded when the last job started, so an approval given before it still holds), `approved` as in the catalog, `approved_at`, `live`, `previews` (the preview URL per shape, for the shapes whose PNG was rendered from the current screens)), `approved_classes {approved, total}`, `exports {pending, failed}` from `data/live/<site_id>.export.json`, and `warnings`.
- `DELETE /api/admin/sites/<site_id>` (204) removes the site's screens, reports, approvals, live, receiver and export state, `dist/<site_id>/` and webhook registrations, and the site file last. Its feed answers 404 from then on; webhook retries to its registrations stop, and an export that was running when it was deleted leaves no files or record. A generation job of the site that is queued never runs, one that is running is stopped (its whole process group) before anything is removed, and the job record and previews are removed with the rest.
- `POST /api/admin/sites/<site_id>/generations` `{actor?}` (202, `Location` header) queues a generation job: the server runs `pnpm -s -F agents generate --site=<id> --writer=<w> --verifier=<v> --base-url=<this server>` (`NUXT_GENERATE_COMMAND`, `off` answers 503 `generation-disabled`; `NUXT_GENERATE_WRITER` default `live`, `NUXT_GENERATE_VERIFIER` default `browser`), then renders a preview PNG of every shape of each class that passed, with `pnpm -s -F agents preview` (`NUXT_PREVIEW_COMMAND`, `off` skips previews). Jobs run one at a time over all sites. A site with a job queued or running answers 409 `generation-running` with its `generation_id`; a site whose municipality is not prepared, 409 `municipality-not-prepared`. A facility may start 6 jobs an hour over all its sites (the operator 6 per site; `NUXT_GENERATIONS_PER_HOUR` changes it), counted in the server process; past that, 429 `generation-rate-limited` with `Retry-After`. The answer is the job: `generation_id`, `site_id`, `status` `queued`, `created_at`, `classes: []`, `started_by {token_label, actor?}` (`operator` for the operator token).
- `GET /api/admin/sites/<site_id>/generations/<generation_id>` answers the job: `status` `queued` → `running` → `done` or `failed`, `started_at`, `finished_at`, and `classes` copied from `data/layouts/<site_id>/generation.json` (`class`, `bulletin_id`, `synthetic`, `outcome`, `reason`, and `preview_error` when a preview could not be rendered, which does not fail the job). A job is `failed` when the command exits non-zero, with the end of its output in `error`, or `server restarted` when the server stopped while it was queued or running. The latest job and the one before it stay readable.
- `GET /api/admin/sites/<site_id>/previews/<bulletin_id>/<shape>.png` answers a preview PNG with `ETag` set to the layout digest it was rendered from and `Cache-Control: no-store`, while that digest is still the bulletin's; otherwise 404. Synthetic and unapproved real bulletins alike: a preview is for the person who approves, never for delivery.

Every write keyed by a site (its file, approvals, auto publish, live state, webhook registrations, export records) runs under one lock per site and checks under it that the caller may still act on the site, so a site deleted and registered again by another facility never receives a write meant for the old one.

### Audit

Every admin request that changes something (any method but GET, HEAD and OPTIONS) appends one line to `data/audit.jsonl` (gitignored): `at`, `method`, `path`, `site_id` when known, `principal` (`{kind: "operator"}` or `{kind: "facility", facility_id, label}`), `actor` when given, and the answer's `status`, refusals included. A request refused for want of a credential is not recorded. Past 10 MB the file moves to `audit.jsonl.1`, and five older files are kept (`NUXT_AUDIT_MAX_BYTES` lowers the limit for tests). `actor {id, name?}` (each up to 120 characters) comes from the body, or for a request without one from `X-EvacLayer-Actor-Id` and `X-EvacLayer-Actor-Name` (percent-encoded UTF-8); a malformed one answers 400. It is recorded, not verified.

### Data directory

The server reads `data/layouts`, `data/reports`, `data/sites` and `data/municipalities`, and writes only `data/sites/<site_id>.json` (through `PUT /api/admin/sites`), `data/audit.jsonl`, `data/approvals.json` (approval and auto-publish state; a missing file means nothing is approved), `data/subscriptions.json` (webhook registrations with their secrets and the last state each was sent, mode 600), `data/live/<site_id>.json` (the live state), `data/live/<site_id>.export.json` (the outcome of the last export of each bulletin the server started), `data/live/<site_id>.generation.json` (the latest generation job and the one before it) and, through the preview command, `data/previews/<site_id>/<bulletin_id>/` (preview PNGs and the layout digest they show; nothing serves this directory but the preview path above). Delivery assets (PNG/HTML from `pnpm -F agents export`) are read from `dist/` (`NUXT_DIST_DIR` to move it). When an approval lets bulletins go out, the server runs that export itself for each one whose current screens are not exported yet, one at a time in the background (and every five seconds for the bulletin a publishing site is showing without `assets`), and so writes to `dist/` through it (`NUXT_EXPORT_COMMAND`, default `pnpm -s -F agents export`; `off` disables it). The feed links exported files only while `layout.digest` beside them matches the layout files being served.
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

`/api/live-layout?site=<id>&bulletin=<id>&shape=<shape>` returns a layout only when the site has auto publish on and the bulletin is approved for that site in `data/approvals.json`; otherwise 403 and the live screen stays ambient with `data-unapproved`. `/admin` previews read `/api/admin/preview-layout` (same parameters), which skips the gate but needs admin access. `POST /api/admin/approve {site_id, bulletin_id, approved, digest?}` binds the approval to the current layout files; with `digest` (what `/admin` showed), it answers 409 when the files changed since. It also writes the class of the screens (`classes["<site_id>/<hazard>/<template>/<level>"]` in `data/approvals.json`), bound to the layout files without the JMA warning name (the Japanese headline), the source line and the bulletin id, so a later bulletin of the same class with the same wording, translations and arrangement passes the gate once its own report (`data/reports/<site_id>/<bulletin_id>/report.json`) passed a browser or Vision check of every shape and carries the digest of the current layout files (`layout_digest`; an empty `browser_skipped`); revoking a bulletin revokes every class approved from it and the class of its current files. The screens of a drill or test bulletin have a class of their own (`…/drill`, `…/test`, from the layout's `alert.status` or the index row's `status`) that is never approved: they are approved bulletin by bulletin. A synthetic bulletin (`SYN-`, composed by `pnpm -F agents generate`) is approved only for its class: the gate answers 403 `synthetic` for it on `/api/live-layout`, the feed and the replay never show it (`/api/replay` answers no row for a live state that names one), and `POST /api/admin/live` refuses it with 400. `/admin` marks such a bulletin as approved through its class and offers to approve it as a bulletin as well.

### Live state

A site with `replay` plays the recorded bulletins back from a shared start (the demo). Any other site is live: `POST /api/admin/live {site_id, bulletin_id}` (admin access; `bulletin_id: null` clears) writes `data/live/<site_id>.json` `{bulletin_id, fallback_bulletin_id, updated_at}`, moving the bulletin that was live into `fallback_bulletin_id` (`null` clears both), and `pnpm -F agents live --site <id> --bulletin <id>|--clear` writes the same file. The posted bulletin is shown when it is approved for the site and auto publish is on; otherwise the feed and the live screen keep the fallback if that one is approved, and stay ambient if not. A site with `replay` answers 409. `pnpm -F agents receive --sites <id>` records the JMA long feeds, composes the screens of each new bulletin that concerns the site and writes this same file; a receiver of your own only calls this endpoint.

### Delivery

- `GET /api/feed/<site_id>`: what the site shows now (`schema/feed.schema.json`), by the replay or the live state above. Only approved bulletins at auto-publish sites become `state: "alert"`. `ETag` / `If-None-Match` → 304. No authentication; CORS open.
- `GET /api/feed?lat=<deg>&lng=<deg>`: the feed of the site nearest the point within 100 m, with the same body, `ETag` and 304 as `GET /api/feed/<site_id>` and `Content-Location: /api/feed/<site_id>`; 404 `no-site-near` without one. Single-facility servers only (see Access).
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

Facility tokens let one server serve several facilities. `pnpm -F agents tokens issue --facility <facility id> --label <text> [--expires <ISO 8601>]` prints a token once and keeps only its SHA-256 in `data/tokens.json` (mode 600, gitignored; `list` and `revoke --id <id>` manage it, and the server reads the file on every request, so a revoked token stops at once). A facility token, sent as `Authorization: Bearer <token>`, acts only on sites whose site file carries its `facility_id`; any other site, including one without `facility_id`, answers 404 exactly as a site that does not exist. On the paths it may use it must name the site: `municipality` alone and `GET /api/admin/subscriptions` without `site` answer 400, and `DELETE /api/admin/subscriptions/<id>` of another facility's registration answers 404. Every other `/api/admin/` path, `POST /api/admin/live` among them and any path added later, answers 403 with `data.code: "operator-only"`. An unknown, expired or missing token answers 401, and the loopback rule above is off as soon as `data/tokens.json` holds any token. With facility tokens and no `NUXT_ADMIN_TOKEN` there is no operator credential, so the operator-only paths admit no one. A `data/tokens.json` that cannot be read as a list of token records shuts out every facility token and loopback access alike (logged once); `NUXT_ADMIN_TOKEN` still works, and the CLI refuses to rewrite such a file.

A server with any facility token (or a token ledger it cannot read) holds several facilities, and a facility chooses the coordinates of its own sites, so lookups by place are off there: `GET /api/feed?lat=&lng=` and `GET /api/site-near` answer 404 with `data.code: "place-lookup-disabled"` (`/screen?lat=&lng=` then shows no site; use `site=`), `GET /api/replay?…&reset` no longer restarts a replay, and the public paths (`/api/replay`, `/api/live-layout`) refuse `municipality` without `site` (400), because a facility could add a site to the municipality to change what it names.
