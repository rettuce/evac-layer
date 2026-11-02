# 音の下準備（合成は後工程）

素材元は Adobe Audition の無償 SFX ライブラリ（各カテゴリの `LICENSE.pdf` に従う）。ローカルの `$SFX = ~/Dropbox/dev/material/sound/adobe-audition-sfx/` から**読むだけ**で、ここにはパスと長さだけを書く。採用が決まった素材だけを `demo/compose/audio/` に複製し、出典を `demo/ASSETS.md` に 1 行足す。最終選択は試聴で決める（`afplay "<path>"`）。

## 駅の環境音（ambience・カット 1〜2・5・8 の床）

ライブラリに駅構内の録音は無い（`station` `subway` `metro` `terminal` で 0 件、2026-11-02 検索）。屋内の公共空間で代用する。

| # | ファイル（`$SFX/` 以下） | 長さ | 向く理由 |
|---|---|---|---|
| 1 | `Ambience_1/Ambience Court House Security Checkpoint Interior Opposite Not Busy 02.wav` | 90.4 s | 硬い床と高い天井の屋内残響、まばらな人の気配。コンコースに一番近い |
| 2 | `Ambience_2/Ambience Stairway Near Elevator 02.wav` | 90.1 s | 階段とエレベータまわりの空調・機械音。人の声が少なく、テロップを邪魔しない |
| 3 | `Ambience_2/Ambience Shopping Area With People Outdoors 01.wav` | 90.1 s | 人の多い商業エリア（屋外）。look C（商業施設のアトリウム）なら 1 に薄く重ねる |
| 補 | `Ambience_2/Ambience Train Pass By 01.wav` | 90.1 s | 列車の通過。カット 1 の頭に一度だけ遠く入れると「駅」が伝わる |

## 注意喚起の短い電子音（UI・カット 5 の切替の瞬間）

田中の電子音の好み（`learned/categories/audio.md` [2026-09-22]）: 中域 750〜3000 Hz で 40 ms 以上鳴る音程のある音は「可愛い」で不採用。9 kHz 以上の短いサインか雑音の短いバースト、硬い立ち上がり、リバーブなしが採用側。重心は ffmpeg の `aspectralstats` で実測した平均。

| # | ファイル | 長さ | 重心 | 向く理由 |
|---|---|---|---|---|
| 1 | `Science Fiction/Science Fiction Sci-Fi Electronic Alert Beep High 01.wav` | 0.3 s | 8,972 Hz | 短く高い。好みの帯域に一番近い既製品 |
| 2 | `Multimedia/Multimedia Internet CD-Rom Flash Beep Electronic 07.wav` | 1.5 s | 5,685 Hz | 1.5 s あるので、頭 25 ms だけ切り出して使う前提 |
| 3 | `Noise-Tones-DTMF-Tests/Tones/sine-tone-10000hz.wav` | 10.0 s | 10 kHz | 素材。20〜25 ms に切り、硬いエッジで 4 分刻みにすれば「点」の注意喚起を作れる |
| 参 | `Noise-Tones-DTMF-Tests/Noise/impulse-chain-20hz.wav` | 10.0 s | — | 好みの参照音（50 ms 間隔のインパルス列）。切替の直前 1 秒の「刻み」に使える |

不採用にした候補: `Science Fiction ... Alert Beep Low 01`（重心 3,158 Hz で中域の音程感が強い）。緊急地震速報・J アラートのチャイムに似せた音は作らない・使わない（実際の警報と取り違えさせないため）。

## 低いドローン（緊張の床・カット 5〜8）

| # | ファイル | 長さ | 向く理由 |
|---|---|---|---|
| 1 | `Drones/Drone Production Element Imaging Bed Deep Bass 01.wav` | 88.3 s | 深い低音の持続。音程感が薄く、環境音の下に敷ける |
| 2 | `Drones/Drone Production Element Imaging Atonal Steady Constant Rumble 01.wav` | 60.1 s | 無調の一定のうなり。切替後の「止まった時間」に合う |
| 3 | `Drones/Drone Production Element Imaging Dark Rich Low Tones Phase 01.wav` | 60.1 s | 低い和音にフェーズ。表情が付くぶん、使うのは最後のカット 8 だけ |

低域の音程は 1 つにそろえる（複数の低音を同時に鳴らすと、うなりで不協和に聴こえる）。
