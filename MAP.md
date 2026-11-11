# MAP

A map of this repository for first-time readers and AI: what is where, and which file backs each claim in the README.

リポジトリをはじめて読む人と AI のための地図です。
何がどこにあり、README の主張の裏付けがどのファイルにあるかを 1 枚にまとめます。
行番号は 2026-11-08 の main で確かめたものです。README は節名で指します。

## ディレクトリ

| ディレクトリ | 中身 | 入口 |
|---|---|---|
| `agents/` | 気象庁 XML の parser・Reader・Writer・Composer・Verifier・書き直しのループ・受信・書き出し | `agents/package.json` の scripts（`receive` → `agents/src/jma/receive.ts`、`fanout` → `agents/src/loop/fanout.ts`、`reader` → `agents/src/reader/cli.ts`） |
| `app/` | Nuxt。Renderer（`/screen`）・運営者の画面（`/admin`・`/dashboard`）・配信 API | `app/server/api/`（`live-layout.get.ts`・`app/server/api/feed/[site].get.ts`・`admin/`） |
| `app/layout/` | Nuxt の layouts ではない。承認ゲート・配置・距離の当てはめなど、app と agents が共有する中核ロジック | `app/layout/gate.ts`（承認ゲート）・`headlineTable.ts`（見出しの対訳表とクラス承認の証拠）・`GRID.md`（グリッドの設計） |
| `app/server/middleware/` | admin API の認証 | `admin-auth.ts` |
| `app/server/api/admin/` | 管理 API。site の登録・画面の生成・承認。クラスを施設の複数の site でまとめて承認する口は `classes.get.ts`（一覧）と `class-approvals.post.ts`（承認・取り消し）で、承認できない site を除く条件は `app/server/utils/classApprovals.ts` の `bulkBlock`、ロックの中での確かめ直しは `classApprovalSteps.ts` の `approveRechecked` | `approve.post.ts`（電文 1 件の承認）・経路と施設の資格の表は `app/server/utils/adminPolicy.ts` |
| `app/server/plugins/` | サーバーと一緒に動く見張り。Webhook の配信、書き出し、運用者への通知（警報が出ているのに画面に出ていないこと、気象庁の電文の受信が止まっていること、施設の画面がフィードを取りに来なくなったことを Slack とメールで知らせる） | `webhooks.ts`・`exports.ts`・`notify.ts`（何を通知するかは `app/layout/pending.ts` と `app/layout/liveness.ts`、文面は `app/layout/notice.ts` と `app/layout/livenessNotice.ts`、送信・再試行は `app/server/utils/noticeDelivery.ts`、設定と記録は `app/server/utils/notify.ts`、止まったことの見張りは `app/server/utils/liveness.ts`、施設の画面が最後に来た時刻は `app/server/utils/feedSeen.ts`（数えるのは `app/server/api/feed/[site].get.ts` と `app/server/api/replay.get.ts`）） |
| `schema/` | agents と app の間の取り決め（layout・alert・site・municipality・feed・書き出し） | `schema/README.md` |
| `data/municipalities/` | 5 自治体の知識ファイル（出典ページつき）・避難場所・プリセット | `<市町村コード>.json` |
| `data/sites/` | 施設（緯度経度・向き・市町村コード）。1 ファイル 1 施設。`replay` を持つ site は記録を再生するデモ（05210・17204・22424） | `05210-demo-honjo-station.json` |
| `data/jma/` | 気象庁由来の表: 津波予報区と市町村の対応、見出しの対訳（気象庁「多言語辞書」から抜いた警報名と「解除」の行・辞書の No. と出典つき）、見出しのやさしい日本語（確認前の下書き） | `tsunami-regions.json`・`warning-names.json`・`warning-names-ja-easy.json` |
| `data/layouts/` | 生成物。施設 × 電文 × 5 形状のレイアウト JSON | 各施設の `index.json` が目録（画面を作らなかった電文も理由つきで載る） |
| `data/reports/`・`data/verifier-findings/` | 検査レポートと、Vision の初期の指摘の記録 | `data/verifier-findings/2026-11-02-vision-run1.json` ほか |
| `data/writer/` | Writer の出力の記録（同じ警報から同じ画面を出すための記録） | `<市町村コード>/<電文 ID>.json` |
| `sim/` | ブラウザの 3D シミュレーター。pnpm workspace の外にある独立パッケージ（`pnpm install --ignore-workspace`） | `sim/README.md`・`sim/src/main.ts`・`sim/src/timeline.ts` |
| `demo/` | Blender のコンコース・録画・動画の合成 | `demo/README.md`・`demo/APPROACH.md` |
| `examples/minimal-cms/` | フィードだけで動く 40 行のサイネージ | `index.mjs` |
| `examples/python-player/` | 同じ契約を Python 標準ライブラリだけで書いた 1 ファイルの再生機 | `player.py` |
| `scripts/` | app のテスト・全画面の書き出し・デモの承認・見出しの対訳表を辞書から作る | `demo-approve.mjs`・`screens.mjs`・`jma-warning-names.py` |
| `.claude/` | Claude Code のスキル 3 本とフック 1 本 | `.claude/README.md` |
| `.github/workflows/` | CI（typecheck と agents のテスト）と GitHub Pages | `ci.yml`・`pages.yml` |
| `docs/` | 制作記・評価・統合手順・実証の進め方・全画面 | `how-we-built.md`・`evaluation.md`・`integration.md` |

誤解しやすい点:
- `data/layouts/14100-demo/` には `index.json` しかありません。横浜市は記録期間に警報が出ず、画面は 0 枚です（`docs/evaluation.md:13`）。
- `agents/src/jma/receive.ts` は Anthropic SDK を import します。ただしモデルを呼ぶのは `--writer live` か `--verifier vision` を明示したときだけです。既定の Writer は `placeholder` で、承認済みの文を再利用します（`agents/src/jma/receive.ts:151`・`agents/src/jma/receive.ts:171-172`、`agents/src/writer/step.ts:22-38`）。
- `docs/how-we-built.md` は、英語の段落のあとに同じ内容の日本語が続きます。

## README の主張と裏付け

| 主張 | 裏付け |
|---|---|
| スクリーンが自分の場所を知り、避難先・方向・距離を出す | `agents/src/composer/compose.ts:24-38`（方位と向き）・`agents/src/composer/compose.ts:63`（`pickShelter`）・`app/layout/nearSite.ts:1`（100 m の施設解決） |
| 承認はモデルの外にある | `app/layout/gate.ts` の `screenClass`・`classKey`（種類のキー）・`classDigest`（警報名と時刻を除いた digest）・`approvalWith`・`liveLayoutGateWith`（ゲート） |
| 未承認の画面は配信されない | `app/server/api/live-layout.get.ts:7-8`（ゲートを通らなければ 403） |
| 警報時はモデルを呼ばない | `agents/src/jma/receive.ts:151`・`agents/src/jma/receive.ts:171-172`・`agents/src/writer/step.ts:22-38` |
| 気象庁のフィードを読む | `agents/src/jma/record.ts:79`（`recordFeeds`） |
| 実電文で作り、3 段で検査する | `agents/src/loop/static-verifier.ts`・`browser-verifier.ts`・`agents/src/verifier/vision.ts`・指摘の種類は `agents/src/verifier/checks.ts:28`・最大 3 回は `agents/src/loop/loop.ts:6` |
| レイアウト 110 | `data/layouts/` の `index.json` 以外の JSON が 110 ファイル |
| 実データで見つけた欠陥 | `agents/FINDINGS.md`・README「実データで見つかったこと」 |
| 10 言語と逆翻訳の照合 | `agents/FINDINGS.md` の 9（照合で直した 16 欄と commit 516c6e6・4177bac） |
| HTTP の 3 通りの口 | `docs/integration.md:142-188`・ETag は `app/server/utils/feed.ts:138-154`（`feedResponse`） |
| 40 行の組み込み例 | `examples/minimal-cms/index.mjs:1-40` |
| 同じ契約の受け側が 2 つ（Node と Python） | `examples/minimal-cms/index.mjs`・`examples/python-player/player.py`・README「あなたのサイネージに導入する」 |
| prompt caching | `agents/src/writer/live.ts:77`・`82`・`agents/src/verifier/vision.ts:65` |
| モデルの使い分け | `agents/src/reader/pricing.ts:10-11`・選定の比較は `docs/how-we-built.md:9` |
| フックとスキル | `.claude/settings.json`・`.claude/hooks/check-data.sh:8-13`・`.claude/skills/` |
| Vision の誤検知率と費用 | `docs/evaluation.md:49-58`（誤検知）・`docs/evaluation.md:88-112`（費用） |
| 実行ごとの指摘数 | `docs/evaluation.md:17-47` |
| Webhook の署名と宛先の制限 | `app/server/utils/webhook.ts:24`（HMAC-SHA256）・`app/server/utils/webhook.ts:28`（私設アドレス宛を拒否） |
| admin API の認証 | `app/server/middleware/admin-auth.ts:15-18`（401・403） |
| CI | `.github/workflows/ci.yml`（typecheck と agents のテスト） |
| コードは 11 月 2 日から | 最初のコミットは 2026-11-02 13:03（`git log --reverse`） |

## 審査基準ごとに読む場所

- **インパクト**: README「なぜ作るか」「この先」・`docs/pilot.md`
- **デモ**: README「3 分で見る」「10 月 21 日、由利本荘市。警報から解除まで」・`sim/README.md:30-41`・`sim/src/timeline.ts:55`
- **Claude の活用**: README「Claude とどう作ったか」・`docs/how-we-built.md`・`.claude/README.md`
- **深さと実行力**: `docs/evaluation.md`・`agents/FINDINGS.md`・`app/layout/gate.ts`

## 読む順

`README.md` → `MAP.md` → `docs/how-we-built.md` → `agents/README.md` → `app/README.md` → `docs/evaluation.md` → `agents/FINDINGS.md` → `docs/integration.md`

## 状態

- 実際の運用と、自治体による検証はまだです（README「EVAC LAYER がしないこと」）。
- やさしい日本語以外の訳は、母語話者の確認がまだです（README「今後」）。
- テストは agents 122 件（`pnpm -F agents test`・CI で実行）と app 87 件（`pnpm -F app test`・Chrome が要るので手元で実行）です（README「動かす」）。
- シミュレーターの再生は 平常時 → レベル 3 → 4 → 5 の繰り返しで、解除の場面は含みません（`sim/src/timeline.ts:55`）。
- `agents/FINDINGS.md` の 1〜7 はすべて修正済みで、「→」の後に修正日とコミットがあります。8 は運用上の注意で修正の対象外、9 は逆翻訳による照合の記録です。
