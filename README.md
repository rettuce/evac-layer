# EVAC LAYER

**The screens are already there.**
Turn the screens a city already has into evacuation guidance anyone can read.

**スクリーンはもうある。**
街にすでにあるスクリーンを、いちばん伝えなければならない瞬間に、誰にでも読める避難案内へ変える。

![A level-4 flood warning on a 16:9 screen, drawn from a real JMA bulletin for Yurihonjo, Akita](docs/screens/lv4-16x9.png)

[All screens — every shape and level, the pillar, the ambient layer and the switch →](docs/screens.md)

Built from scratch during **Built with Claude: Japan 2026** (Nov 2–8, 2026). Status: Day 2 — the pipeline runs end to end on real data; the demo video and the remaining polish are in progress.

[Demo video — coming Nov 8] · [日本語の概要](#日本語の概要)

## Why

**After the takeover, what do you draw?** / 乗っ取ったあと、何を描くか。

I build the light that carries information in stations and shopping streets: synchronized LED walls, platform signage, lobby screens. In a disaster those screens do one of two things: keep playing the ads, or go dark. The systems that exist today — CAP-connected signage, L-Alert feeds — decide *that* a screen gets taken over, and stop there. Nobody decides what to draw next, for *this* screen, in *this* building, for the people standing in front of it.

They are not abstract people. After the Noto Peninsula earthquake tsunami of January 1, 2024, the city of Jōetsu (Niigata) wrote in its official review that "foreign residents and visitors from outside the city found it hard to judge where to evacuate." The warning reached them. The next sentence — *go there, that way, 570 m* — did not.

The screens are already there, and each one knows where it stands. What is missing is what to draw for that spot, the moment after the takeover. EVAC LAYER draws it — for any screen in the country, generated with Claude.

## What it does

Give EVAC LAYER the coordinates of a screen — a concourse column, a mall wall, a lobby display — and it works out the rest for that spot: the municipality whose bulletins apply, the nearest designated evacuation site from GSI data, and the direction and distance to it from where the viewer stands. The same pipeline runs for any coordinates, so one venue or ten thousand screens across the country are the same job: read once per municipality, composed once per screen. For each screen it then:

1. **Reads** the municipality's own hazard-map PDFs and the GSI designated evacuation-site data, and keeps every claim with its source page.
2. **Listens** to JMA disaster-prevention XML bulletins (the real feed, recorded since October 2026) and resolves the warning, the Cabinet Office alert level (1–5) and the areas it concerns.
3. **Writes** the guidance for that venue and that bulletin: the action in plain Japanese, *yasashii nihongo*, English, Chinese and Korean, with action pictograms — never the municipality's own evacuation orders, which only the municipality may issue.
4. **Composes and renders** the same guidance for five screen shapes — 16:9, 9:16, 32:9, 1:1 and a wrap-around pillar — with viewing-distance-derived type sizes, the official alert-level colors, and no blinking.
5. **Inspects** every screen three ways: schema and rules, a browser check of the rendered DOM (overflow, dropped cells, duplicated distances), and a Vision pass that reads the PNG against the bulletin. Findings go back to the Writer, or stop the pipeline when rewriting cannot fix them.
6. **Delivers** only screens an operator approved, to any signage system: a feed, a signed webhook, or static files.

The output for one venue is a set: hazard × level × shape, each screen carrying its sources line (municipal PDF page, GSI data, JMA bulletin time) and its inspection report.

## How it works

Two layers. The slow one runs ahead of time; the fast one runs when a bulletin arrives.

```
ahead of time                                   when a bulletin arrives
─────────────────────────────                   ──────────────────────────────────────────────────
municipal PDFs ─┐                               JMA XML ──► parser ──► alert JSON
GSI shelters  ──┼─► Reader ─► municipality.json            │
site (lat/lng) ─┘   (Claude, cited)              ┌──────────┘
                                                 ▼
                                   Writer (Claude) ─► Composer ─► layout JSON ×5 shapes
                                        ▲                             │
                                        │ findings                    ▼
                                        └──────── Verifier ◄──── Renderer (Nuxt, deterministic)
                                            rules · browser DOM · Vision
                                                 │ pass
                                                 ▼
                              operator approves the set  ──►  feed / webhook / static export
```

- `agents/` — Reader, JMA parser, Writer, Composer, Verifier, the revise loop, fan-out over recorded bulletins, export. Commands are listed in `agents/README.md`.
- `app/` — the Renderer and the operator console (`/screen`, `/admin`, `/dashboard`), the approval gate, the feed and webhook delivery. `app/README.md`.
- `schema/` — the contract between them: layout, alert, municipality, feed, export manifest.
- `data/` — published municipality knowledge, layouts and inspection reports for the demo municipalities. Raw PDFs and the recorded JMA feed are not redistributed.
- `demo/` — the Blender concourse, the deterministic screen recorder and the compose pipeline for the video.

Determinism matters here: the renderer exposes a virtual clock, so the same layout at the same `t` is the same pixels, which is what lets the Verifier, the export and the demo recorder agree.

## Human in the loop

**Decide in calm. Deliver in crisis.** / 平時に決めて、有事は自動。

EVAC LAYER drafts. People decide, ahead of time. For each venue it generates the full set of guidance screens (hazard × alert level × language × screen shape), each carrying its sources (the municipal PDF page and the JMA bulletin ID) and an automated inspection report. An operator reviews and approves the set in calm times. When a bulletin arrives, only approved screens go up, deterministically.

## Any screen. / どの画面にも

EVAC LAYER ships as a standard module of MOJUR, the spatial-media system I run in venues — but most screens in the world are not MOJUR. So the delivery layer speaks plain HTTP, and only ever carries approved screens:

- **Pull** — `GET /api/feed/<site>`: what the site should show now, with the five layouts and PNG/HTML assets. `ETag` makes polling cheap.
- **Push** — a webhook per site, signed with HMAC-SHA256 over timestamp, delivery id, event and body; replay-safe.
- **Files** — `pnpm -F agents export --site <id>`: PNG and self-contained HTML per shape, for CMSs that can only take images.

A screen is registered as one JSON file with its coordinates, facing and municipality code (`data/sites/<id>.json`); from then on it gets guidance for its own spot, and `POST /api/admin/site` switches its automatic delivery on. The steps are in `docs/integration.md`.

`docs/integration.md` has the three in detail. `examples/minimal-cms/` is a 30-line signage client that works from the feed alone — it is what the demo's last cut shows.

## What the real data caught

Everything below was found by running the pipeline on real inputs — 703 recorded JMA bulletins and five municipalities' hazard-map PDFs — not on the official samples. The full table with commits is in `agents/FINDINGS.md`.

- **Characters vanish from a PDF's text layer** (「最大津波 16.6m」→「最 津波 16.6m」): CID fonts without ToUnicode, invisible to length and character-class checks. The Reader now flags the layer as suspect and, with `--allow-vision`, reads the page image instead, citing `method: vision`.
- **A level-5 flood bulletin came out as level null**: inundation districts are listed per breach point, not per gauge. Districts now inherit the forecast-area level; an undecidable level stops the pipeline with a reason instead of being treated as "below threshold".
- **Nine of 22 screens were "all clear" for warnings that had never been shown.** The replay now tracks what is on screen per hazard and only clears what it showed.
- **A prefectural rain advisory knocked a level-5 screen back to ambient**: live state was one value for all bulletins; it is now per bulletin series.
- **Long facility names pushed the distance off the screen** — seen only by looking at the rendered PNG, not in any static check. The shelter cell now carries the name alone and the renderer draws the fixed type label.
- **The Vision inspector's first pass found 25 pictogram contradictions** (an "evacuate" figure on an all-clear screen). Over five runs the counts went 25 → 8 → 4 → 4 → 0. Action pictograms now express only the action, and the Writer is told what the pictogram means before it writes.
- **The Writer used the municipality's own order names** ("高齢者等避難") in guidance derived from a JMA warning — which would read as if the city had issued it. A lint now forbids them.
- **English fields contained kanji** ("子吉川 Lv3 Flood Warning"). A lint now rejects non-Latin characters in `en`.

API cost of the whole data pass so far: Reader $2.88 (five municipalities), Writer about $2.75, Vision inspection $5.17 over nine runs.

## Data sources and licenses

- **JMA disaster-prevention XML** (気象庁 防災情報 XML) — the official sample bulletins, replayed unmodified, and bulletins recorded from the public long-term feed since 2026-10. The recorded feed itself is not redistributed; the demo municipalities' replay fixtures are.
- **GSI designated emergency evacuation sites / shelters** (国土地理院 指定緊急避難場所・指定避難所データ) — Public Data License 1.0. Attribution is on every screen's sources line, with the notice that facility details should be confirmed with the municipality.
- **Municipal hazard-map PDFs** — read from the municipalities' own sites; cited by file and page in `data/municipalities/*.json`; the PDFs are not redistributed.
- **Alert-level colors** — the Cabinet Office's five-level palette, original values.
- **Pictograms** — Material Symbols (Apache-2.0) for seven, seven drawn for this project with matching stroke and flat caps. `app/ASSETS.md`.
- **Fonts** — Noto Sans JP / SC / TC / KR (SIL OFL 1.1), bundled so screens render offline.
- **3D demo** — Poly Haven HDRI and textures (CC0). `demo/ASSETS.md`.

## What this is not

- Not a replacement for L-Alert, J-Alert or any official channel. EVAC LAYER sits downstream of the JMA bulletin and draws the screen; it does not issue warnings.
- Not the issuer of evacuation orders. Those belong to the municipality; the Writer is forbidden by lint from using their names.
- Not a promise about power. When the building loses power the screens are dark; the ambient layer says so and points to radio.
- Not a general signage CMS. It produces and gates emergency screens; your CMS shows them.

## Built during the hackathon

Before Nov 2: research, the concept, the data terms, downloading the source PDFs and recording the JMA feed. No code. Everything in this repository was written from Nov 2, 12:00 JST.

How it was built, in one paragraph: one Claude Code session acts as the commander and three implementation seats run as tmux sessions on their own git worktrees (`agents`, `render`, `demo`). The commander writes the specs and the contract between seats (layout JSON, DOM attributes the Verifier reads, the approval gate), integrates `work/*` into `main`, and accepts or returns the work. Seats report with results, what they could not verify, and open questions; the commander rules and sends the fix back. Tests, typecheck and a deterministic screen recorder are the checks the seats run themselves; the Vision inspector and a browser check are what the pipeline runs on its own output. `docs/how-we-built.md` goes into the seats, the contract and the revise loop.

## Run it

```sh
pnpm install
pnpm -F app dev                     # renderer + console on http://127.0.0.1:3150
open http://127.0.0.1:3150/screen?municipality=05210&mode=live
pnpm -F agents test                 # agents: unit + sample-based tests
pnpm -F app test                    # app: build + policy/server tests
```

The repo ships the demo municipalities' knowledge files, layouts and reports, so the console works without an API key. Running the Reader, Writer or Vision inspector yourself needs `ANTHROPIC_API_KEY` in `agents/.env`; `agents/README.md` lists every command with what it costs.

## License

License: AGPL-3.0 (see `LICENSE`). Copyright (C) 2026 You Tanaka.
Free for municipalities, public-safety organizations, research and personal use.
Commercial license for embedding into proprietary signage products: contact IE3 (you@ie3.jp).

External contributions are not accepted during the hackathon (Nov 2–8, 2026). See `CONTRIBUTING.md`.

## 日本語の概要

**スクリーンはもうあり、自分の場所を知っている。** 足りないのは、乗っ取ったあとにその場所のために何を描くかです。EVAC LAYER はそれを、全国のどの画面にも、Claude で作ります。

**誰の、どんな課題か。** 駅や商業施設のスクリーンは災害のとき、広告を流し続けるか黒く落ちるかのどちらかです。既存の仕組み（CAP 連携サイネージ・L アラート）は「画面を乗っ取る」ところまでで、その先に何を描くかは誰も決めていません。能登半島地震の津波では、上越市が「外国人や市外からの来訪者が、どこに避難すればよいかを判断することが難しかった」と検証しています。警報は届いた。「そこへ、あちらへ、570 m」が届いていない。

**どう解決するか。** 画面は自分の緯度経度を持ち、EVAC LAYER はそこから市町村の電文と最寄りの避難場所（方向・距離）を引きます。自治体のハザードマップ PDF と国土地理院の避難場所データを出典つきで読み、気象庁の電文が来たら、その施設・その画面の形に合わせた避難案内（やさしい日本語・英中韓・図記号）を 5 つの画面形状で生成し、規則・ブラウザ・Vision の 3 段で検査します。平時に運営者が一式を承認しておけば、有事は承認済みの画面だけが自動で上がります。配信はフィード・署名つき Webhook・静的ファイルの 3 通りで、どのサイネージ CMS でも受け取れます。

**ハッカソン後に誰が使うか。** IE3 の空間演出システム MOJUR の標準モジュールとして、駅・商業施設の導入先に入ります。MOJUR 以外の CMS は `docs/integration.md` と `examples/minimal-cms/` から。自治体・防災機関・研究・個人は無償（AGPL-3.0）です。
