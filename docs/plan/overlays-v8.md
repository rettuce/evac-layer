# demo v8 オーバーレイ一覧（DaVinci 用・brand 席 B-5・2026-11-05）

Figma: IE3 team「作業」ファイル → ページ「v8 overlays」 https://www.figma.com/design/H213MoFcJtIZ96s6qdmBZ8/?node-id=3244-4
PNG: `demo/compose/overlays/ov-<cut>-<kind>-<n>.png`（1920×1080・RGBA 透過・1x・Figma MCP の export）。文言の正本は `docs/plan/demo-v8-text.md`（copy 席・2026-11-05）。司令官の指示で cut 0 は置き換え案、cut 5b は 41 字の短縮版、cut 9 は「表示できます」版。

## 共通の体裁

| kind | 書体・サイズ | 置き方 |
|---|---|---|
| subtitle | 日本語 Noto Sans JP Bold 44 px（行送り 60）／英語 Public Sans SemiBold 32 px（行送り 42）。白文字 | 黒 55% の帯（左右 32・上下 20 px・角丸なし）に日本語の下に英語。中央揃え。帯の下端が画面下端から 72 px。最大幅 1600 px |
| telop | 日本語 Noto Sans JP Bold 72 px／英語 Public Sans Bold 48 px。白文字＋ドロップシャドウ（黒 60%・ぼかし 24・y 4）。帯なし | 画面中央（縦横とも）。2 行（日本語の下に英語） |
| telop（0b） | Public Sans Bold 120 px・字間 -2%（ロゴ規則） | 画面中央 |
| telop（10） | URL Public Sans Bold 64 px／メール Public Sans SemiBold 48 px | 画面中央 |
| logo | `docs/brand/evac-layer-lockup-run-black.svg` の背景矩形を外して読み込み。幅 1190 px（原寸 2380 の 1/2） | 画面中央。菱形の内側の黒塗りは残してある（黒地のエンドカード前提。黒以外の背景に置くと菱形の内側が黒く出る） |

## 一覧

| ファイル | cut | kind | 文言 ja | 文言 en | Figma node |
|---|---|---|---|---|---|
| ov-0-subtitle-1.png | 0 | subtitle | 2026.10.21 15:55 子吉川 氾濫警報（警戒レベル3）発表・由利本荘市 | 2026.10.21 15:55 Flood warning issued for the Koyoshi River (Alert Level 3), Yurihonjo | 3244:5 |
| ov-0b-subtitle-1.png | 0b | subtitle | EVAC LAYER は、いまある既存のサイネージに、／災害時の緊急案内のレイヤーを自動で追加するシステムです。 | EVAC LAYER adds an emergency-guidance layer to the signage a city already has,／automatically, when disaster strikes. | 3244:9 |
| ov-0b-telop-1.png | 0b | telop | EVAC LAYER | EVAC LAYER | 3244:49 |
| ov-1-subtitle-1.png | 1 | subtitle | 2024.1.1 能登半島地震。／どこへ逃げればよいか判断が難しかった来訪者がいました（上越市の検証） | 1 Jan 2024. The Noto Peninsula earthquake.／Some visitors could not tell where to evacuate (City of Joetsu review) | 3244:13 |
| ov-2-subtitle-1.png | 2 | subtitle | 私はこれまで駅や街のサイネージシステムを作ってきました。／これらは災害のとき、能動的に情報を発信できませんでした。 | I have built signage systems for stations and streets.／When disaster struck, none of them could speak up on its own. | 3244:17 |
| ov-2b-telop-1.png | 2b | telop | 街中にスクリーンがあります。／それらは自分の位置関係を知っています。 | Screens are all over the city.／Each one knows where it stands. | 3244:52 |
| ov-3-subtitle-1.png | 3 | subtitle | 災害の種類と警戒レベル。アイコンと10の言語。／そして、どんな形のスクリーンにも、適切なレイアウトで描きます。 | Hazard types and alert levels. Icons and ten languages.／And for a screen of any shape, a layout that fits. | 3245:4 |
| ov-4-subtitle-1.png | 4 | subtitle | 避難情報案内は自動作成され、人が事前承認したものだけが、／警報が届いた瞬間に表示されます。 | Evacuation guidance is generated automatically.／Only what a person has approved in advance is shown, the moment a warning arrives. | 3244:21 |
| ov-5c-subtitle-1.png | 5c | subtitle | 同じ警報でも、スクリーンの位置が違えば、／避難先も方向も距離も適切に表示されます。 | Same warning, different place.／The shelter, the direction and the distance follow where the screen stands. | 3244:25 |
| ov-5-subtitle-1.png | 5 | subtitle | 由利本荘市、10月21日の実際に発令された警報データを使い、／1200倍の速さで再生しています。 | Yurihonjo City, October 21.／Real warnings, replayed at 1,200 times speed. | 3244:29 |
| ov-5-subtitle-2.png | 5 | subtitle | 警戒レベル3、4、5。すべてのスクリーンが、同じ瞬間に切り替わります。 | Alert levels 3, 4 and 5. Every screen switches at the same moment. | 3244:33 |
| ov-5b-subtitle-1.png | 5b | subtitle | 何を出すかは、事前に人が確認できます。／承認しておけば、有事に自動で避難案内に切り替わります。 | What to show can be checked in advance.／Approve it once, and when the time comes the screens switch to evacuation guidance by themselves. | 3244:37 |
| ov-7m-subtitle-1.png | 7m | subtitle | まずは事前収集した5つの自治体の206本の気象警報から、／110種類のレイアウトを作成します。 | To begin with, 206 weather warnings collected from five municipalities／become 110 layouts. | 3244:41 |
| ov-9-telop-1.png | 9 | telop | どのスクリーンにも | Any screen. | 3244:56 |
| ov-9-subtitle-1.png | 9 | subtitle | 信号を受け取れる仕組みがあれば、どんな場所のどのスクリーンにも、／自動で災害情報を表示できます。 | Anything that can receive the signal can show the disaster information automatically,／in any place, on any screen. | 3244:45 |
| ov-10-telop-1.png | 10 | telop | github.com/rettuce/evac-layer／you@ie3.jp | （同左） | 3244:60 |
| ov-10-subtitle-1.png | 10 | subtitle | EVAC LAYERは、オープンソースで公開しています。 | EVAC LAYER is open source. | 3245:8 |
| ov-end-logo-1.png | end | logo | （ロゴ lockup run） | — | 3244:64 |

「／」は改行。cut 8 はナレーション・字幕なしのため無し。cut 5 は 25 s のため字幕を 2 枚に分割（切り替え位置は demo 席の overlays-v8.csv に合わせる）。

## 文言の差分メモ（demo-v8-text.md に対して）

- cut 5b の英語は短縮版（41 字）に対応する確定訳が表に無いため、表の長文版の英語をそのまま使用。copy 席の短縮版訳が出たら差し替える
- cut 5 の字幕 ja「発令」は表のまま（copy 席の指摘 1「発表」が正確。田中判断待ち）
- cut 4「避難情報案内」は表のまま（指摘 3 田中判断待ち）
- 田中 FB の「you@ie3」は表どおり「you@ie3.jp」で作成

## 再書き出しの手順

Figma のページ「v8 overlays」で該当フレームの文字を直し、フレームを選択して Export（PNG・1x・設定済み）。ファイル名はフレーム名と同じ。Figma MCP からは `download_assets` で nodeId ごとに取得できる。
