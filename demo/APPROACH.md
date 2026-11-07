# demo/ の作り方の選定（2026-11-02）

3D カット（駅コンコースの柱・壁面・天井リボン・案内柱のサイネージ）を Blender でどう作るか。2 方式を比較した。

| 観点 | bpy スクリプト直書き（`blender -b -P`） | blender-mcp（[ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp)・MIT・2026-11 時点 33k star） |
|---|---|---|
| 仕組み | Python スクリプトがシーンを毎回ゼロから組み、headless でレンダする | Blender 内のアドオンがソケットサーバ（`localhost:9876`）を立て、MCP サーバ経由で LLM が起動中の Blender にコマンドを送る |
| 再現性 | 高い。同じ引数なら同じシーン・同じフレーム | 低い。結果は起動中の Blender の状態に積み重なり、手順が会話ログにしか残らない |
| リポに残せるか | 残せる。`demo/blender/build_scene.py` 1 本がシーンの正本 | `.blend` のバイナリか会話ログ。差分が読めない |
| 反復速度 | 1 回の実行＝起動＋構築＋レンダ（数秒〜）。数値を変えて再実行 | ビューポートを見ながら対話で直せるので、構図の追い込みは速い |
| 動画テクスチャ | `image.source = 'MOVIE'` と `image_user.frame_start` をコードで揃えられる | 任意 Python の実行は可能だが、設定が Blender の状態に埋もれる |
| 素材 | Poly Haven を API から直接 DL（CC0） | Poly Haven・Sketchfab 等を取り込める。Sketchfab は spec で禁止 |
| 安全 | 外部に口を開けない | アドオンのソケットは認証・暗号化なし（README 記載） |

**採用: bpy スクリプト主体**。シーンがコード 1 本で再現でき、公開リポで「Claude Code がシーンとレンダ工程まで書いた」ことを示せるため。blender-mcp は構図の追い込みでライブのビューポートを見たくなったときだけ候補にし、導入は相談して決める。

## 実行

```bash
blender -b -P demo/blender/build_scene.py -- --out demo/renders/test.mp4 --seconds 5 --res 1280x720
```

フレームは `demo/cache/` に PNG で書き、ffmpeg で H.264 の mp4 にまとめる（音は付けない。音は最終合成の工程）。
