# 最初の実証の進め方

EVAC LAYER を実際のサイネージで動かす最初の実証の形です。決まっているのは設計と手順で、相手と日程はこれから決めます。

## 対象

サイネージを持つ施設 1 つと、その施設がある自治体 1 つ。

## 必要なもの

- **スクリーンの緯度経度と向き。** 向きは、画面を見る人が向いている方角です。矢印はこれを基準に回します。
- **自治体の資料。** ハザードマップの PDF と、国土地理院の指定緊急避難場所の一覧。
- **画面を受け取る HTTP の口 1 本。** Pull（フィードを読む）、署名付きの Webhook、書き出したファイルのどれか 1 つです（[`docs/integration.md`](integration.md)）。

## 手順

1. **施設を登録する。** `pnpm -F agents site` に緯度経度と向きを渡すと、国土地理院の逆ジオコーダーで自治体のコードを引き、施設のファイルを作ります。
2. **自治体の資料を読む。** 初めての自治体は、資料の一覧を書いたファイルを用意してから、Reader でハザードマップの PDF を知識ファイルにします。主張ごとに PDF のページが出典として付きます。
3. **画面を一式つくる。** `pnpm -F agents fanout` で、その自治体の電文ごとに、文を書き、画面を組み、検査します。
4. **人が承認する。** `/admin` で電文ごとに画面を見て承認し、施設の自動配信を有効にします。
5. **待つ。** 平常時は何も出しません。いま使っている CMS の画面がそのまま流れます。
6. **警報で切り替わる。** `pnpm -F agents receive` が気象庁の電文を読み、承認済みの種類の画面なら表示を切り替えます。未承認の画面は出さず、直前の承認済みの画面を保ちます。
7. **解除を伝える。** 解除の電文の画面が承認されていれば、「避難は不要です」の解除の画面に切り替わります。

## 期間と作業量の目安

- **準備の作業は 2 つ。** 資料の読み取り結果の確認と、画面の承認。
- **運用は無人。** 承認済みの種類の警報なら、人の操作なしに切り替わります。新しい種類の電文は、承認を待ちます。
- **API の費用は、1 自治体あたり年に約 $13 の見込みです。** 前提と内訳は [`docs/evaluation.md`](evaluation.md)。

## 役割

| 誰が | 何を |
|---|---|
| 施設 | スクリーンと、画面を受け取る口を用意する |
| 自治体 | 資料と避難場所を確かめ、画面の文言を確かめる |
| EVAC LAYER の側 | 画面の生成、検査、承認の画面を用意する |

## 事前に決めておくこと

- **誰が承認するか。** 施設か、自治体か、両方か。
- **解除の扱い。** いまは、解除の画面が承認されるまで直前の警報を出し続けます。
- **レベル 5 の表示。** いまはレベル 5 の画面にも避難先と方向を添えています。レベル 5 はその場での安全確保が求められる段階なので、避難先を出さない判断もありえます（[`agents/FINDINGS.md`](../agents/FINDINGS.md)「Lv5 の避難先表示」）。
- **多言語の文の確認。** 各言語の文を、その言語を母語とする人に確かめてもらいます。
- **画面に出す責任の所在。** EVAC LAYER は警報も避難情報も出しません（README「EVAC LAYER がしないこと」）。画面に何を出すかを最後に決めるのは誰かを決めます。

## 実証で測ること

- 警報の電文が出てから、画面が切り替わるまでの秒数
- 承認に要した時間
- 訳を直した回数
- 来訪者の反応（アンケートの設計は、相手と決めます）

## English summary

- A first pilot pairs one venue that runs signage with the municipality it sits in.
- Inputs: each screen's coordinates and facing, the municipality's hazard-map PDFs and GSI evacuation sites, and one HTTP endpoint (pull, signed webhook or files).
- Steps: register the site, read the PDFs with the Reader, generate screens with fanout, approve them in /admin, then `receive` switches to the approved screens on a warning and to the all-clear screen when it is lifted.
- Preparation is checking the Reader's output and approving the screens; operation is unattended; API cost is about $13 per municipality per year.
- To agree beforehand: who approves, how all-clears are handled, the Level 5 display, native-speaker review, and who is responsible for what is shown.
