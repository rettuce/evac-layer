# ナレーション録音台本

1. 静かな部屋で、外付けマイクで録る（エアコン・PC のファンを止める）
2. 1 カット 1 ファイル。ファイル名は下の表のとおり `demo/compose/audio/narration/` に置く
3. WAV・48 kHz・モノラルが既定（違う形式でも `mix_audio.py` が変換する）
4. 文末で 0.5 秒置いてから止める。「使える秒数」を超えないこと
5. 言い直したら最後のテイクだけ残す（ファイルを上書きする）

`demo/compose/edl.json` の `narration_ja` から `subtitles.py` が生成する。話速 300 字/分（5 字/秒）で、そのカットの開始から次にナレーションのあるカットの開始までを「使える秒数」とし、上限の字数を示す。置いたファイルは `mix_audio.py` がそのカットの開始秒に載せる。

| ファイル名 | 読み上げ文 | 使える秒数 | 字数／上限 | 読み方 |
|---|---|---|---|---|
| `narration/cut00.wav` | 本物の警報が届いた瞬間、スクリーンは、その場所の避難案内に変わります。 | 8 s（0 s から） | 35／40 | ほんものの けいほうが とどいた しゅんかん、スクリーンは、そのばしょの ひなんあんないに かわります |
| `narration/cut01.wav` | 2024年1月1日、能登半島地震。どこへ逃げればよいか、判断が難しかった来訪者がいました。 | 10 s（8 s から） | 45／50 | にせんにじゅうよねん いちがつ ついたち、のとはんとう じしん。どこへ にげれば よいか、はんだんが むずかしかった らいほうしゃが いました |
| `narration/cut02.wav` | 駅と街のスクリーンを作ってきました。災害のとき、どれも何も言いませんでした。黙らないスクリーンを。 | 12 s（18 s から） | 49／60 | えきと まちの スクリーンを つくってきました。さいがいの とき、どれも なにも いいませんでした。だまらない スクリーンを |
| `narration/cut03.wav` | 災害の種類と警戒レベル。図記号と10の言語。そして、どんな形のスクリーンにも、同じ規則で描きます。 | 12 s（30 s から） | 49／60 | さいがいの しゅるいと けいかいレベル。ずきごうと じゅうの げんご。そして、どんな かたちの スクリーンにも、おなじ きそくで えがきます |
| `narration/cut04.wav` | 平時に資料を読み、案内を書いて検査し、人が承認したものだけを、警報が届いた瞬間に出します。 | 10 s（42 s から） | 45／50 | へいじに しりょうを よみ、あんないを かいて けんさし、ひとが しょうにんした ものだけを、けいほうが とどいた しゅんかんに だします |
| `narration/cut05c.wav` | 同じ警報でも、ディスプレイの場所が違えば、避難先も方向も距離も、自動で変わります。 | 14 s（52 s から） | 41／70 | おなじ けいほうでも、ディスプレイの ばしょが ちがえば、ひなんさきも ほうこうも きょりも、じどうで かわります |
| `narration/cut05.wav` | 由利本荘市、10月21日の実際の電文を、1200倍の速さで再生します。警戒レベル3、4、5。すべてのスクリーンが、同じ瞬間に切り替わります。 | 25 s（66 s から） | 70／125 | ゆりほんじょうし、じゅうがつ にじゅういちにちの じっさいの でんぶんを、せんにひゃくばいの はやさで さいせいします。けいかいレベル さん、よん、ご。すべての スクリーンが、おなじ しゅんかんに きりかわります |
| `narration/cut05b.wav` | 何を出すかは、平時に人が決めます。承認した案内だけが、有事に自動で出ます。 | 8 s（91 s から） | 37／40 | なにを だすかは、へいじに ひとが きめます。しょうにんした あんないだけが、ゆうじに じどうで でます |
| `narration/cut07.wav` | 5つの自治体、206本の電文から、110のレイアウト。 | 6 s（99 s から） | 27／30 | いつつの じちたい、にひゃくろっぽんの でんぶんから、ひゃくじゅうの レイアウト（数字は凍結時の実数に差し替える） |
| `narration/cut07b.wav` | それぞれの自治体の資料から、それぞれの場所の案内を。 | 8 s（105 s から） | 26／40 | それぞれの じちたいの しりょうから、それぞれの ばしょの あんないを |
| `narration/cut08.wav` | 柱も、壁も、通路の上のスクリーンも、同じ警報を同時に出します。近づくと、気象庁の発表時刻と自治体名まで読めます。 | 15 s（113 s から） | 56／75 | はしらも、かべも、つうろの うえの スクリーンも、おなじ けいほうを どうじに だします。ちかづくと、きしょうちょうの はっぴょうじこくと じちたいめいまで よめます |
| `narration/cut09.wav` | フィードを受け取れれば、どのサイネージでも。どのスクリーンにも。 | 10 s（128 s から） | 32／50 | フィードを うけとれれば、どの サイネージでも。どの スクリーンにも |
| `narration/cut10.wav` | EVAC LAYERは、オープンソースで公開しています。 | 8 s（138 s から） | 27／40 | イーバック レイヤーは、オープンソースで こうかいしています |

## 別案（録音時に両方読んで選ぶ）

- 0: 本物の警報が届いた瞬間、スクリーンは、その場所の避難案内に。（30 字）

## 英訳（字幕用）

- 0: The moment a real warning arrives, the screen turns into guidance for this spot.
- 1: January 1, 2024: the Noto Peninsula earthquake. Visitors found it hard to judge where to evacuate from the tsunami (City of Jōetsu review).
- 2: We have built screens for stations and streets. In the disaster, none of them said a word. Screens that don't go silent.
- 3: Hazard types and alert levels. Pictograms and ten languages. And screens of any shape, drawn under the same rules.
- 4: In calm times it reads the documents, writes and checks the guidance; only what a person approved goes out, the moment a warning arrives.
- 5c: The same warning, but where the display stands changes the shelter, the direction and the distance, automatically.
- 5: Real bulletins for Yurihonjo, October 21, replayed at 1,200 times speed. Alert levels 3, 4 and 5. Every screen switches at the same moment.
- 5b: People decide what to show, in calm times. Only approved guidance goes out, automatically, in a crisis.
- 7: Five municipalities, 206 bulletins, 110 layouts. (final count at freeze)
- 7b: Each from its own municipality's documents, for its own place.
- 8: Columns, walls and the screen over the passage show the same warning at once. Step closer and you can read the JMA issue time and the municipality.
- 9: Any signage system that can read the feed. Any screen.
- 10: EVAC LAYER is open source.
