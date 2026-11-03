# ナレーション録音台本

1. 静かな部屋で、外付けマイクで録る（エアコン・PC のファンを止める）
2. 1 カット 1 ファイル。ファイル名は下の表のとおり `demo/compose/audio/narration/` に置く
3. WAV・48 kHz・モノラルが既定（違う形式でも `mix_audio.py` が変換する）
4. 文末で 0.5 秒置いてから止める。「使える秒数」を超えないこと
5. 言い直したら最後のテイクだけ残す（ファイルを上書きする）

`demo/compose/edl.json` の `narration_ja` から `subtitles.py` が生成する。話速 300 字/分（5 字/秒）で、そのカットの開始から次にナレーションのあるカットの開始までを「使える秒数」とし、上限の字数を示す。置いたファイルは `mix_audio.py` がそのカットの開始秒に載せる。

| ファイル名 | 読み上げ文 | 使える秒数 | 字数／上限 |
|---|---|---|---|
| `narration/cut01.wav` | 2024年1月1日、能登半島地震。どこへ逃げればよいか、判断が難しかった来訪者がいました。 | 15 s（0 s から） | 45／75 |
| `narration/cut02.wav` | 駅と街のスクリーンを作ってきました。災害のとき、そのスクリーンは何も言いませんでした。 | 13 s（15 s から） | 43／65 |
| `narration/cut02b.wav` | 黙らないスクリーンを。スクリーンは、もうあります。 | 14 s（28 s から） | 25／70 |
| `narration/cut03.wav` | 自治体のハザードマップを読みます。文字の壊れた PDF は画像から読み直し、どの数字にも出典のページが付きます。 | 12 s（42 s から） | 54／60 |
| `narration/cut04.wav` | スクリーンは自分の位置を知っています。そこから市町村と、最寄りの避難場所を引きます。警報が届くと、やさしい日本語と英語・中国語・韓国語の文を書き、5 つのスクリーンの形に割り付けます。 | 12 s（54 s から） | 91／60（超過） |
| `narration/cut05c.wav` | 同じ警報でも、場所が違えば行き先も方向も違います。駅前は南西へ 570 m、もう一つの場所は東へ 160 m。 | 10 s（66 s から） | 51／50（超過） |
| `narration/cut05.wav` | 由利本荘市、10 月 21 日の実際の電文を 1200 倍で再生します。警戒レベル 3、4、5。すべてのスクリーンが同じ瞬間に切り替わります。 | 25 s（76 s から） | 65／125 |
| `narration/cut05b.wav` | 何を出すかは、平時に人が決めます。承認した案内だけが、有事に自動で出ます。 | 10 s（101 s から） | 37／50 |
| `narration/cut06.wav` | 生成した案内は、検査役が画像で読みます。方向の欄に距離が重なっていれば差し戻し、直した版が通るまで出しません。 | 10 s（111 s から） | 55／50（超過） |
| `narration/cut07.wav` | 5 つの自治体、198 本の電文。画面を出す 16 本から、80 のレイアウトを作りました。検査が見つけた 41 件の問題は、すべて直しています。 | 15 s（121 s から） | 66／75 |
| `narration/cut07b.wav` | 5 つの自治体。それぞれの資料から、それぞれの場所の案内を作りました。 | 10 s（136 s から） | 34／50 |
| `narration/cut08.wav` | 柱も、壁も、通路の上のスクリーンも、同じ警報を同時に出します。近づくと、出典が読めます。 | 18 s（146 s から） | 44／90 |
| `narration/cut09.wav` | フィードを受け取れれば、どの CMS でも。どの画面にも。 | 15 s（164 s から） | 27／75 |

## 英訳（字幕用）

- 1: January 1, 2024: the Noto Peninsula earthquake. Visitors found it hard to judge where to evacuate from the tsunami (City of Jōetsu review).
- 2: We have built screens for stations and streets. When disaster struck, those screens said nothing.
- 2b: Screens that don't go silent. The screens are already there.
- 3: It reads the city's hazard maps. A PDF with broken text is read again from the page image, and every figure carries its source page.
- 4: Each screen knows where it stands. From there it finds its municipality and the nearest evacuation site. When a warning arrives, it writes the text in easy Japanese, English, Chinese and Korean, and lays it out for five screen shapes.
- 5c: The same warning, but a different place means a different destination and direction: 570 m southwest from the station, 160 m east from the other site.
- 5: Real bulletins for Yurihonjo, October 21, replayed at 1200x. Alert levels 3, 4 and 5. Every screen switches at the same moment.
- 5b: People decide what to show, in calm times. Only approved guidance goes out, automatically, in a crisis.
- 6: An inspector reads each generated screen as an image. If the distance is duplicated in the direction cell, it is sent back, and nothing goes out until the fix passes.
- 7: Five municipalities, 198 bulletins. From the 16 that call for a screen, 80 layouts. All 41 problems the inspection found have been fixed.
- 7b: Five municipalities. From each one's own documents, guidance for each place.
- 8: Columns, walls and the screen over the passage show the same warning at once. Step closer and the sources are readable.
- 9: Any CMS that can read the feed. Any screen.
