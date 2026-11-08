# python player

A one-file signage player in Python 3, standard library only, with the same contract as [`examples/minimal-cms/`](../minimal-cms/): it reads `GET /api/feed/<site>` every 2 s and, while the feed says `state: "alert"`, shows the approved screen PNG for its shape full-screen on top of its own content (a shop and transport board). When the feed goes back to `ambient`, its own content returns. It knows nothing about EVAC LAYER except the feed.

With the app running (`pnpm -F app dev`), a site approved in `/admin` and its screens exported (`pnpm -F agents export --site <id>`, see the minimal CMS README for the full steps):

```sh
EVAC_FEED=http://127.0.0.1:3150/api/feed/15205-demo SHAPE=16x9 PORT=8091 python3 examples/python-player/player.py
open http://127.0.0.1:8091
```

Run it next to the minimal CMS on the same feed and both switch on the same bulletin.

- Python 3.8 or later, no packages.
- Sends the last `ETag` as `If-None-Match`; an unchanged feed is a bodyless 304. Other non-200 answers are logged.
- The page asks the player for `/state` once a second, so a switch shows within about 3 s of the feed changing.
