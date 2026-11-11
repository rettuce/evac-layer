# Templates for synthetic bulletins

Unmodified official sample bulletins from 気象庁防災情報 XML (Japan Meteorological Agency disaster-prevention XML, https://xml.kishou.go.jp/ ), from `jmaxml_20260917_Samples.zip` (retrieved 2026-10-19), the same files as in `agents/test/fixtures/jma/jma-samples/`.

出典：気象庁ホームページ（https://xml.kishou.go.jp/ ）

Terms: 気象庁ホームページ利用規約 https://www.jma.go.jp/jma/kishou/info/coment.html (公共データ利用規約 第 1.0 版, compatible with CC BY 4.0). They are official samples, not current warnings.

| File | Used for |
|---|---|
| `15_17_01_251222_VPWW55.xml` | 気象警報・注意報（Ｒ０６）（大雨）: the heavy-rain classes |
| `15_17_01_251222_VPWW56.xml` | 気象警報・注意報（Ｒ０６）（土砂）: the landslide classes |

`agents/src/jma/synthetic.ts` reads them to compose a synthetic bulletin for one municipality and one class: it keeps the sample's Control and Head, sets the municipality, its prefecture and the warning kind, and drops every other area, the headline text and the free-text comments. The synthetic bulletin is saved under `data/synthetic/` (not in the repository) and is never delivered: its screens stand for their class in an approval.
