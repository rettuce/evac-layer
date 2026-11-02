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
| `screens/*.png`（プレースホルダ） | `build_scene.py` が ffmpeg で自動生成（形状名の文字のみ） | 自作 | — （リポには入れない） |
| ジオメトリ（床・天井・壁・柱・案内柱・ベゼル） | `build_scene.py` が bpy のプリミティブから生成 | 自作 | — |

テクスチャは `blender/polyhaven.py` が初回実行時に Poly Haven API から取得してキャッシュする（`assets/textures/` は gitignore。ID と作者は上の表）。

人物・外部 3D モデル（Sketchfab 等）は使っていない。
