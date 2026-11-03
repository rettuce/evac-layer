# Four places, one bulletin

The same JMA bulletin (VXKOii-202610211815-e713da0e3c05, Lv4 flood, Koyoshi River, 2026-10-21 18:15) composed for four display locations in 由利本荘市. Only the site changes; the nearest emergency evacuation site, its distance and the arrow follow from the coordinates. Used for the demo's location-switch cut.

| slug | facility (GSI id) | lat, lng | nearest evacuation site | distance | direction / rotation |
|---|---|---|---|---|---|
| honjo-station | 本荘ステーションホテル, near 羽後本荘駅 (E0521000003201) | 39.38633978, 140.0563304 | 鶴舞小学校 | 570 m | 南西へ / 135 |
| tsurumai-kaikan | 鶴舞会館 (E0521000005111) | 39.38600596, 140.0457488 | 本荘公園前広場 | 160 m | 東へ / 0 |
| yuri-hs-ground | 由利高等学校グラウンド (E0521000076201) | 39.40050705, 140.0566774 | 南内越公民館・体育館 | 210 m | 南東へ / 45 |
| ishiwaki-park | 石脇公園グラウンド (E0521000072201) | 39.39784308, 140.0479455 | 石脇体育館 | 80 m | 北へ / 270 |

How each `16x9.json` was made (the Writer text is the cached record in `data/writer/05210/`, whose `output` field is what `compose --writer` takes):

```sh
node -e 'const w=require("./data/writer/05210/VXKOii-202610211815-e713da0e3c05.json");require("fs").writeFileSync("/tmp/writer.json",JSON.stringify(w.output))'
pnpm -F agents compose --site "$PWD/demo/sites/<slug>/site.json" --alert "$JMA_FEED_DIR/bodies/20261021/20261021091533_0_VXKO55_050000.xml" --municipality 05210 --writer /tmp/writer.json --out-dir /tmp/out/
```

`honjo-station/16x9.json` is a copy of `data/layouts/05210/VXKOii-202610211815-e713da0e3c05/16x9.json`. These files are outside the contract: `data/` keeps one site per municipality (`data/sites/`) and the fan-out does not read this directory.
