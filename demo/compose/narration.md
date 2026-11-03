# ナレーション録音台本

1. 静かな部屋で、外付けマイクで録る（エアコン・PC のファンを止める）
2. 1 カット 1 ファイル。ファイル名は下の表のとおり `demo/compose/audio/narration/` に置く
3. WAV・48 kHz・モノラルが既定（違う形式でも `mix_audio.py` が変換する）
4. 文末で 0.5 秒置いてから止める。「使える秒数」を超えないこと
5. 言い直したら最後のテイクだけ残す（ファイルを上書きする）

`demo/compose/edl.json` の `narration_ja` から `subtitles.py` が生成する。話速 300 字/分（5 字/秒）で、そのカットの開始から次にナレーションのあるカットの開始までを「使える秒数」とし、上限の字数を示す。置いたファイルは `mix_audio.py` がそのカットの開始秒に載せる。

| ファイル名 | 読み上げ文 | 使える秒数 | 字数／上限 |
|---|---|---|---|
| `narration/cut01.wav` | 2024年1月1日、能登半島地震。どこへ逃げればよいか、判断が難しかった来訪者がいました。 | 10 s（0 s から） | 45／50 |
| `narration/cut02.wav` | 駅と街のスクリーンを作ってきました。災害のとき、それは何も言いませんでした。 | 8 s（10 s から） | 38／40 |
| `narration/cut02b.wav` | 黙らないスクリーンを。スクリーンは、もうあります。 | 9 s（18 s から） | 25／45 |
| `narration/cut03.wav` | 災害の種類とレベル、図記号と言語、そしてどんな形のスクリーンにも、同じ規則で出します。 | 12 s（27 s から） | 43／60 |
| `narration/cut04.wav` | 平時に資料を読み、警報が届けば文を書き、検査を通った案内だけを、承認どおりに配信します。 | 10 s（39 s から） | 44／50 |
| `narration/cut05c.wav` | 同じ警報でも、ディスプレイの場所が違えば、避難先も方向も距離も、自動で変わります。 | 14 s（49 s から） | 41／70 |
| `narration/cut05.wav` | 由利本荘市、10 月 21 日の実際の電文を 1200 倍で再生します。警戒レベル 3、4、5。すべてのスクリーンが同じ瞬間に切り替わります。 | 25 s（63 s から） | 65／125 |
| `narration/cut05b.wav` | 何を出すかは、平時に人が決めます。承認した案内だけが、有事に自動で出ます。 | 8 s（88 s から） | 37／40 |
| `narration/cut07.wav` | 5 つの自治体、199 本の電文から、80 のレイアウト。 | 6 s（96 s から） | 26／30 |
| `narration/cut07b.wav` | それぞれの自治体の資料から、それぞれの場所の案内を。 | 8 s（102 s から） | 26／40 |
| `narration/cut08.wav` | 柱も、壁も、通路の上のスクリーンも、同じ警報を同時に出します。近づくと、出典が読めます。 | 20 s（110 s から） | 44／100 |
| `narration/cut09.wav` | フィードを受け取れれば、どの CMS でも。どの画面にも。 | 10 s（130 s から） | 27／50 |
| `narration/cut10.wav` | EVAC LAYER は、オープンソースで公開しています。 | 8 s（140 s から） | 27／40 |

## 英訳（字幕用）

- 1: January 1, 2024: the Noto Peninsula earthquake. Visitors found it hard to judge where to evacuate from the tsunami (City of Jōetsu review).
- 2: We have built screens for stations and streets. When disaster struck, they said nothing.
- 2b: Screens that don't go silent. The screens are already there.
- 3: Hazard types and levels, pictograms and languages, and screens of any shape, all under the same rules.
- 4: It reads the documents in calm times, writes when a warning arrives, and sends only checked guidance, as approved.
- 5c: The same warning, but where the display stands changes the shelter, the direction and the distance, automatically.
- 5: Real bulletins for Yurihonjo, October 21, replayed at 1200x. Alert levels 3, 4 and 5. Every screen switches at the same moment.
- 5b: People decide what to show, in calm times. Only approved guidance goes out, automatically, in a crisis.
- 7: Five municipalities, 199 bulletins, 80 layouts.
- 7b: Each from its own municipality's documents, for its own place.
- 8: Columns, walls and the screen over the passage show the same warning at once. Step closer and the sources are readable.
- 9: Any CMS that can read the feed. Any screen.
- 10: EVAC LAYER is open source.
