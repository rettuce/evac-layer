# JMA bulletins for the tests

Unmodified XML from 気象庁防災情報 XML (Japan Meteorological Agency disaster-prevention XML, https://xml.kishou.go.jp/ ). The file names and the folder layout are the same as in `EVAC_RAW_DIR`, so the tests read them when no raw data is configured.

出典：気象庁ホームページ（https://xml.kishou.go.jp/ ）

Terms: 気象庁ホームページ利用規約 https://www.jma.go.jp/jma/kishou/info/coment.html (公共データ利用規約 第 1.0 版, compatible with CC BY 4.0). These are past bulletins and official samples kept for tests. They are not current warnings.

| Folder | What | Retrieved |
|---|---|---|
| `jma-samples/` | 11 official sample bulletins from `jmaxml_20260917_Samples.zip`: the 島根県 heavy-rain and landslide samples (VPWW55/56), two flood forecasts and a flood clearance (VXKOii), and the 2016-09-01 tsunami drill series that the 吉田町 and 輪島市 demos use (VTSE41) | 2026-10-19 |
| `jma-feed/bodies/20261021/` | 11 bulletins recorded from the JMA long feed: the nine 子吉川 flood forecasts for 由利本荘市 (VXKO55, 11:45 → 10-22 06:20, including Lv3 15:55, Lv4 18:15, Lv5 19:45 and the clearance) and two 石川県 heavy-rain/landslide bulletins (VPWW55/56) | 2026-10-21 |
| `jma-feed/bodies/20261031/` | 3 新潟県 landslide bulletins recorded from the JMA long feed (VPWW56): the two Lv4 screens and the clearance of the 柏崎市 demo | 2026-10-31 |
