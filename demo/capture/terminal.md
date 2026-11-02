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
| 0〜2 | コマンド入力 | `pnpm -F agents writer --alert <電文 XML> --municipality data/municipalities/<id>.json`（ライブ呼び出しは Day 2 に入る） |
| 2〜10 | Writer の出力: `ja` → `ja_easy` → `en` / `zh_hans` / `zh_hant` / `ko` が順に出る | stdout の JSON。言語キーごとに 1 行ずつ見えるよう整形する |
| 10〜12 | コマンド入力 | `pnpm -F agents compose --alert <電文 XML> --municipality <id>.json --site <site>.json --writer <writer>.json --out-dir <dir>` |
| 12〜20 | 4 形状の検証結果と、各形状の `template` と必須セル | stderr の `OK  <file>` ×4。続けて 4 ファイルの `shape`・`template`・`cells[].role` を 1 行ずつ |

実走で決めること: 使う電文（由利本荘の 10-21 18:15 Lv4 を推奨。カット 5 の live と同じ電文列になる）と、出力 JSON の見せ方（`jq` で整形して一部だけ出すか）。

## カット 6 — Verifier の差し戻し（20 秒）

絵: Verifier がスクリーンショットを読んで差し戻し、修正版が通る。

| 秒 | 見せるもの | コマンド・出力 |
|---|---|---|
| 0〜3 | コマンド入力 | `pnpm -F agents pipeline --alert <電文 XML> --municipality 17204 --site agents/test/fixtures/site-wajima-test.json --writer agents/test/fixtures/writer-tsunami-advisory-long.json --revisions agents/test/fixtures/writer-tsunami-advisory.json --verifier browser` |
| 3〜11 | attempt 1 の差し戻し（予算超過・距離の二重表示・文字高さ不足） | `attempt 1 (…): <shape> <check>[<cell>], …` |
| 11〜17 | attempt 2 で通る | `attempt 2 (…): no findings` |
| 17〜20 | 結果とレポートのパス | `report.outcome` の 1 行（値の語は実走で確認）と `data/reports/<…>/report.json` |

右半分に、差し戻された画面と通った画面のスクリーンショットを並べる案もある（report.json が画像を持っていれば合成工程で重ねる）。

点滅の差し戻しは入れない（2026-11-02 司令官裁定。Renderer に点滅が無いので、起こす fixture を作るのは作為になる）。差し戻しは予算超過・距離の二重表示・文字高で見せる。

## agents 席に確認すること

1. カット 4・6 で使う電文 XML のパス（公式サンプルと記録フィードは再配布しない前提なので、`JMA_SAMPLES_DIR` / `JMA_FEED_DIR` 配下の実ファイル名）
2. カット 6 の fixture の組み合わせ（`writer-tsunami-advisory-long` → `writer-tsunami-advisory`）で、attempt 1 に差し戻しが出るか
3. `--verifier browser` が使うアプリの URL（既定 3152）。収録時は demo 席の本番ビルドを使う
4. ライブの Writer が Day 2 に入ったあとの、`writer` コマンドの最終的な引数
