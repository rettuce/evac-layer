# minimal CMS

MIT licensed ([`../LICENSE`](../LICENSE)), unlike the rest of the repository: copy it into your own player.

A 40-line signage player that knows nothing about EVAC LAYER except the feed. It shows its own content ("いつもの広告・お知らせ") and, while the site's feed says `state: "alert"`, the approved screen PNG for its shape full-screen on top. When the feed goes back to `ambient`, its own content returns.

Try it with the bundled 柏崎市 site `15205-demo` and its level 4 landslide bulletin of 2026-10-31 16:53, with the app running (`pnpm -F app dev`):

1. In `/admin`, approve `VPWW56-202610311653-b3fa1b3a2ced` for `15205-demo` and switch its auto publish on.
2. Wait about ten seconds: the server exports the approved screens in the background, so the feed has PNGs to link (`pnpm -F agents export --site 15205-demo` does the same by hand, and `data/live/15205-demo.export.json` says how it went).
3. Start the player:

   ```sh
   EVAC_FEED=http://127.0.0.1:3150/api/feed/15205-demo SHAPE=16x9 PORT=8080 node examples/minimal-cms/index.mjs
   open http://127.0.0.1:8080
   ```

4. Raise and clear the alert through the live state, as a JMA receiver would:

   ```sh
   pnpm -F agents live --site 15205-demo --bulletin VPWW56-202610311653-b3fa1b3a2ced   # the warning screen comes up
   pnpm -F agents live --site 15205-demo --clear                                       # its own content returns
   ```

- Polls every 2 s with `If-None-Match`; an unchanged feed is a bodyless 304. Any other non-200 answer (a wrong site id is 404) is logged.
- Node 18 or later, no dependencies.
- PNGs exist only for exported bulletins (the server exports on approval; `pnpm -F agents export --site <id>` by hand); the EVAC LAYER server serves them from `dist/` under `/delivery/…` while the bulletin stays approved.
- The same contract in Python, standard library only: [`examples/python-player/`](../python-player/).
- A real player would also take the webhook (`POST /api/admin/subscriptions`) to switch without waiting for the next poll; see [`docs/integration.md`](../../docs/integration.md).
