# minimal CMS

A 39-line signage player that knows nothing about EVAC LAYER except the feed. It shows its own content ("いつもの広告・お知らせ") and, while the site's feed says `state: "alert"`, the approved screen PNG for its shape full-screen on top. When the feed goes back to `ambient`, its own content returns.

```sh
EVAC_FEED=http://127.0.0.1:3150/api/feed/05210-demo-honjo-station SHAPE=16x9 PORT=8080 node examples/minimal-cms/index.mjs
open http://127.0.0.1:8080
```

- Polls every 2 s with `If-None-Match`; an unchanged feed is a bodyless 304.
- Node 18 or later, no dependencies.
- PNGs exist only for bulletins exported with `pnpm -F agents export --site <id>`; the EVAC LAYER server serves them from `dist/` under `/delivery/…` while the bulletin stays approved.
- A real player would also take the webhook (`POST /api/admin/subscriptions`) to switch without waiting for the next poll; see `app/README.md` → Delivery.
