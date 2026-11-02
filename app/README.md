# EVAC LAYER app (renderer, admin, dashboard)

Nuxt 4 SPA. Screens render offline: fonts are bundled, layouts come from `data/` through the app's own API.

## Development

```sh
pnpm install
pnpm -F app dev            # http://127.0.0.1:3150
node scripts/shot.mjs      # four shapes at native size into app/shots/
```

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

The server reads `data/layouts`, `data/reports`, `data/sites` and `data/municipalities`, and writes only `data/approvals.json` (approval and auto-publish state; a missing file means nothing is approved).
The repository root is fixed at build time. When the build runs from another location, point it at the data:

```sh
NUXT_REPO_ROOT=/path/to/evac-layer NUXT_DATA_DIR=/path/to/evac-layer/data node app/.output/server/index.mjs
```

### What stays development-only

- `/api/layout?file=<absolute path>` (renders any JSON file inside the repository for the Verifier) returns 404 in a production build.
- `/screen?src=` accepts only the layout store (`/api/live-layout?…`, `/api/admin/preview-layout?…`) in production, so a screen cannot be pointed at a document from elsewhere.

### Approval gate

`/api/live-layout` returns a layout only when the site has auto publish on and the bulletin is approved in `data/approvals.json`; otherwise 403 and the live screen stays ambient with `data-unapproved`. A live screen uses `?site=<site id>` or the `site` in `data/layouts/<code>/index.json`. `/admin` previews read `/api/admin/preview-layout`, which skips the gate but needs admin access.

### Access

`/api/admin/*` decides what screens may show. Without `NUXT_ADMIN_TOKEN` it answers loopback clients only, and only when Host is localhost/127.0.0.1/[::1], the request is not cross-site, and POST bodies are JSON (403 otherwise). Behind a reverse proxy every request looks like loopback, so set a token there:

```sh
NUXT_ADMIN_TOKEN=<random secret> node app/.output/server/index.mjs
# /admin asks for the token once and keeps it in sessionStorage; API calls send it as a Bearer token
```
