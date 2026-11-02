# ナレーション台本（下書き）

`demo/compose/edl.json` の `narration_ja` / `narration_en` から `subtitles.py` が生成する。話速 300 字/分（5 字/秒）で、そのカットの開始から次にナレーションのあるカットの開始までに収まるかを「字数／上限」で示す。録音は `demo/compose/audio/narration.wav`（全長 179 s・-18 LUFS 目安）として置けば `mix_audio.py` が載せる。

| カット | 開始 | 使える秒数 | 読み上げ文 | 字数／上限 | テロップ |
|---|---|---|---|---|---|
| 1 | 0 s | 10 s | 2024年1月1日、能登半島地震。津波の避難先を判断できなかった来訪者がいました。 | 41／50 | 2024.1.1 能登半島地震。 / 津波の避難先を判断できなかった来訪者がいた |
| 2 | 10 s | 10 s | 駅と街のスクリーンを作ってきました。災害のとき、そのスクリーンは何も言いませんでした。 | 43／50 | 駅と街のスクリーンを作ってきた。 / 災害のとき、このスクリーンは何も言わなかった |
| 2b | 20 s | 6 s | 黙らないスクリーンを。スクリーンは、もうあります。 | 25／30 | 黙らない画面 / Screens that don't go silent |
| 3 | 26 s | 25 s | まず、自治体のハザードマップを読みます。文字の壊れた PDF は止めて、ページの画像から読み直します。輪島の最大津波高は 8.3 m。どの数字にも出典のページが付きます。 | 81／125 |  |
| 4 | 51 s | 20 s | 警報が届くと、やさしい日本語と英語・中国語・韓国語の文を書き、5 つのスクリーンの形に割り付けます。 | 49／100 |  |
| 5 | 71 s | 25 s | 由利本荘市、10 月 21 日の実際の電文を 1200 倍で再生します。警戒レベル 3、4、5。すべてのスクリーンが同じ瞬間に切り替わります。 | 65／125 |  |
| 5b | 96 s | 10 s | 何を出すかは、平時に人が決めます。承認した案内だけが、有事に自動で出ます。 | 37／50 | 平時に決めて、有事は自動 / Decide in calm. Deliver in crisis. |
| 6 | 106 s | 20 s | 生成した案内は、検査役が画像で読みます。方向の欄に距離が重なっていれば差し戻し、直した版が通るまで出しません。 | 55／100 |  |
| 7 | 126 s | 25 s | 5 つの自治体、198 本の電文。画面を出す 16 本から、80 のレイアウトを作りました。検査が見つけた 41 件の問題は、すべて直しています。 | 66／125 |  |
| 8 | 151 s | 18 s | 柱も、壁も、通路の上のスクリーンも、同じ警報を同時に出します。近づくと、出典が読めます。 | 44／90 |  |
| 9 | 169 s | 10 s | フィードを受け取れれば、どの CMS でも。どの画面にも。 | 27／50 | どの画面にも / Any screen. |

## 英訳（字幕用）

- 1: January 1, 2024: the Noto Peninsula earthquake. Some visitors could not tell where to flee from the tsunami.
- 2: We have built screens for stations and streets. When disaster struck, those screens said nothing.
- 2b: Screens that don't go silent. The screens are already there.
- 3: First, it reads the city's hazard maps. A PDF with broken text is stopped and read again from the page image. Wajima's maximum tsunami height: 8.3 m. Every figure carries its source page.
- 4: When a warning arrives, it writes the text in easy Japanese, English, Chinese and Korean, and lays it out for five screen shapes.
- 5: Real bulletins for Yurihonjo, October 21, replayed at 1200x. Alert levels 3, 4 and 5. Every screen switches at the same moment.
- 5b: People decide what to show, in calm times. Only approved guidance goes out, automatically, in a crisis.
- 6: An inspector reads each generated screen as an image. If the distance is duplicated in the direction cell, it is sent back, and nothing goes out until the fix passes.
- 7: Five municipalities, 198 bulletins. From the 16 that call for a screen, 80 layouts. All 41 problems the inspection found have been fixed.
- 8: Columns, walls and the screen over the passage show the same warning at once. Step closer and the sources are readable.
- 9: Any CMS that can read the feed. Any screen.
