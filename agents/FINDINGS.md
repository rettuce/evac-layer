# 実データで見つかった欠陥

2026-10 に記録した気象庁フィード（再生対象 703 本）と、5 自治体のハザードマップ PDF・GSI 指定緊急避難場所データで、パイプラインを動かして見つかったもの。公式サンプルだけでは出なかった。画面は 5 形状（16:9・9:16・32:9・1:1・pillar）で検査している。pillar は 4 面に同じ画面を繰り返すので、Verifier は面 0 だけを数える。

| 事象 | 原因 | 直し方 | 根拠ファイル |
|---|---|---|---|
| 輪島市の津波ハザードマップで、抽出テキストから字が消える（「最大津波 16.6m」→「最 津波 16.6m」、「石川県」→「川県」） | テキスト層の CID フォントに ToUnicode が無い。文字数も文字種比率も正常に見える | テキスト層の判定に `suspect` を新設して停止する。`--allow-vision` ではページ画像を Vision で読み、出典を `method: "vision"` で残す（輪島の最大津波高 8.3 m・舳倉島 16.6 m を復元） | `agents/src/reader/textlayer.ts`（341482c）・`agents/src/reader/`（6add243） |
| 由利本荘市が子吉川の氾濫発生情報（警戒レベル5）でレベル null になり、画面が出ない | 浸水想定地区が水位観測所ではなく決壊点ごとに載る | 浸水想定地区は予報区のレベルを引き継ぐ。それでもレベルが決まらなければ、Composer は「閾値未満」扱いにせず理由つきで停止する。実電文 9 本を fixture にした | `agents/src/jma/parse.ts`・`agents/test/fixtures/replay-05210-koyoshi-20261021.json`（9b0d2ee） |
| 一度も表示していない注意報の解除画面が、22 画面中 9 画面を占める（例: 10-16 の大雨注意報 Lv2 の解除） | Composer は電文ごとに状態を持たない | 再生側で災害種別ごとに「表示中か」を持ち、表示済みのものの解除だけを画面にする | `agents/src/loop/replay-run.ts`（403c098） |
| 県の大雨注意報（画面なし）が届くと、子吉川の警戒レベル5 の画面が平時表示（ambient）に戻る | ライブ表示の状態を全電文で 1 本にしていた | 状態を電文の系列（wmo_code）ごとに持つ | `app/layout/replay.ts`（render・3f2d0f9） |
| 長い施設名が 16:9 で 3 行に折れ、距離「800 m」が切れる | 施設名と種別を 1 つの文字列にしていた | shelter セルは施設名だけにし、種別は `kind` として渡して render が固定ラベルを描く | `schema/layout.schema.json`（b8ab854）・captures 1403 |
| 実電文で parser が止まる（unknown Status「警報から注意報」） | 公式サンプルに無い状態語。記録内の集計は「警報から注意報」136 本・「危険警報から注意報」39 本 | 実在する 2 語だけを追加する。推測で語を足さない | `agents/src/jma/codes.ts`（0dfb08c） |
| 距離が 2 回出る（「出口 B → 左 350m」と「350 m」） | 静的検査では見えない。描画したキャプチャを目視して見つかった | `distance-duplicated` 検査を追加し、Writer に差し戻す | `agents/src/verifier/checks.ts`（84c4047） |
| GSI と市の PDF で施設名が食い違う（輪島 20 件。2012 年地図の旧施設名、「旧輪島市立鳳至小学校」、GSI 側の誤記「ＷＡＪＩＭＡ ＭＥＭＯＲＩＡＬ GIM」） | 出典ごとの更新時期の差と誤記 | Reader が `conflicts[]` に記録する。食い違う施設は画面に出さない | `data/municipalities/17204.json`（8569675） |
| Vision 1 回目: 行動の図記号が画面の内容と矛盾する 25 件（解除画面に「上へ逃げる」、Lv3「警戒」に go_higher、解除の見出しが発令中に見える） | Composer が災害種別だけで図記号と見出しを決めていた | 図記号をテンプレートで決め、解除の見出しは「〈警報名〉解除」にする | `data/verifier-findings/2026-11-02-vision-run1.json`（6c757d6） |
| Vision 2 回目: 行動の文と図記号の意味がずれる 3 件（「浸水に警戒」に雨雲、「川の増水に注意」に「ここは安全」の盾）。指摘件数（形状ごと）は 5 回で 25→8→4→4→0 | 図記号は Composer が決めるのに、Writer はそれを知らずに行動文を書いていた | 行動の図記号は行動だけを表す（解除→safe_here、津波・Lv5→go_higher、他→directions_run）。図記号の意味を Writer に渡し、行動セルの食い違いは Writer に差し戻す | `data/verifier-findings/2026-11-02-vision-run2.json`（50d5843） |
| Lv3 の行動文に「高齢者等避難」が入る（市町村の避難情報の正式名称） | 上の修正で Writer に渡した図記号の意味文に「高齢者等が避難し」とあった。画面は気象庁の警報から作るので、市が発令したように読める | 規約と検査規則で、行動文に避難情報の名称（高齢者等避難・避難指示・緊急安全確保）を使わせない。修正後は「高齢者は避難」 | `agents/src/writer/rules.ts`（8dedf81） |
| 解除画面の見出し「レベル２土砂災害注意報解除」(13 字) が、9:16 と 1:1 で 3 行に折れて見出し帯から溢れる（輪島 2 画面） | 見出し帯の右の「警戒レベル1」ラベルに幅を取られる。見出しは警報名からコードが決めるので、Writer の書き直しでは直らない | render は解除画面でレベルラベルを出さず、9:16・1:1 ではラベルを見出しの下に置き、見出しは 2 行まで・超えたら 0.85 倍にする（f292654）。agents は `data-overflow="<cellId>:<lang>"` で差し戻し先を分け、ja・pictogram・screen は停止、他言語は Writer へ（7ae76d8・3397bb9）。再実行で輪島 7 画面すべて pass・Writer 呼び出し 0 回 | `data/verifier-findings/2026-11-02-vision-run{3,4,5}.json`・captures 1710 |
| Writer の英語欄に日本語の文字が入る（由利本荘の見出し 5 件「子吉川 Lv3 Flood Warning」「Koyoshi(子吉川) flood L4」、輪島の解除「Wajima(輪島市) lifted」） | 固有名詞を漢字のまま英語に混ぜていた。やさしい日本語と Lv5 の検査規則はあったが、英語欄の文字種は検査していなかった | 英語欄に漢字・かなを禁じる検査規則を足し、違反は Writer に差し戻す。6 電文を作り直して「Lv4 Flood: Koyoshi River」の形に | `agents/src/writer/rules.ts`（0cacb31） |
| Vision の誤検知: 輪島 10-21 19:42（大雨注意報の解除）で、指摘文の中で「内容は一致している」「電文と矛盾しない」と書きながら bulletin-mismatch を出す。別の回では同じ画面に「避難は不要です は言い切り」と指摘し、回ごとに判定が揺れる | Vision（Sonnet 5.5）の判定の揺れ | 直さない。ループが Writer に 1 回書き直させ、2 回目で pass する。同じ finding の Writer への再送は 2 回までで止まる | `data/reports/17204-demo/VPWW55-202610211942-7720a18f5cfa/report.json`（ec7e1fb） |
| 記録期間（10-11〜11-02）に、吉田町は最高 Lv2（20 電文）、横浜は警報なし（5 電文）で、画面が 1 枚も出ない。柏崎は 73 電文のうち土砂災害 Lv4 が 2 本（10-31 16:53・18:39）と、その解除（11-01 04:01）で 3 画面 | 実際の気象。Lv3 未満では画面を出さない（表示済みの警報の解除だけが解除画面になる） | 画面を作らず、電文ごとに理由を index.json に残す（例:「level 2 for 22424: below the evacuation threshold, no screen」）。柏崎は 3 画面 × 5 形状とも pass | `data/layouts/{22424,14100,15205}/index.json` |
| 公式サンプルの津波電文（2016-09-01 訓練・全国 66 予報区）で、輪島の「津波注意報・レベル 2」画面を Vision が 3 回続けて「電文より過小」と判定し fail | Vision に渡す電文要点が、津波電文では全国の予報区（大津波警報を含む）を全部載せていた。Composer は自治体の予報区だけを見るので、画面と判定の根拠がずれていた | Vision の要点も自治体の予報区だけに絞り、津波の表示レベルが警報種別から規則で決まる（大津波警報=4・津波警報=3・津波注意報=2）ことを指示文に書く。直後の再実行で 10/10 pass | `agents/src/verifier/vision.ts`・`data/reports/17204-demo/VTSE41-201609010726-05a7380a3e46/` |
| 公式サンプル（2016-09-01 訓練）で静岡県が大津波警報から津波予報（若干の海面変動）に下がる電文で、画面が「無し」になり、直前の大津波警報の画面が残り続ける（危険側の誤り） | Composer は津波予報を「画面を出さない」と一律に扱い、下がってきた経路を見ていなかった。録音した 2026-10 の feed に津波が無く、サンプルで初めて踏んだ | 警報・注意報から津波予報へ下がった区域は解除画面にする（見出し「〈直前の警報名〉解除」・行動は海面変動の注意「海に入らない・海岸に近づかない」・行動の図記号は解除の safe_here）。LastKind の名前を parser に残した。単独で来る津波予報は従来どおり画面なし | `agents/src/composer/rules.ts` `tsunamiDowngradedFrom`・`data/layouts/22424-demo/VTSE41-201609010955-5a813306d772/` |

**費用（2026-11-02 時点・API 実費）**: Reader $2.88（5 自治体・Sonnet 5.5、Haiku との比較 1 本を含む）／Writer 約 $2.75（Opus 5.5・書き直しと英語欄の作り直し込み）／Vision Verifier $5.17（Sonnet 5.5・9 回。4 形状で 5 回、pillar 込みで 4 回）。最終値（run 19 まで・合計約 $21.30）は docs/evaluation.md の費用表が正。

## 端から端までの再確認（2026-11-05）

主張「信号（気象庁の警報電文）を受け取れる仕組みがあれば、どんな場所のどのスクリーンにも自動で災害情報を表示できる」を、現行 main（c535138、出典セルの 0358717 を含む）で実走して確かめた。入力は 10/21 由利本荘の実電文 1 本（子吉川レベル３氾濫警報・15:55）。登録済みの本荘駅前（A）と、登録していない任意の座標（B・39.3915, 140.04・施設ではない点）の 2 サイトで、読解から画面まで流した。dev `app` は 127.0.0.1:3152、Verifier は Chrome headless + Vision（Sonnet）。

| 段 | コマンド | 所要 | 出力 |
|---|---|---|---|
| 読解 | `pnpm -F agents jma $JMA_FEED_DIR/bodies/20261021/20261021065519_0_VXKO55_050000.xml` | 0.4 s | alert JSON（`VXKOii-202610211555-d5ccc7c6b547`・flood・L3・由利本荘市） |
| 案内生成 → 検査（A） | `pnpm -F agents pipeline --alert <同じ xml> --municipality 05210 --site data/sites/05210-demo-honjo-station.json --writer <data/writer/05210/<id>.json の output> --verifier vision` | 61.6 s | `tmp/pipeline/` に 5 形状 + report.json。attempt 1・findings 0・5/5 pass |
| 同（B） | 同じ。`--site` は id / municipality_id / lat / lng / facing_deg だけの JSON | 45.9 s | 5 形状。16x9 が fail（下の 4）・他 4 形状 pass |
| 承認済み一式 | `pnpm -F agents export --site 05210-demo-honjo-station --out <dir>` | 45.0 s | 6 電文 × 5 形状 = 91 ファイル + manifest.json（approved_at 2026-11-02） |
| 画面 | `/screen?shape=16x9&src=/api/layout?file=<絶対パス .json>` | — | capture 2 枚（private `log/captures/agents-2026-11-05-0619-e2e-16x9-{honjo-station,arbitrary-point}.png`） |

費用: Writer $0（キャッシュ記録の出力を使用）、Vision 10 checks ≈ $0.11（1 check ≈ $0.011）。同じ電文で位置だけ変えた結果: A は 鶴舞小学校 570 m 南西へ、B は 砂子下コミュニティセンター 530 m 南へ。見出し・行動・言語帯・出典は同じ。

主張どおりに動かない箇所（11-05 時点。各項目の末尾にその後の対応）:

1. **信号の受け口が公開リポに無い。** 気象庁長期フィードの取得は private の `tools/jma-feed-recorder`（launchd・1 時間毎・Python）で、本体は録音（`bodies/`）を `replay` で読む。app の「今の電文」は `sharedReplayOrigin`（サーバ起動時刻からの仮想時計 × speed）で決まり、`/api/feed` は実時間に届いた警報では切り替わらない。「電文が届いたら画面が変わる」経路は未実装。外から施設の表示を切り替える口（`POST /api/admin/live`・`pnpm -F agents live`）は 11-06 に追加した（116963a）。→ 11-07 に修正（2e5b927・9b991bf）。気象庁の長期フィードを読んで本文を保存する `pnpm -F agents record` と、新しい電文から画面を作って表示を切り替える `pnpm -F agents receive` を足した。
2. **1 電文だけを live Writer で流す入口が無い。** `pipeline` は `--writer` の fixture が必須（live Writer は後で入れる、という英文の案内が残る）。live Writer は `fanout` / `replay-pipeline` だけで、どちらも `data/layouts/<自治体>` と reports を消して全電文を作り直す（`runReplay` の rmSync）。→ 11-07 に修正（46f0639）。`pipeline` に `--writer live|placeholder` と `--publish --go-live` を足し、1 電文の画面と index.json の行だけを書き換えるようにした（他の電文の画面は消さない）。
3. **場所は自治体につき 1 サイト。** `data/layouts/<id>/index.json` の `site` は 1 つで、`/api/live-layout`・`/api/feed`・export は自治体と電文で層を引き、サイト id は承認ゲートの鍵にしか使わない。同じ自治体に 2 台目のスクリーンを置くと 1 台目の避難所と方向が出る。任意座標の compose 自体は動く（B）が、その結果を置く場所が無い（`demo/sites/` は契約外）。→ 11-06 に修正（830594e・116963a）。画面一式・承認・フィードを施設ごとに持ち、同じ自治体に何施設でも置ける。
4. **避難所名が長いと 16:9 で矢印が消える。** B は shelter「砂子下コミュニティセンター」（12 字）が 51.2 px < 64 px で fail（文言で直せない種類）。renderer は `data-shelter-scale="narrow"` に縮めた上で `data-dropped="direction:overflow"` で方向セルを落とし、capture に矢印と「南へ」が無い。Verifier は font-size だけを指摘し、方向の欠落は指摘しない。由利本荘の避難所 220 か所の名前の長さ分布は未確認。→ 11-05 に修正（3129b5a）。方向セルが落ちた画面は Verifier が fail にする。
5. **人手の段。** サイト JSON の `municipality_id` は手書き（docs/integration.md）。Reader（自治体 PDF → 知識ファイル。05210 は 11-02 に $1.165）と `shelters`（GSI CSV）は事前の手動実行。承認と auto_publish は設計上の人手。→ **未対応**（市町村コードの自動判定は README の「今後」。承認は人が行う設計のまま）。
6. **承認は内容を見ない。** `data/approvals.json` は自治体/電文の鍵と updated_at だけで、Writer の書き直しや再 fanout の後も承認が残る（出典セルを変えた今回の再生成でも承認済みのまま）。→ 11-05 に修正（7fd5b78・2bb6ca9・acc252d）。承認はその時点の layout のダイジェストに束縛され、作り直した画面は「要再承認」になる。
7. **`/screen?lat=&lng=` は平時レイヤーの座標表示だけ。** 避難誘導はサイト JSON を Composer が読んで決める。→ **未対応**（仕様のまま）。
8. 運用上の注意: main を merge した後は `pnpm install` と dev の再起動が要る（three・@fontsource/noto-sans-thai の追加）。再起動前の実走 3 本は `data-ready` 待ちの 30 s timeout で落ちた。→ 運用上の注意（修正の対象ではない）。
9. **10 言語の文を別のモデルで逆翻訳して照合した（11-07）。** フィリピン語で「危険な所へ逃げよ」と逆に読まれうる 1 文と、訓練の津波の解除で「もう安全です」と言い過ぎていた欄・「すぐ」「海岸」が落ちていた欄 計 16 欄を直し、画面を作り直した（<commit>）。直した文は字数の上限に合わせて短くした。fil・id の訓練の津波の 4 欄は、字数の上限（24 字）に意味を保って収まる訳が無く未対応（母語話者と相談）。母語話者の確認はまだ。

## 文字サイズの下限: 視距離の前提を設置場所ごとに決める設計にした（2026-11-05）

Verifier の文字サイズの下限は、視距離から導いていた（1 inch / 10 ft・55 型 1080 px: 行動 11 m → 144 px、案内 5 m → 64 px、細字 2 m → 28 px。`app/layout/typography.ts` の `TYPE_PX`。renderer の既定サイズも同じ値）。11-05 に作者が Figma で 4 形状のレイアウトを手で組むと、16:9 の行動 120 px・言語帯 54 px（ラベル 24 px）・出典 24 px、1:1 の言語帯 56 px と出典 24 px（出典行は 11-05 に追加）がこの下限を割った（05210 の 6 画面すべてで同じ finding。Lv5 の再生成で発覚し、Lv4 でも同じ）。

ここから、下限は 1 つの視距離から決め打ちせず、設置場所の視距離の前提に合わせて決める設計にした。いまは Figma のレイアウトが前提とする距離に合わせ、`agents/src/verifier/checks.ts` の `ARTBOARD_FLOOR_PX` に形状ごとの下限を置いている。他の行は視距離の下限のまま（実測はすべて下限以上）。実際に導入するときは、その場所で見る距離から下限を決め直す。

避難先名（shelter）も、Figma の値の 2 段下まで下限を下げた（避難先名は文字を小さくして 1 行に収める方針）。16:9 は shelterNarrow 63 px × 0.92² → 53 px、1:1 は 51 px × 0.92² → 43 px（切り捨て）。9:16・32:9・柱は 64 px のまま。これも設置場所の視距離で決め直す前提の暫定値。

## Lv5 の避難先表示（2026-11-05・暫定）

警戒レベル 5（緊急安全確保・secure-now）の画面にも、いまは避難先と方向を出している（Composer の `NO_SHELTER_TEMPLATES` は空）。ただし内閣府の避難情報の考え方では、レベル 5 は「指定緊急避難場所等への立退き避難がかえって危険な段階」で、取るべき行動はその場での安全確保になる。画面では主文「高い所へ上がって」と go_higher の図記号が優先し、避難先と方向はその下に添える情報として置いている。Writer の Lv5 の検査規則（「にげる・ひなん」を使わない）も変えていない。実際に運用する前に、レベル 5 では避難先を出さないという判断もありうる。
