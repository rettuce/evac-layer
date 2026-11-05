# ナレーション録音台本

1. 静かな部屋で、外付けマイクで録る（エアコン・PC のファンを止める）
2. 1 カット 1 ファイル。ファイル名は下の表のとおり `demo/compose/audio/narration/` に置く
3. WAV・48 kHz・モノラルが既定（違う形式でも `mix_audio.py` が変換する）
4. 文末で 0.5 秒置いてから止める。「使える秒数」を超えないこと
5. 言い直したら最後のテイクだけ残す（ファイルを上書きする）

`demo/compose/edl.json` の `narration_ja` から `subtitles.py` が生成する。話速 300 字/分（5 字/秒）で、そのカットの開始から次にナレーションのあるカットの開始までを「使える秒数」とし、上限の字数を示す。置いたファイルは `mix_audio.py` がそのカットの開始秒に載せる。

| ファイル名 | 読み上げ文 | 使える秒数 | 字数／上限 | 読み方 |
|---|---|---|---|---|
| `narration/cut00.wav` | 警報が届いた瞬間、スクリーンは、その場所に合った避難案内に変わります。 | 8 s（5 s から） | 35／40 | けいほうが とどいた しゅんかん、スクリーンは、そのばしょに あった ひなんあんないに かわります |
| `narration/cut00b.wav` | EVAC LAYER は、いまある既存のサイネージに、災害時の緊急案内のレイヤーを自動で追加するシステムです。 | 11 s（13 s から） | 53／55 | エヴァク レイヤーは、いま ある きぞんの サイネージに、さいがいじの きんきゅうあんないの レイヤーを じどうで ついかする システムです |
| `narration/cut01.wav` | 2024年1月1日、能登半島地震。どこへ逃げればよいか、判断が難しかった来訪者がいました。 | 10 s（24 s から） | 45／50 | にせんにじゅうよねん いちがつ ついたち、のとはんとう じしん。どこへ にげれば よいか、はんだんが むずかしかった らいほうしゃが いました |
| `narration/cut02.wav` | 私はこれまで駅や街のサイネージシステムを作ってきました。これらは災害のとき、能動的に情報を発信できませんでした。 | 12 s（34 s から） | 56／60 | わたしは これまで えきや まちの サイネージ システムを つくって きました。これらは さいがいの とき、のうどうてきに じょうほうを はっしん できませんでした |
| `narration/cut03.wav` | 災害の種類と警戒レベル。アイコンと10の言語。そして、どんな形のスクリーンにも、適切なレイアウトで描きます。 | 12 s（46 s から） | 54／60 | さいがいの しゅるいと けいかいレベル。アイコンと じゅうの げんご。そして、どんな かたちの スクリーンにも、てきせつな レイアウトで えがきます |
| `narration/cut04.wav` | 避難案内は自動作成され、人が事前承認したものだけが、警報が届いた瞬間に表示されます。 | 10 s（58 s から） | 42／50 | ひなん あんないは じどう さくせいされ、ひとが じぜん しょうにんした ものだけが、けいほうが とどいた しゅんかんに ひょうじされます |
| `narration/cut05c.wav` | 同じ警報でも、スクリーンの位置が違えば、避難先も方向も距離も適切に表示されます。 | 14 s（68 s から） | 40／70 | おなじ けいほうでも、スクリーンの いちが ちがえば、ひなんさきも ほうこうも きょりも てきせつに ひょうじされます |
| `narration/cut05.wav` | 10月21日 由利本荘市で実際に発表された警報データを使い、1200倍の速さでシミュレートしています。警戒レベル3、4、5。すべてのスクリーンが、同じ瞬間に切り替わります。 | 25 s（82 s から） | 85／125 | じゅうがつ にじゅういちにち ゆりほんじょうしで じっさいに はっぴょうされた けいほうデータを つかい、せんにひゃくばいの はやさで シミュレート しています。けいかいレベル さん、よん、ご。すべての スクリーンが、おなじ しゅんかんに きりかわります |
| `narration/cut05b.wav` | 何を出すかは、事前に人が確認できます。承認しておけば、有事に自動で避難案内に切り替わります。 | 9 s（107 s から） | 46／45（超過） | なにを だすかは、じぜんに ひとが かくにん できます。しょうにん しておけば、ゆうじに じどうで ひなん あんないに きりかわります |
| `narration/cut07m.wav` | まずは3週間で事前収集した、5つの自治体での206本の気象庁の電文から、110のレイアウトを作成しました。 | 27 s（116 s から） | 53／135 | まずは さんしゅうかんで じぜん しゅうしゅうした、いつつの じちたいでの にひゃくろっぽんの きしょうちょうの でんぶんから、ひゃくじゅうの レイアウトを さくせいしました |
| `narration/cut09.wav` | 信号を受け取れる仕組みがあれば、どの場所のどんなスクリーンにも、自動で災害情報を表示できます。 | 10 s（143 s から） | 47／50 | しんごうを うけとれる しくみが あれば、どの ばしょの どんな スクリーンにも、じどうで さいがいじょうほうを ひょうじ できます |
| `narration/cut10.wav` | EVAC LAYERは、オープンソースで公開しています。 | 13 s（153 s から） | 27／65 | エヴァク レイヤーは、オープンソースで こうかい しています |

## 英訳（字幕用）

- 0: The moment a warning arrives, the screen turns into evacuation guidance for where it stands.
- 0b: EVAC LAYER is a system that automatically adds an emergency evacuation guidance layer to existing signage.
- 1: January 1, 2024. The Noto Peninsula earthquake. Some visitors could not tell where to evacuate.
- 2: I have previously developed signage systems for stations and city streets. During disasters, these systems were unable to actively disseminate information.
- 3: Hazard types and alert levels. Icons and ten languages. And for a screen of any shape, a layout that fits.
- 4: Evacuation guidance is generated automatically. Only what a person has approved in advance is shown, the moment a warning arrives.
- 5c: Same warning, different place. The shelter, the direction and the distance follow where the screen stands.
- 5: Using actual warning data issued in Yurihonjo City on October 21, this is simulated at 1200x speed. Alert levels 3, 4 and 5. Every screen switches at the same moment.
- 5b: What to show can be checked in advance. Approve it once, and the screens switch to evacuation guidance by themselves.
- 7m: First, we created 110 layouts from 206 Japan Meteorological Agency telegrams collected in advance across five municipalities over three weeks.
- 9: If there is a system capable of receiving signals, disaster information can be automatically displayed on any screen anywhere.
- 10: EVAC LAYER is open source.
