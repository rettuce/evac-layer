# EVAC LAYER

**The screens are already there.**
Turn the screens a city already has into evacuation guidance anyone can read.

**スクリーンはもうある。**
街にすでにあるスクリーンを、いちばん伝えなければならない瞬間に、誰にでも読める避難案内へ変える。

![A level-4 flood warning on a 16:9 screen, drawn from a real JMA bulletin for Yurihonjo, Akita](docs/screens/lv4-16x9.png)

[All screens — every shape and level, the pillar, the ambient layer and the switch →](docs/screens.md)

Built from scratch during **Built with Claude: Japan 2026** (Nov 2–8, 2026). Status: Day 2.

[Demo video — coming Nov 8] · [日本語の概要](#日本語の概要)

## Why

**After the takeover, what do you draw?** / 乗っ取ったあと、何を描くか。

_[Day 2 で埋める: 能登半島地震で津波の避難先を判断できなかった来訪者がいた事実（上越市の検証）、駅・商業施設のサイネージを作ってきた作り手の立場、CAP / L アラートが「画面を乗っ取る」ところまでしか決めていないこと]_

## What it does

_[Day 2 で埋める: 自治体 PDF と国土地理院の避難場所データを読み、気象庁の電文で切り替わる案内画面を 4 つの画面形状 × 多言語 × 図記号で生成し、検査し、承認済みのものだけを配信する]_

## How it works

_[Day 2 で埋める: 2 層の図。Reader → 自治体知識 JSON / 気象庁 XML → Writer → Composer → Renderer → Verifier → 承認 → 配信]_

## Human in the loop

**Decide in calm. Deliver in crisis.** / 平時に決めて、有事は自動。

EVAC LAYER drafts. People decide, ahead of time. For each venue it generates the full set of guidance screens (hazard × alert level × language × screen shape), each carrying its sources (the municipal PDF page and the JMA bulletin ID) and an automated inspection report. An operator reviews and approves the set in calm times. When a bulletin arrives, only approved screens go up, deterministically.

## Any screen. / どの画面にも

_[Day 2 で埋める: 配信層。feed（pull）・webhook（push）・static export（画像だけ受け取れる CMS 向け）。MOJUR には最初から内蔵、他社 CMS は `docs/integration.md` と `examples/minimal-cms/`]_

## What the real data caught

_[Day 2 で埋める: agents/README の「What the real data caught」から。PDF の欠字・レベル 5 の取りこぼし・表示していない警報の解除・長い施設名]_

## Data sources and licenses

_[Day 2 で埋める: 気象庁 防災情報 XML（公式サンプルと記録した実電文）・国土地理院 指定緊急避難場所（PDL1.0）・自治体の防災 PDF（出典ページつき）・Material Symbols（Apache-2.0）・Noto（OFL）・Poly Haven（CC0）]_

## What this is not

_[Day 2 で埋める: L アラートや公式配信の代替ではない。停電時の表示は保証しない。避難案内の発行者は自治体である]_

## Built during the hackathon

_[Day 2 で埋める: 事前（調査・設計・データ取得・気象庁フィードの記録）と本番（コード）の線引き。Claude Code の使い方（司令官 1 席＋実装 3 席の tmux・契約 v0・仮想時計・Verifier）]_

## Run it

_[Day 2 で埋める: pnpm install / app dev / agents の CLI。`app/README.md` と `agents/README.md` に詳細]_

## License

License: AGPL-3.0 (see `LICENSE`). Copyright (C) 2026 You Tanaka.
Free for municipalities, public-safety organizations, research and personal use.
Commercial license for embedding into proprietary signage products: contact IE3 (you@ie3.jp).

External contributions are not accepted during the hackathon (Nov 2–8, 2026). See `CONTRIBUTING.md`.

## 日本語の概要

_[Day 2 で埋める: 提出用の日本語概要（誰の・どんな課題を・どう解決するか・ハッカソン後に誰が使い続けるか）]_
