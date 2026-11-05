# ナレーション録音ツール

デモ映像のナレーションを、台本を見ながら cut ごとに録音して `demo/compose/audio/narration/` に置くブラウザツールです。npm の依存はありません（Node 24 とブラウザだけで動きます）。

## 起動

```sh
node demo/tools/narration-recorder/server.mjs
```

表示された `http://127.0.0.1:3190/` を Chrome で開きます。127.0.0.1 にだけ bind するので、LAN からは見えません。

| オプション | 既定 | 内容 |
|---|---|---|
| `--port` | `3190` | 待ち受けるポート |
| `--out` | `demo/compose/audio/narration` | WAV の置き場。前の 1 本は隣の `<out>-prev/` に退避 |
| `--cuts` | `~/Dropbox/dev/claude-hackathon-2026/review/davinci/video/cuts` | 場面の静止画を作る `NN-cut<id>.mov` の置き場。無ければ「素材なし」と出るだけで録音はできる |

## 使い方

1. 右上の「入力」で使うマイクを選ぶ（初回はブラウザがマイクの許可を聞く）
2. 左の一覧で cut を選ぶ。右に台本・読み・場面の静止画と、カットの尺・使える秒数・置く位置が出る
3. Space で録音開始。もう一度 Space で停止。経過秒が使える秒数を超えると黄色になる
4. P で再生して確かめる。R で取り直し（捨てる）。Enter で保存
5. 保存すると次の未録音の cut が選ばれる。全部録り終えたら `python3 demo/compose/mix_audio.py --narration` で mix に入れる（このツールからは実行しない）

キー: Space = 録音開始／停止・P = 再生・R = 取り直し・Enter = OK で保存

## 出力

- 48 kHz・24 bit・mono の WAV（ブラウザ側で変換。エコー除去・ノイズ抑制・自動ゲインは切ってある）
- ファイル名は `mix_audio.py` の `narration_filename` と同じ規則（`cut00.wav`・`cut00b.wav`・`cut05c.wav`・`cut07m.wav`）
- 同じ cut を保存すると上書きされ、直前の 1 本だけ `narration-prev/` に残る
- 一覧の「窓」は `mix_audio.py` の `narration_track` と同じ計算（その cut の頭から次にナレーションのある cut の頭まで。cut 0 は頭から 5.0 s 後に置くのでその分短い）。台本は `demo/compose/edl.json` を毎回読み直す
- 頭と末尾の無音は足さない。台本の注意どおり、話す前に 0.2 s・話し終えて 0.5 s 待ってから止める

## HOME で使う

```sh
cd ~/Documents/local_dev/evac-layer
git pull
node demo/tools/narration-recorder/server.mjs
open http://127.0.0.1:3190/
```

静止画は ffmpeg が入っていて `--cuts` の場所に mov があれば作られます（`demo/tools/narration-recorder/.cache/` に置き、git には入りません）。
