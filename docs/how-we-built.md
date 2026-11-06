# How we built it

## Sessions

EVAC LAYER was built by one lead session and, over the week, eight implementation sessions of Claude Code, each in its own git worktree and branch, while the author watched every tab and stepped in directly when needed. Three ran from Day 1; the others were opened as the work split.

- **Lead**: writes the specs, fixes the contract between the sessions, reviews each session's work and is the only one who merges `work/*` into `main`.
- **agents** (`agents/`, `schema/`, `data/`): JMA parser, Reader, Writer, Composer, Verifier, the revision loop and the export.
- **render** (`app/`): the renderer, the live feed, the delivery API and the admin screen.
- **demo** (`demo/`): the 3D scenes, the recordings and the video.
- **layout** (`app/layout/`, from Day 3): the alert screens re-laid on the modular grid the author drew in Figma; the render session does not touch layout.
- **sim** (`sim/`): the browser simulator of the concourse.
- **brand** (Figma, `docs/brand/`, `docs/sheets/`): the wordmark, the icon and the three sheets.
- **copy** (`README.md`, `docs/`, the narration): the public wording.
- **bgm** (`demo/compose/audio/`): the background music through Suno's MCP server and the switch sound effects.

The sessions talk through cross-session messages, using one fixed shape: conclusion, files changed, how it was checked, what could not be checked, open points. A session stops and asks only when a design decision comes up, when the spec and the code disagree, when the same failure happens twice, or before a destructive step.

EVAC LAYER は、1 つのまとめ役のセッションと、週のあいだに 8 つに増えた実装のセッションで作りました。どのセッションも Claude Code で、それぞれ自分の git worktree とブランチで作業し、作者はすべてのタブを見ていて、必要なときは直接指示しました。初日から動いていたのは 3 つで、残りは作業が分かれるたびに立ち上げました。

- **まとめ役**: 仕様を書き、セッションの間の取り決めを固め、各セッションの成果を確かめ、`work/*` を `main` に取り込む唯一の役。
- **agents**（`agents/`・`schema/`・`data/`）: 気象庁の電文の parser・Reader・Writer・Composer・Verifier・書き直しのループ・書き出し。
- **render**（`app/`）: Renderer・ライブのフィード・配信の API・運営者の画面。
- **demo**（`demo/`）: 3D の場面・録画・動画。
- **layout**（`app/layout/`、3 日目から）: 警報の画面を、作者が Figma で引いたモジュールのグリッドに組み直す。render のセッションはレイアウトに触らない。
- **sim**（`sim/`）: ブラウザで動くコンコースのシミュレーター。
- **brand**（Figma・`docs/brand/`・`docs/sheets/`）: ロゴ・アイコン・3 枚の説明図。
- **copy**（`README.md`・`docs/`・ナレーション）: 公開する文章。
- **bgm**（`demo/compose/audio/`）: Suno の MCP サーバーを使った BGM と、切り替えの効果音。

セッション同士は、セッション間のメッセージでやり取りします。形は 1 つに決めてあり、結論・変更したファイル・どう確かめたか・確かめられなかったこと・未解決の点です。セッションが止まって聞くのは、設計の判断が要るとき、仕様とコードが食い違ったとき、同じ失敗が 2 回起きたとき、取り消せない操作の前だけです。

## The contract

The layout JSON is the one thing every session depends on: the Composer writes it, the renderer draws it, the Verifier checks it. It is fixed in `schema/` and summarised in the `evac-contract` skill (`.claude/skills/`). Every change goes through the lead and is announced to the sessions that read it. The renderer's DOM attributes (`data-overflow="<cell>:<lang>"` and others) are part of the same contract, so the Verifier never reaches into the renderer's internals.

layout の JSON は、すべてのセッションが頼る唯一のものです。Composer が書き、Renderer が描き、Verifier が検査します。`schema/` に固定し、`evac-contract` スキル（`.claude/skills/`）に要点をまとめてあります。変更はすべてまとめ役を通し、それを読むセッションに知らせます。Renderer の DOM の属性（`data-overflow="<cell>:<lang>"` など）も同じ取り決めの一部なので、Verifier が Renderer の中身に手を入れることはありません。

## The revision loop

Compose → verify (static schema, then the rendered page in a browser, then Vision) → send the findings back → at most three attempts. A finding goes back to whoever wrote the cell: Writer text is rewritten, while anything the code writes (the JMA headline, the shelter, the source) stops the loop with a reason instead of asking the Writer for something it cannot change. The `evac-verify` skill has the full routing.

Run over the recorded feed, this loop found 25 defects on its first Vision pass and 0 by the fifth (`docs/evaluation.md`, `agents/FINDINGS.md`).

組む → 検査する（スキーマと規則、ブラウザで描いた画面、Vision）→ 指摘を戻す、を最大 3 回。指摘は、そのセルを書いた側に戻ります。Writer の文は書き直させ、コードが書く部分（気象庁の見出し・避難先・出典）の問題は、Writer に直せないことを頼まず、理由を添えてループを止めます。振り分けの全体は `evac-verify` スキルにあります。

記録した電文でこのループを回すと、Vision の初回の検査で 25 件の欠陥が見つかり、5 回目で 0 件になりました（`docs/evaluation.md`・`agents/FINDINGS.md`）。

## Checkpoints: each session hands its context back

Every return from a session ends the same way: what it concluded, which files it changed, how it checked them, what it could not check, and what is still open. The last two lines are the checkpoint. They make the session state the context the lead cannot see (an assumption it made, a number it took from another file, a check it could not run), and the lead decides on each open point before the next step: accept, send back with the cause and the fix, or ask the author. When the copy session compared the author's subtitles with the recorded bulletins, "could not check" and "open points" were where the mismatches surfaced, such as a JMA warning written as if a city had issued it, or a recording period of three weeks described as half a month.

各セッションの返却は、いつも同じ形で終わります。結論、変更したファイル、どう確かめたか、確かめられなかったこと、未解決の点。最後の 2 つが同期の確認点です。まとめ役からは見えない文脈（置いた前提、別のファイルから持ってきた数字、走らせられなかった検査）をセッション自身に書かせ、まとめ役は次の手に進む前に、未解決の点を 1 つずつ決めます。受け入れるか、原因と直し方を添えて差し戻すか、作者に聞くか。作者の字幕を記録した電文と照らしたときも、気象庁の警報を市が発令したように書いた語や、3 週間の記録期間を半月と書いた語は、この 2 行に出てきました。

## Evals, then the fix, then a hook

The checks came first and the fixes followed them. The Verifier (schema and rules, the rendered page in a browser, then Vision) and the test suites play the part of the evals: they say which screen fails and on which check, and the session that owns the cause finds it and fixes it there. When the level-5 screens were changed to show the evacuation site too, the Verifier failed the 16:9 and 1:1 shapes on text size. The cause was not the new screens: the lower limit for text had been derived from viewing distance, while the author's Figma layouts used smaller sizes on those shapes. The limit was revised shape by shape to the Figma sizes, with the old values and the reasoning kept in `agents/FINDINGS.md`, and the six 由利本荘市 screens were run again: 6 of 6 passed. What keeps a fixed defect fixed is automatic: the PostToolUse hook validates every file a session writes, the app and agents test suites run before each merge, and a coverage run renders every screen on every shape and aspect (440 renders) and counts overflow and missing items.

検査が先にあり、直しはその後に続きました。Verifier（スキーマと規則、ブラウザで描いた画面、Vision）とテスト群が評価の役で、どの画面がどの検査で落ちたかを示し、原因を持つセッションがそれを突き止めてその場で直します。警戒レベル 5 の画面にも避難場所を出すように変えたとき、Verifier は 16:9 と 1:1 を文字の大きさで落としました。原因は新しい画面ではなく、文字の下限を視距離から導いていた一方で、作者が Figma で組んだレイアウトはその形でもっと小さい文字を使っていたことでした。下限を形ごとに Figma の実寸へ改め、旧値と理由を `agents/FINDINGS.md` に残してから、由利本荘市の 6 画面を回し直すと 6 画面とも通りました。直した欠陥が戻らないようにする仕組みは自動です。PostToolUse フックがセッションの書いたファイルを毎回検証し、統合の前に app と agents のテストが走り、全画面を全形状・全画角で描く確認（440 枚）が溢れと欠けを数えます。

## Built for next year's model

The parts that decide what a screen may say are fixed outside the model: the layout, alert, municipality and feed schemas in `schema/`, the renderer's DOM attributes that the Verifier reads, and the approval gate (`/api/live-layout` serves a layout only for an approved bulletin at a site with automatic delivery switched on; approvals live in `data/approvals.json`). The Reader, the Writer and the Vision Verifier sit inside that frame. A newer model can replace any of them, write better text or catch more defects, and the screens still have the same cells, the same checks and the same rule that nothing reaches a screen without a person's approval. The Reader was chosen this way during the week: Haiku and Sonnet were run on the same 輪島市 documents and compared on the same output schema (`agents/README.md`).

画面に何を出してよいかを決める部分は、モデルの外に固定してあります。`schema/` の layout・alert・municipality・feed のスキーマ、検査役が読む描画側の DOM 属性、承認ゲート（`/api/live-layout` は、自動配信を入れたサイトの承認済みの電文にだけレイアウトを返す。承認の記録は `data/approvals.json`）。資料を読む役、文章を書く役、画面を見て検査する役は、その枠の中にいます。新しいモデルに入れ替えて、文章が良くなっても検査で拾える欠陥が増えても、画面のセルも、検査の規則も、人が承認したものしか画面に出ないという決まりも変わりません。今回も資料を読む役のモデルは、同じ輪島市の資料を Haiku と Sonnet で読ませ、同じ出力のスキーマの上で比べて選びました（`agents/README.md`）。

## Claude in the pipeline

- **Reader**: Sonnet 5.5 turns municipal hazard-map PDFs into knowledge files, with citations and structured outputs. When a PDF's text layer drops characters, it reads the page images instead.
- **Writer**: Opus 5.5 writes the action text in ten languages within per-shape character budgets. Its output passes rule checks and is cached so that the same alert gives the same screen.
- **Verifier (Vision)**: Sonnet 5.5 compares each rendered shape with its bulletin.

- **Reader**: Sonnet 5.5 が、自治体のハザードマップ PDF を、出典と構造化した出力つきの知識ファイルにします。PDF のテキストから文字が抜けているときは、ページを画像として読み直します。
- **Writer**: Opus 5.5 が、形状ごとの文字数の上限の中で、行動の文を 10 の言語で書きます。出力は検査規則を通り、同じ警報から同じ画面が出るように記録しておきます。
- **Verifier（Vision）**: Sonnet 5.5 が、描いた画面を形状ごとに電文と照らします。

## Claude Code features

- **Skills**: `evac-fanout`, `evac-verify` and `evac-contract` in `.claude/skills/`.
- **Subagents**: used for parallel research, for example one subagent per municipality when surveying hazard-map PDFs.
- **Hooks**: a PostToolUse hook (`.claude/settings.json`, `.claude/hooks/check-data.sh`) runs on every Write and Edit. It validates layouts, municipality files and fixtures against `schema/` and checks Writer records against the writing rules, and a violation goes straight back to the session that wrote the file. Files outside those paths are not touched, so the other sessions are unaffected. Changing project settings is not something a session may do by itself, so the author installed the hook after reviewing the draft.
- **MCP**: none in the product. The Reader, Writer and Vision Verifier call the Claude API through `@anthropic-ai/sdk`, and the Verifier's browser check drives Chrome with `puppeteer-core`, so the pipeline runs headless with no MCP server in the loop. During development the lead session used the Claude in Chrome extension (an MCP server into the author's own browser) once, to search Pinterest for signage references before deciding how to show the alert level; that design was later dropped. `blender-mcp` was weighed for the 3D scenes and rejected in favour of plain `bpy` scripts, so the scene is reproducible from the repository (`demo/APPROACH.md`). Traffic between the sessions is Claude Code's cross-session messaging, not MCP.

- **スキル**: `.claude/skills/` の `evac-fanout`・`evac-verify`・`evac-contract`。
- **サブエージェント**: 並行の調査に使いました。たとえばハザードマップ PDF を調べるときは、自治体ごとに 1 つずつ。
- **フック**: PostToolUse のフック（`.claude/settings.json`・`.claude/hooks/check-data.sh`）が、Write と Edit のたびに走ります。レイアウト・自治体のファイル・テスト用のデータを `schema/` で検証し、Writer の記録を文章の規則で検査し、違反はそのファイルを書いたセッションにすぐ戻ります。対象外のパスのファイルには触れないので、ほかのセッションには影響しません。プロジェクトの設定はセッションが自分で変えてよいものではないので、作者が下書きを確かめてからフックを入れました。
- **MCP**: 製品には使っていません。Reader・Writer・Vision の Verifier は `@anthropic-ai/sdk` で Claude の API を呼び、Verifier のブラウザの検査は `puppeteer-core` で Chrome を動かすので、パイプラインは MCP サーバーを挟まず、画面なしで動きます。開発中は、まとめ役のセッションが Claude in Chrome の拡張（作者のブラウザにつながる MCP サーバー）を 1 回だけ使い、警戒レベルの見せ方を決める前に Pinterest でサイネージの参考を探しました。その案は後に取り下げました。3D の場面には `blender-mcp` も検討しましたが、リポジトリから場面を作り直せるよう、素の `bpy` のスクリプトにしました（`demo/APPROACH.md`）。セッションの間のやり取りは Claude Code のセッション間のメッセージで、MCP ではありません。
