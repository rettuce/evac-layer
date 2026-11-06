# demo/ の素材と出典

| ファイル | 出典 | 作者 | ライセンス |
|---|---|---|---|
| `assets/metro_vijzelgracht_1k.hdr` | Poly Haven「Metro: Vijzelgracht」 https://polyhaven.com/a/metro_vijzelgracht （API: `https://api.polyhaven.com/files/metro_vijzelgracht` の 1k HDR） | Greg Zaal | CC0 1.0 |
| `assets/textures/ash_veneer/`（2k の diffuse・rough・nor_gl） | Poly Haven「ash_veneer」 https://polyhaven.com/a/ash_veneer | Jenelle van Heerden | CC0 1.0 |
| `assets/textures/concrete_floor_worn_001/`（2k の diffuse・rough・nor_gl） | Poly Haven「concrete_floor_worn_001」 https://polyhaven.com/a/concrete_floor_worn_001 | Dimitrios Savva, Rico Cilliers | CC0 1.0 |
| `assets/textures/concrete_wall_008/`（2k の diffuse・rough・nor_gl） | Poly Haven「concrete_wall_008」 https://polyhaven.com/a/concrete_wall_008 | Charlotte Baglioni, Dario Barresi | CC0 1.0 |
| `assets/textures/granite_tile/`（2k の diffuse・rough・nor_gl） | Poly Haven「granite_tile」 https://polyhaven.com/a/granite_tile | Charlotte Baglioni | CC0 1.0 |
| `assets/textures/long_white_tiles/`（2k の diffuse・rough・nor_gl） | Poly Haven「long_white_tiles」 https://polyhaven.com/a/long_white_tiles | Jenelle van Heerden, Sergej Majboroda | CC0 1.0 |
| `assets/textures/marble_01/`（2k の diffuse・rough・nor_gl） | Poly Haven「marble_01」 https://polyhaven.com/a/marble_01 | Rob Tuytel | CC0 1.0 |
| `compose/fonts/NotoSansJP-Bold.otf`（テロップ） | Noto CJK https://github.com/notofonts/noto-cjk （`compose.py` が初回に取得・LICENSE 同梱・gitignore） | Adobe / Google | SIL OFL 1.1 |
| `compose/fonts/NotoSansJP-Regular.otf`（カット 4 のシステム図の本文） | Noto CJK https://github.com/notofonts/noto-cjk （`explainers.py` が初回に取得・gitignore） | Adobe / Google | SIL OFL 1.1 |
| `screens/*.png`（プレースホルダ） | `build_scene.py` が ffmpeg で自動生成（形状名の文字のみ） | 自作 | — （リポには入れない） |
| ジオメトリ（床・天井・壁・柱・案内柱・ベゼル） | `build_scene.py` が bpy のプリミティブから生成 | 自作 | — |

テクスチャは `blender/polyhaven.py` が初回実行時に Poly Haven API から取得してキャッシュする（`assets/textures/` は gitignore。ID と作者は上の表）。

人物・外部 3D モデル（Sketchfab 等）は使っていない。

端末収録（`capture/terminal.mjs`）は実行時に次を `cache/terminal/` へ取得する（gitignore・依存には追加しない）: xterm.js 5.5.0（`@xterm/xterm`・MIT・© The xterm.js authors）、JetBrains Mono（`@fontsource/jetbrains-mono` 5.0.20・SIL OFL 1.1・© JetBrains）。和文は `compose/fonts/NotoSansJP-Bold.otf`（SIL OFL 1.1）。

音（`compose/mix_audio.py`）: Adobe Audition SFX（Adobe 無償配布・各カテゴリの LICENSE.pdf。作品内での使用・改変・配布は可、素材単体での配布は不可）から 3 本 — 環境音 `Ambience_1/Ambience Court House Security Checkpoint Interior Opposite Not Busy 02.wav`、切替の電子音 `Science Fiction/Science Fiction Sci-Fi Electronic Beep 04.wav`（97 ms・2026-11-05 に Alert Beep High 01 から差し替え）、ドローン `Drones/Drone Production Element Imaging Bed Deep Bass 01.wav`。素材の WAV は `compose/audio/`（gitignore）に置き、リポにはミックス後の動画だけを出す。

場面転換の音（`compose/se_scene.py`）: ノイズと 9 kHz 以上の短い音を Python の標準ライブラリで合成した。外部の素材は使っていない。

BGM（`compose/mix_audio.py` の既定・`compose/audio/bgm/grid-cover-1-00254105.wav`・gitignore）: Suno で生成した「Rigorous Grid Study - 175」 https://suno.com/song/00254105-6ec5-4a63-a178-f82a1451777a 。2026-11-05、Suno Pro プランの契約中に作成した（Suno の公式 MCP から、同じく Pro 期間中に作った自作曲 https://suno.com/song/c7d83c10-aa27-429a-bdbc-fb8887831934 のカバーとして生成）。Suno の利用規約では有料プラン契約中に作った曲は作成者が所有し商用利用できる。ファイルに入っている Suno の透かしは除去していない。

ナレーションの自動音声（試作・`demo/out/tts/`・gitignore）:
- macOS `say` の System Voices（Kyoko）: macOS ソフトウェア使用許諾契約 §2F により、個人的・非商用の制作にのみ使える。「営利・非営利・公開共有の文脈」での録音・公開・再配布は不可。提出映像には使わず、試聴用の比較にとどめる
- VOICEVOX（未導入）: ソフトウェア規約 https://voicevox.hiroshiba.jp/term/ では商用・非商用とも利用可で、「VOICEVOX を利用したことがわかる」クレジットが必要。ただし音声ライブラリ（キャラクター）ごとに別の規約があり、使うキャラクターの規約も確認する必要がある

地図（カット 5c・`compose/cut05c.py`）: OpenStreetMap 標準タイル zoom 16 https://tile.openstreetmap.org/ （© OpenStreetMap contributors・データは ODbL 1.0・https://www.openstreetmap.org/copyright）。タイル利用ポリシーに従い、アプリ名入りの User-Agent で 1 枚ずつ一度だけ取得して `cache/osm/`（gitignore）に置く。画面左上に「地図: © OpenStreetMap contributors にディスプレイと避難場所の位置を追記」をカットの間ずっと表示する。ディスプレイと避難場所の座標は国土地理院 指定緊急避難場所データ（`data/municipalities/05210.shelters.json`）。

## docs/images/ の画像

README で使う画像の出所。画面はすべてこのリポジトリの描画部（`app/`）で描いたもので、文字は同梱の Noto フォント（`app/ASSETS.md`）。

| ファイル | 中身と出所 |
|---|---|
| `hero-lv4.jpg`・`levels-same-moment.jpg` | `blender/` で描いたコンコースの 3D に、描画部で録った画面を貼ったもの。テクスチャと HDRI は上の表の Poly Haven（CC0）。平常時の映像は描画部の平時レイヤー（`app/layout/ambient/`）が生成したもの |
| `where-it-stands.jpg` | カット 5c と同じ組み方。地図は上の「地図」の段落のとおり OpenStreetMap（© OpenStreetMap contributors・ODbL 1.0）で、画面の中にもその表記がある。避難場所の位置は国土地理院のデータ |
| `screens-from-real-bulletins.jpg` | 背景のタイルはカット 7m と同じ、架空の案内画面（`capture/mosaic_layouts.mjs`。自治体・施設・発表時刻はすべて架空）を描画部で撮ったもの。数字は `/api/dashboard` の集計 |
| `admin-approval.jpg` | 運営者画面 `/admin` のスクリーンショット |
