# 端末収録の台本（カット 3・4・6）

agents 席の CLI（`pnpm -F agents …`）の実走を、端末画面として収録する。どのカットも 16:9・1920×1080・30fps・音なしで、出力先は `demo/capture/out/cutNN.mp4`（`demo/compose/edl.json` の src）。実走は Anthropic API キーの準備が済んでから行う。今は台本だけ。

## 収録の方式（提案）

画面のリアルタイム録画ではなく、**記録 → 描画**の 2 段で作る。画面収録（`record.mjs`）と同じく、決定論的で解像度が正確になり、ブラウザ枠・OS のメニューバー・カーソルが入らない。

1. **記録**: macOS の `script -r <file>.typescript <command>` で、端末出力をタイミング付きで残す（BSD script の `-r`。再生は `script -p`）。端末幅は 120 桁に固定する（`COLUMNS=120`）
2. **描画**: ヘッドレス Chrome に xterm.js（MIT）を 1920×1080 で開き、記録を 1/30 秒刻みで流し込んで PNG を撮り、ffmpeg で mp4 にする（スクリプトは `demo/capture/terminal.mjs` として後で書く）
3. **待ち時間の圧縮**: API 応答待ちなどの無出力区間は最大 1.5 秒に詰める。詰めた区間は画面右上に `実時間 38.2 s` のように実経過を小さく出す（速さを偽らないため）
4. **文字**: 等幅は JetBrains Mono（OFL）か Noto Sans Mono CJK（OFL）。1 行の高さは画面の約 1/34（26 px 前後）で、30 行 × 120 桁が入る

## カット 3 — Reader（25 秒）

絵: 自治体 PDF を Reader に渡すと、テキスト層を検査し、引用付きで構造化して、最後に引用付きの JSON が流れる。

| 秒 | 見せるもの | コマンド・出力 |
|---|---|---|
| 0〜3 | コマンド入力（タイプ表示） | `pnpm -F agents reader --municipality 17204` |
| 3〜9 | テキスト層の検査。輪島市の津波ハザードマップが `suspect` で止まる（CID フォントに ToUnicode が無く「最大津波 16.6m」→「最 津波 16.6m」） | stderr の `[text layer] … suspect …` 行と、停止メッセージ |
| 9〜12 | `--allow-vision` を付けて再実行（タイプ表示） | `pnpm -F agents reader --municipality 17204 --allow-vision` |
| 12〜19 | 予算見積もり → stage 1 の引用 → vision → stage 2 | `[budget] … worst case $… (limit $…)`、`[stage 1] N cited claims, M citations`、`[vision] … pages read`、`[stage 2] …s` |
| 19〜25 | 引用付きの知識ファイル（JSON）が流れる。最後にページ番号付きの引用 1 件を止めて見せる | stdout の JSON（`counts`・`out`・`default_publish_path`）と、出力ファイルの `hazards[].source_page` の抜粋 |

実走で決めること: stage 1 と vision の実時間（圧縮の量）、最後に止める引用 1 件。

## カット 4 — Writer / Composer（20 秒）

絵: 警報 1 本からやさしい日本語と 4 言語の文言ができ、Composer が 4 形状のテンプレ番号と必須セルを出す。

| 秒 | 見せるもの | コマンド・出力 |
|---|---|---|
| 0〜2 | コマンド入力 | `pnpm -F agents replay-pipeline --replay <由利本荘 10-21 の replay.json> --site data/sites/05210-demo-honjo-station.json --writer live --writer-model opus` |
| 2〜10 | 18:15 の Lv4（子吉川 氾濫危険警報）の Writer 出力: `ja` → `ja_easy` → `en` / `zh_hans` / `zh_hant` / `ko` が順に出る | `data/writer/05210/VXKOii-202610211815-e713da0e3c05.json` の `output`（`model`・`usage`・`lint` も持つ）。言語キーごとに 1 行ずつ見えるよう `jq` で整形する |
| 10〜12 | コマンド入力 | `pnpm -F agents compose --alert $JMA_FEED_DIR/bodies/20261021/20261021091533_0_VXKO55_050000.xml --municipality 05210 --site data/sites/05210-demo-honjo-station.json --writer <writer>.json --out-dir tmp/cut4` |
| 12〜20 | 4 形状の検証結果と、各形状の `template` と必須セル | stderr の `OK  <file>` ×4（agents 席が 4 形状とも OK を確認済み）。続けて 4 ファイルの `shape`・`template`・`cells[].role` を 1 行ずつ |

ライブ Writer は単体の `writer` CLI（今は `--dry-run` だけ）ではなく、replay と fan-out の `--writer live` から呼ばれる。出力は電文ごとに `data/writer/<自治体>/<電文>.json` に保存されて再利用されるので、同じ電文はいつも同じ画面になる。0〜10 秒は、収録の時点で agents 席の CLI の最終形に合わせる。電文はカット 5 の live と同じ由利本荘の列。

## カット 6 — Verifier の差し戻し（20 秒）

絵: Verifier がスクリーンショットを読んで差し戻し、修正版が通る。

| 秒 | 見せるもの | コマンド・出力 |
|---|---|---|
| 0〜3 | コマンド入力 | `pnpm -F agents pipeline --alert $JMA_SAMPLES_DIR/32-39_12_02_250206_VTSE41.xml --municipality 17204 --site agents/test/fixtures/site-wajima-test.json --writer agents/test/fixtures/writer-tsunami-advisory-distance.json --revisions agents/test/fixtures/writer-tsunami-advisory.json --verifier browser --base-url http://127.0.0.1:3152` |
| 3〜11 | attempt 1 の差し戻し。Verifier が描画した画面を読み、方向セルと避難場所セルの距離の二重表示を 3 形状で弾く | `attempt 1 (fixture:writer-tsunami-advisory-distance.json): 16x9 distance-duplicated[direction], 9x16 distance-duplicated[direction], 32x9 distance-duplicated[direction]` |
| 11〜17 | attempt 2 で通る | `attempt 2 (fixture:writer-tsunami-advisory.json): no findings` |
| 17〜20 | 結果とレポートのパス | `pass` と `tmp/pipeline/reports/17204-<電文ID>/report.json` |

電文は能登の津波注意報（気象庁の公式サンプル）。`--verifier browser` は dev 限定の `/api/layout` を読むので、Verifier の実走は dev サーバ（3152）で行い、画面の撮影は本番ビルドで行う。`long → advisory` の組は、Composer が文字数予算で描画の前に止める（`16x9 over-budget[action]`）ため、画面を読んで差し戻す絵にならない。

右半分に、差し戻された画面と通った画面のスクリーンショットを並べる案もある（report.json が画像を持っていれば合成工程で重ねる）。

点滅の差し戻しは入れない（2026-11-02 司令官裁定。Renderer に点滅が無いので、起こす fixture を作るのは作為になる）。差し戻しは予算超過・距離の二重表示・文字高で見せる。

## agents 席の回答（2026-11-02・work/agents で実走して確認）

1. **電文 XML の実ファイル**
   - カット 4（由利本荘 10-21 18:15 子吉川 レベル４氾濫危険警報）: `$JMA_FEED_DIR/bodies/20261021/20261021091533_0_VXKO55_050000.xml`（`JMA_FEED_DIR` 既定は private の `data/jma-feed`）。`pnpm -F agents compose --alert <このファイル> --municipality 05210 --site data/sites/05210-demo-honjo-station.json --writer <writer>.json --out-dir tmp/cut4` で 4 形状とも `OK` を確認済み。`--municipality` は自治体コードでも渡せる（Reader 未実行の間は `data/municipalities/<id>.shelters.json` から組む）
   - カット 6（輪島・石川県能登の津波注意報。公式サンプル）: `$JMA_SAMPLES_DIR/32-39_12_02_250206_VTSE41.xml`
2. **attempt 1 の差し戻し**: 出る。ただし `long → advisory` の attempt 1 は `16x9 over-budget[action]` で、Composer が描画の前に文字数予算で止めたもの（画面は描かれない）。実走結果（`--verifier browser`）:
   ```
   attempt 1 (fixture:writer-tsunami-advisory-long.json): 16x9 over-budget[action]
   attempt 2 (fixture:writer-tsunami-advisory.json): no findings
   pass
   ```
   「Verifier が画面を読んで差し戻す」絵にするなら `writer-tsunami-advisory-distance.json → writer-tsunami-advisory.json` を推奨。描画した画面で方向セルと避難場所セルの距離の二重表示を弾く:
   ```
   attempt 1 (fixture:writer-tsunami-advisory-distance.json): 16x9 distance-duplicated[direction], 9x16 distance-duplicated[direction], 32x9 distance-duplicated[direction]
   attempt 2 (fixture:writer-tsunami-advisory.json): no findings
   pass
   ```
   `report.outcome` の語は `pass`（ほかに `fail` / `stopped`）。コマンドは `--municipality 17204` だけで通る（`--municipality-file` 不要）
3. **点滅の fixture は作らない**で同意。Renderer に点滅は存在せず、弾かれる実例は作為になる。カット 6 は予算超過・距離二重・文字高で見せる。**`--verifier browser` の URL**: `/screen?src=/api/layout?file=` を使うので、`/api/layout` が生きている **dev サーバ**（同じ worktree）が必要。本番ビルドでは `/api/layout` が 404 になり検査できない。既定は agents worktree の dev `http://127.0.0.1:3152`、`--base-url` で変更可
4. **ライブ Writer の引数（予定）**: `pnpm -F agents writer --alert <電文 XML> --municipality <id> [--model opus|sonnet] [--out <file>]`。形状ごとの文字数予算は Composer が決めて渡すので、出力は 4 形状分（`{"16x9": WriterOutput, …}`）。pipeline からは同じものを内部で呼び、差し戻し時は findings を添えて再生成する。確定したらこの節を更新する
5. **追記（report のパス）**: fixture を使う `pipeline` は公開データの木を汚さないよう、既定で `tmp/pipeline/reports/<自治体>-<電文ID>/report.json` に書く（`--publish` のときだけ `data/reports/`）。カット 6 の最後に見せるパスはこれになる
