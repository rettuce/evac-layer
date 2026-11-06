# demo v8 オーバーレイ一覧（DaVinci 用・brand 席 B-5・2026-11-05）

Figma: IE3 team「作業」ファイル → ページ「v8 overlays」 https://www.figma.com/design/H213MoFcJtIZ96s6qdmBZ8/?node-id=3244-4
PNG: `demo/compose/overlays/ov-<cut>-<kind>-<n>.png`（1920×1080・RGBA 透過・1x・Figma MCP の export）。**文言の正本は Figma「v8 overlays」のテキストレイヤー**（2026-11-05 14:3x に田中が直接修正。B-8）。それ以前の正本だった `docs/plan/demo-v8-text.md` との差分は末尾「田中修正の差分」節。

## 共通の体裁

| kind | 書体・サイズ | 置き方 |
|---|---|---|
| subtitle | 日本語 Noto Sans JP Bold 44 px（行送り 60）／英語 Public Sans SemiBold 32 px（行送り 42）。白文字 | 黒 55% の帯（左右 32・上下 20 px・角丸なし）に日本語の下に英語。中央揃え。帯の下端が画面下端から 72 px。最大幅 1600 px |
| telop | 日本語 Noto Sans JP Bold 72 px／英語 Public Sans Bold 48 px。白文字＋ドロップシャドウ（黒 60%・ぼかし 24・y 4）。帯なし | 画面中央（縦横とも）。2 行（日本語の下に英語） |
| telop（2） | telop と同じ | 左上・左揃え。テロップのブロックの左上が画面の左上から 96 px（x 96・y 96） |
| telop（2b の見出し） | IDEA: Barlow Semi Condensed SemiBold 132 px・行送り 108・字間 +20%・大文字・#C83CC8（警戒レベル 4 の #AA00AA と同じ色相で明度を上げた色）。本文と同じドロップシャドウ | 本文 ja 1 行目の上、中央。字面どうしの空き 59 px。字面の左右中心を画面中心 960 に合わせる（右に 6 px の余白で補正）。ブロック全体の字面の上下余白 149／148 px。日英共通で 1 つ |
| telop（0b） | Public Sans Bold 120 px・字間 -2%（ロゴ規則） | 画面中央 |
| telop（10） | URL Public Sans Bold 64 px／メール Public Sans SemiBold 48 px | 画面中央 |
| logo | `docs/brand/evac-layer-lockup-run-black.svg` の背景矩形を外して読み込み。幅 1190 px（原寸 2380 の 1/2） | 画面中央。菱形の内側の黒塗りは残してある（黒地のエンドカード前提。黒以外の背景に置くと菱形の内側が黒く出る） |

## 一覧

| ファイル | cut | kind | 文言 ja | 文言 en | Figma node |
|---|---|---|---|---|---|
| ov-0-subtitle-1.png | 0 | subtitle | 2026.10.21 15:55 子吉川 氾濫警報（警戒レベル3）発表・由利本荘市 | 2026.10.21 15:55 Flood warning issued for the Koyoshi River (Alert Level 3), Yurihonjo | 3244:5 |
| ov-0b-subtitle-1.png | 0b | subtitle | EVAC LAYER は、いまある既存のサイネージに、／災害時の緊急案内のレイヤーを自動で追加するシステムです。 | EVAC LAYER is a system that automatically adds ／an emergency evacuation guidance layer to existing signage. | 3244:9 |
| ov-0b-telop-1.png | 0b | telop | EVAC LAYER | EVAC LAYER | 3244:49 |
| ov-1-subtitle-1.png | 1 | subtitle | 2024.1.1 能登半島地震。／どこへ逃げればよいか判断が難しかった来訪者がいました（上越市の検証） | 1 Jan 2024. The Noto Peninsula earthquake.／Some visitors could not tell where to evacuate (City of Joetsu review) | 3244:13 |
| ov-2-subtitle-1.png | 2 | subtitle | 私はこれまで、駅や商業施設など街の公共空間のサイネージを、／10年以上作ってきました。 | For more than ten years, I have built signage／for public spaces in cities, such as stations and shopping centers. | 3244:17 |
| ov-2-subtitle-2.png | 2 | subtitle | しかし、それらは災害時、／自分から情報を能動的に出すことができませんでした。 | Yet during disasters,／these systems could not actively put out information on their own. | 3294:4 |
| ov-2-telop-1.png | 2 | telop（左上） | 公共空間のサイネージを10年以上 | Public-space signage, 10+ years | 3294:8 |
| ov-2b-telop-1.png | 2b | telop（見出し IDEA 付き） | IDEA／街中にあるスクリーン。／それらが自分の位置を知り、／災害時に適切な避難情報を出す。／そんなハックができないか？ | Screens all over the city.／What if each one knew where it stands／and showed the right evacuation information in a disaster?／Could we hack that? | 3244:52 |
| ov-3-subtitle-1.png | 3 | subtitle | 災害の種類と警戒レベル。アイコンと10の言語。／そして、どんな形のスクリーンにも、適切なレイアウトで描きます。 | Hazard types and alert levels. Icons and ten languages.／And for a screen of any shape, a layout that fits. | 3245:4 |
| ov-4-subtitle-1.png | 4 | subtitle | 避難案内は自動作成され、人が事前承認したものだけが、／警報が届いた瞬間に表示されます。 | Evacuation guidance is generated automatically. Only what a person has approved in advance／is shown, the moment a warning arrives. | 3244:21 |
| ov-5c-subtitle-1.png | 5c | subtitle | 同じ警報でも、スクリーンの位置が違えば、／避難先も方向も距離も適切な情報となって表示されます。 | Same warning, different place.／The shelter, the direction and the distance follow where the screen stands. | 3244:25 |
| ov-5-subtitle-1.png | 5 | subtitle | 10月21日に由利本荘市で実際に発表された警報です。 | This is a real warning, issued for Yurihonjo City on October 21. | 3244:29 |
| ov-5-subtitle-2.png | 5 | subtitle | 当日、警戒レベル3、4、5と変化していく中で、／すべてのスクリーンが、同じ瞬間に切り替わっていきます。 | That day, as the alert level rose from 3 to 4 to 5,／every screen switched at the same moment. | 3244:33 |
| ov-5b-subtitle-1.png | 5b | subtitle | 何を出すかは、事前に人が確認できます。／承認しておけば、有事の際に自動で避難案内に切り替わります。 | What to show can be checked in advance.／Approve it once, and the screens switch to evacuation guidance by themselves. | 3244:37 |
| ov-7m-subtitle-1.png | 7m | subtitle | まずは3週間で事前収集した、5つの自治体での206本の気象庁の電文から、／110のレイアウトを作成しました。 | First, we created 110 layouts from 206 Japan Meteorological Agency telegrams ／collected in advance across five municipalities over three weeks. | 3244:41 |
| ov-9-telop-1.png | 9 | telop | どのスクリーンにも | Any screen. | 3244:56 |
| ov-9-subtitle-1.png | 9 | subtitle | 信号を受け取れる仕組みがあれば、どの場所のどんなスクリーンにも、／自動で災害情報を表示できます。 | If there is a system capable of receiving signals, ／disaster information can be automatically displayed on any screen anywhere. | 3244:45 |
| ov-10-telop-1.png | 10 | telop | github.com/rettuce/evac-layer／you@ie3.jp | （同左） | 3244:60 |
| ov-10-subtitle-1.png | 10 | subtitle | EVAC LAYERは、オープンソースで公開しています。 | EVAC LAYER is open source. | 3245:8 |
| ov-end-logo-1.png | end | logo | （ロゴ lockup run） | — | 3244:64 |

「／」は改行。cut 8 はナレーション・字幕なしのため無し。cut 5 は 25 s のため字幕を 2 枚に分割（切り替え位置は demo 席の overlays-v8.csv に合わせる）。

## 文言の差分メモ（B-8 以前の経緯）

- 2026-11-05 田中承認（司令官経由）で cut 4「避難案内」・cut 5「発表」・cut 7m「気象庁の電文／110のレイアウト」に差し替え（copy 席の指摘 1〜3）。英訳は copy 席の確定版
- cut 5b は短縮版（日本語 46 字・copy 席の英訳）。目安内の 39 字版に変える判断が出たら日英とも差し替える
- 田中 FB の「you@ie3」は表どおり「you@ie3.jp」で作成

## 再書き出しの手順

Figma のページ「v8 overlays」が文言の正本。該当フレームの文字を直し、フレームを選択して Export（PNG・1x・設定済み）。ファイル名はフレーム名と同じ。Figma MCP からは `download_assets` で nodeId ごとに取得できる。

## 田中修正の差分（2026-11-05 B-8・旧 = 28ca1ad 時点の本表、新 = Figma）

件数: 8（フレーム 5 枚）。比較は旧表を git から読み、Figma のテキストレイヤーと文字列一致で機械判定。

| フレーム | 言語 | 旧 | 新 |
|---|---|---|---|
| ov-0b-subtitle-1 | en | EVAC LAYER adds an emergency-guidance layer to the signage a city already has,／automatically, when disaster strikes. | EVAC LAYER is a system that automatically adds ／an emergency evacuation guidance layer to existing signage. |
| ov-2-subtitle-1 | en | I have built signage systems for stations and streets.／When disaster struck, none of them could speak up on its own. | I have previously developed signage systems for stations and city streets.／During disasters, these systems were unable to actively disseminate information. |
| ov-5-subtitle-1 | ja | 由利本荘市、10月21日の実際に発表された警報データを使い、／1200倍の速さで再生しています。 | 10月21日 由利本荘市で実際に発表された警報データを使い、／1200倍の速さでシミュレートしています。 |
| ov-5-subtitle-1 | en | Yurihonjo City, October 21.／Warnings actually issued that day, replayed at 1,200 times speed. | Using actual warning data issued in Yurihonjo City on October 21,／this is simulated at 1200x speed. |
| ov-7m-subtitle-1 | ja | まずは事前収集した5つの自治体の206本の気象庁の電文から、／110のレイアウトを作成します。 | まずは3週間で事前収集した、5つの自治体での206本の気象庁の電文から、／110のレイアウトを作成しました。 |
| ov-7m-subtitle-1 | en | To begin with, 206 JMA bulletins collected from five municipalities／become 110 layouts. | First, we created 110 layouts from 206 Japan Meteorological Agency telegrams ／collected in advance across five municipalities over three weeks. |
| ov-9-subtitle-1 | ja | 信号を受け取れる仕組みがあれば、どんな場所のどのスクリーンにも、／自動で災害情報を表示できます。 | 信号を受け取れる仕組みがあれば、どの場所のどんなスクリーンにも、／自動で災害情報を表示できます。 |
| ov-9-subtitle-1 | en | Anything that can receive the signal can show the disaster information automatically,／in any place, on any screen. | If there is a system capable of receiving signals, ／disaster information can be automatically displayed on any screen anywhere. |

2026-11-05 B-9: cut 5 ja「シュミレート」は誤記として Figma 側で「シミュレート」に修正（司令官指示）。英語 3 行（0b・7m・9）の行末空白も Figma 側で除去。B-10（田中決定）: cut 7m「半月間で」→「3週間で」（B-11: 同じ文の「5つ」「206本」に合わせ数字の前後に空白なし）・"over a half-month period" → "over three weeks"。

2026-11-06 C-11（田中確定 02:0x）: cut 2 の字幕を新しいナレーションに合わせて差し替え、尺は 8 → 15 s。Figma の更新は brand 席。字幕は文ごとに 2 枚（各 2 行）: `ov-2-subtitle-1`「私はこれまで、駅や商業施設など街の公共空間のサイネージを、／10年以上設計し、納めてきました。」"For more than ten years, I have designed and installed signage／for public spaces in cities, such as stations and shopping centers."、`ov-2-subtitle-2`「しかし、それらは災害のとき、／自分から情報を出すことができませんでした。」"Yet during disasters,／these systems could not put out information on their own."。テロップ `ov-2-telop-1`（左上・1.0〜7.5 s）「公共空間のサイネージを10年以上」"Public-space signage, 10+ years"。

2026-11-06 B-15（田中変更 03:5x）: cut 5c の ja を「…避難先も方向も距離も適切に表示されます。」→「…適切な情報となって表示されます。」に。en は変更なし。

2026-11-06 B-16（田中が録音時に変更）: cut 5 の 2 文目を差し替え。ja「警戒レベル3、4、5。すべてのスクリーンが、同じ瞬間に切り替わります。」→「当日、警戒レベル3、4、5と変化していく中で、／すべてのスクリーンが、同じ瞬間に切り替わっていきます。」、en "Alert levels 3, 4 and 5. Every screen switches at the same moment." → "That day, as the alert level rose from 3 to 4 to 5,／every screen switched at the same moment."。1 行 → 2 行で帯の高さが 150 → 252 px（下端は画面下から 72 px のまま）。

2026-11-06 B-17（田中が録音時に変更）: cut 5b の ja 2 行目「有事に」→「有事の際に」。1 行目と en は変更なし。

2026-11-06 B-18（田中確定・1200 倍の再生をやめたため）: cut 5 の 1 文目を差し替え。ja「10月21日 由利本荘市で実際に発表された警報データを使い、／1200倍の速さでシミュレートしています。」→「10月21日に由利本荘市で実際に発表された警報です。」、en "Using actual warning data issued in Yurihonjo City on October 21,／this is simulated at 1200x speed." → "This is a real warning, issued for Yurihonjo City on October 21."。2 行 → 1 行で帯の高さが 252 → 150 px（下端は画面下から 72 px のまま）。

2026-11-06 B-19（田中が録音時に変更）: cut 2 の字幕 2 枚を差し替え。subtitle-1 ja「10年以上設計し、納めてきました。」→「10年以上作ってきました。」・en "I have designed and installed signage" → "I have built signage"。subtitle-2 ja「災害のとき、／自分から情報を出すことが…」→「災害時、／自分から情報を能動的に出すことが…」・en "could not put out" → "could not actively put out"。帯の高さは 2 枚とも 252 px のまま。

2026-11-06 B-20（田中確定・11:4x に見出し追加）: cut 2b のテロップを問いの形に差し替え、見出し「IDEA」を追加。依頼は ja 3 行だったが、2 行目「それらが自分の位置を知り、災害時に適切な避難情報を出す。」は 72 px で 2006 px になり画面幅 1920 を超えるため、「知り、」の後で割って 4 行にした（字級は現行のまま）。en も 2 行目を "…where it stands" の後で割って 4 行。代案（ja 3 行のまま 56 px）は Figma の ov-2b-telop-1-alt-ja56（3325:14）に残してある。

2026-11-06 B-21（田中 12:0x）: 2b テロップは 72 px・4 行の案で確定（alt-ja56 は不採用・Figma に残置）。見出し IDEA を 29 px 白 → 44 px・#AA00AA に変更。明度だけ上げた比較案 #C83CC8 は Figma の ov-2b-telop-1-alt-C83CC8（3328:4）に残してある。黒地とのコントラスト比は #AA00AA 3.29:1、#C83CC8 4.94:1。

2026-11-06 B-22（田中 12:2x）: IDEA は #C83CC8 で確定、44 → 132 px。ブロックを縦中央に組み直し（132 px で 1080 に収まったので 120 px への縮小は不要）。書き出し画像を測ると、Figma は最後の文字の後ろに字間を付けておらず、B-20・B-21 の左余白はかえって字面を右へずらしていた。今回は測定値に合わせて右に 6 px の余白を置き、字面の中心を 960 にそろえた。
