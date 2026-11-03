# demo/ — 3 分のデモ映像を組み立てる

3D のコンコース（Blender）・画面の決定論的な録画・端末と管理画面の収録・テロップ・音を、179 秒の 1 本にまとめるための道具一式。カット構成は `storyboard.md`、カットごとの尺・テロップ・ナレーションは `compose/edl.json` が正。

## 前提

- macOS（端末収録は BSD `script -r` の記録形式を読む）
- Node 22 以上・pnpm（`pnpm install` 済み。puppeteer-core は `app/` の依存を使う）
- Google Chrome（`CHROME_PATH` で変更可）
- Blender 5.2・ffmpeg 8・Python 3（標準ライブラリのみ）
- 素材: テクスチャと HDRI は Poly Haven（CC0）を初回に自動取得。音は Adobe Audition SFX をローカルに持っていること（`ASSETS.md`）

## 流れ

1. **アプリを本番ビルドで立てる**（dev は HMR で録画中に再読み込みが起きるうえ、管理 API のループバック判定が通らない）
   ```sh
   pnpm -F app build
   HOST=127.0.0.1 PORT=3151 node app/.output/server/index.mjs
   ```
2. **画面を録る**（仮想時計で 1/30 秒ずつ撮る。同じ電文・同じ時刻なら同じ絵になる）
   ```sh
   SITE_NAME=羽後本荘駅 demo/capture/record_all.sh http://127.0.0.1:3151              # 4 形状 × ambient / switch / alert
   SITE_NAME=羽後本荘駅 SHAPES=pillar demo/capture/record_all.sh http://127.0.0.1:3151 # 柱（4 面連続・0.5 倍）
   node demo/capture/record.mjs --shape 16x9 --cut dashboard --verify --out demo/capture/out/cut07.mp4
   ```
   - 由利本荘市の承認と自動配信は撮影前に自動で POST する。平時は `scene=color-planes` に固定
   - `--verify` は先頭・中央・末尾と切り替わりの前後を新しいページで撮り直してバイト比較し、違えば画素数と範囲を出す。判定は緩めない
   - 一部だけ確かめるときは `--from-ms <ms> --seconds <s> --frames-dir <dir> --keep-frames`
3. **管理画面・最小 CMS・端末を収録する**
   ```sh
   node demo/capture/admin_5b.mjs                    # カット 5b。data/approvals.json を消して未承認から撮る
   pnpm -F agents export --site 05210-demo-honjo-station --base-url http://127.0.0.1:3151
   node demo/capture/pip_cms.mjs                     # カット 9 の小窓。export の dist/ が前提
   JMA_SAMPLES_DIR=… JMA_FEED_DIR=… VERIFIER_URL=http://127.0.0.1:3153 demo/capture/terminal_cuts.sh
   ```
   - 端末のカット 6 は Verifier がこの worktree の dev（`/api/layout`）を読むので、別ポートで `nuxt dev` を立てる
   - カット 3・4 の本処理（Reader・ライブ Writer）は `.env` の `ANTHROPIC_API_KEY` が要る。キーが無い環境では、Reader が止まるところと、ライブ実行で書かれた出力を見せる暫定版になる
4. **3D をレンダする**
   ```sh
   LOOK=C demo/blender/render_cut.sh cut01 cut02 cut05 cut08 cut09
   ```
   - look は `A`（白い駅ビル）・`B`（地下コンクリート）・`C`（木質アトリウム）。変えるときはこの 1 行を回して、5 と 6 をやり直す
   - 静止画で確かめる: `blender -b -P demo/blender/build_scene.py -- --look C --cut alert --frame 270 --still out.png --cam hero`
4b. **カット 5c（地図＋4 か所）**: `node demo/capture/record.mjs --shape 16x9 --cut site-<slug> --base-url http://127.0.0.1:3151`（4 か所）→ `python3 demo/compose/cut05c.py` → `demo/capture/out/cut05c.mp4`。OpenStreetMap のタイルは初回だけ取得して `demo/cache/osm/` に置く
4c. **説明カット（3・4・4b）と 7**: `python3 demo/compose/explainers.py`（README のシート 3 枚・システム図の段ごとの点灯・端末 3 本の末尾 4 s）。カット 7 は `node demo/capture/record.mjs --shape 16x9 --cut dashboard-final --base-url http://127.0.0.1:3151 --out demo/capture/out/cut07.mp4`
5. **合成する**: `python3 demo/compose/compose.py` → `demo/renders/evac-layer-demo.mp4`。素材が無いカットはスレート、3D が無いカットは 4 形状を並べたプレビューになる
6. **音を載せる**: `python3 demo/compose/mix_audio.py --sfx-dir <Adobe Audition SFX> --out demo/out/evac-layer-demo-v2.mp4`
   - 環境音 -30 LUFS・カット 5 の切替の電子音・ドローン -26 LUFS。-18 LUFS はナレーション用に空けてある
   - ナレーションは、カット別の録音を `demo/compose/audio/narration/cutNN.wav`（ファイル名は `compose/narration.md` の録音台本の表）に置けば各カットの開始秒に入る。179 s の `narration.wav` 1 本でもよい。カット別のファイルがあればそちらを使う
7. **字幕と台本を書き出す**: `python3 demo/compose/subtitles.py [--with-narration]` → `compose/narration.md`（録音台本）と英語字幕 `demo/out/evac-layer-demo-v2.en.srt`（焼き込まない）

## 所要時間（M 系 Mac・2026-11-03 実測）

| 工程 | 量 | 時間 |
|---|---|---|
| アプリの本番ビルド | — | 約 5 s |
| 画面 4 形状 × 3 カット | 6,840 フレーム | 約 24 分（0.13〜0.57 s/フレーム） |
| 柱 3 カット（3308×2524） | 1,710 フレーム | 約 15 分（0.17〜1.11 s/フレーム） |
| ダッシュボード（カット 7） | 750 フレーム | 約 1.5 分 |
| 管理画面（カット 5b） | 実時間 10 s | 約 15 s |
| export ＋ 最小 CMS（カット 9 の小窓） | 実時間 65 s | 約 1.5 分 |
| 端末 3 本 | — | 約 1.5 分 |
| 3D 5 カット（1920×1080・Eevee 32 samples） | 2,190 フレーム | 約 24 分（0.42〜0.69 s/フレーム） |
| 合成 | 179 s | 約 11 s |
| 音 ・字幕 | — | 数秒 |

## 出力（すべて gitignore）

| 場所 | 中身 |
|---|---|
| `demo/screens/<shape>_<cut>.mp4` | 画面の録画（3D に貼る素材） |
| `demo/capture/out/` | 端末・管理画面・ダッシュボード・最小 CMS の収録 |
| `demo/renders/` | 3D のカットと合成結果 |
| `demo/out/` | 音つきの通し・字幕 |
| `demo/compose/audio/` | 音素材の複製（Adobe Audition SFX は単体で配布しない） |
