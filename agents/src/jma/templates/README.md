# Templates for synthetic bulletins

Unmodified official sample bulletins from 気象庁防災情報 XML (Japan Meteorological Agency disaster-prevention XML, https://xml.kishou.go.jp/ ), from `jmaxml_20260917_Samples.zip` (retrieved 2026-10-19), the same files as in `agents/test/fixtures/jma/jma-samples/`.

出典：気象庁ホームページ（https://xml.kishou.go.jp/ ）

Terms: 気象庁ホームページ利用規約 https://www.jma.go.jp/jma/kishou/info/coment.html (公共データ利用規約 第 1.0 版, compatible with CC BY 4.0). They are official samples, not current warnings.

| File | Used for |
|---|---|
| `15_17_01_251222_VPWW55.xml` | 気象警報・注意報（Ｒ０６）（大雨）: the heavy-rain classes |
| `15_17_01_251222_VPWW56.xml` | 気象警報・注意報（Ｒ０６）（土砂）: the landslide classes |
| `32-39_12_13_250206_VTSE41.xml` | 津波警報・注意報・予報 (the 2016-09-01 drill clearance): the tsunami classes |

`agents/src/jma/synthetic.ts` reads them to compose a synthetic bulletin for one municipality and one class: it keeps the sample's structure and issue time, sets the warning kind, names the issuer 気象庁 and sets Control/Status 通常, and drops every other area, the headline text and the free-text comments. For heavy rain and landslide it sets the municipality and its prefecture (in Head/Title).

A tsunami bulletin is addressed to tsunami forecast regions, not municipalities. For tsunami it writes one `Body/Tsunami/Forecast/Item` for each region of the municipality in `data/jma/tsunami-regions.json`, with the kind and the kind before it (`LastKind`). It also keeps the sample's `CodeDefine`. Every other region of the sample is dropped, along with arrival times, tsunami heights, observations, the earthquake, the body text and the comments. Head/Title is the kind the bulletin carries, or `津波予報` for the all-clear, following the Head/Title rule in 地震火山関連_解説資料 (https://xml.kishou.go.jp/tec_material.html).

| Class | Kind (code) | LastKind (code) | Head/Title |
|---|---|---|---|
| `tsunami/evac-now/2` | 津波注意報 (62) | 津波なし (00) | 津波注意報 |
| `tsunami/evac-now/3` | 津波警報 (51) | 津波なし (00) | 津波警報 |
| `tsunami/evac-now/4` | 大津波警報：発表 (53) | 津波なし (00) | 大津波警報 |
| `tsunami/all-clear/1` | 津波注意報解除 (60) | 津波注意報 (62) | 津波予報 |

The synthetic bulletin is saved under `data/synthetic/` (not in the repository) and is never delivered: its screens stand for their class in an approval.
