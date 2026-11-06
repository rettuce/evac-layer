# How we built it

## Seats

EVAC LAYER was built by one commander session and, over the week, eight implementation sessions of Claude Code, each in its own git worktree and branch, while the author watched every tab and stepped in directly when needed. Three ran from Day 1; the others were opened as the work split.

- **Commander**: writes the specs, fixes the contract between the seats, reviews each seat's work and is the only one who merges `work/*` into `main`.
- **agents** (`agents/`, `schema/`, `data/`): JMA parser, Reader, Writer, Composer, Verifier, the revision loop and the export.
- **render** (`app/`): the renderer, the live feed, the delivery API and the admin screen.
- **demo** (`demo/`): the 3D scenes, the recordings and the video.
- **layout** (`app/layout/`, from Day 3): the alert screens re-laid on the modular grid the author drew in Figma; the renderer seat does not touch layout.
- **sim** (`sim/`): the browser simulator of the concourse.
- **brand** (Figma, `docs/brand/`, `docs/sheets/`): the wordmark, the icon and the three sheets.
- **copy** (`README.md`, `docs/`, the narration): the public wording.
- **bgm** (`demo/compose/audio/`): the background music through Suno's MCP server and the switch sound effects.

The seats talk through cross-session messages, using one fixed shape: conclusion, files changed, how it was checked, what could not be checked, open points. A seat stops and asks only when a design decision comes up, when the spec and the code disagree, when the same failure happens twice, or before a destructive step.

## The contract

The layout JSON is the one thing every seat depends on: the Composer writes it, the renderer draws it, the Verifier checks it. It is fixed in `schema/` and summarised in the `evac-contract` skill (`.claude/skills/`). Every change goes through the commander and is announced to the seats that read it. The renderer's DOM attributes (`data-overflow="<cell>:<lang>"` and others) are part of the same contract, so the Verifier never reaches into the renderer's internals.

## The revision loop

Compose → verify (static schema, then the rendered page in a browser, then Vision) → send the findings back → at most three attempts. A finding goes back to whoever wrote the cell: Writer text is rewritten, while anything the code writes (the JMA headline, the shelter, the source) stops the loop with a reason instead of asking the Writer for something it cannot change. The `evac-verify` skill has the full routing.

Run over the recorded feed, this loop found 25 defects on its first Vision pass and 0 by the fifth (`docs/evaluation.md`, `agents/FINDINGS.md`).

## Checkpoints: each seat hands its context back

Every return from a seat ends the same way: what it concluded, which files it changed, how it checked them, what it could not check, and what is still open. The last two lines are the checkpoint. They make the seat state the context the commander cannot see (an assumption it made, a number it took from another file, a check it could not run), and the commander decides on each open point before the next step: accept, send back with the cause and the fix, or ask the author. When the copy seat compared the author's subtitles with the recorded bulletins, "could not check" and "open points" were where the mismatches surfaced, such as a JMA warning written as if a city had issued it, or a recording period of three weeks described as half a month.

各セッションの返却は、いつも同じ形で終わります。結論、変更したファイル、どう確かめたか、確かめられなかったこと、未解決の点。最後の 2 つが同期の確認点です。司令官からは見えない文脈（置いた前提、別のファイルから持ってきた数字、走らせられなかった検査）をセッション自身に書かせ、司令官は次の手に進む前に未解決の点を 1 つずつ裁きます。受け入れるか、原因と直し方を添えて差し戻すか、作者に聞くか。作者の字幕を記録した電文と照らしたときも、気象庁の警報を市が発令したように書いた語や、3 週間の記録期間を半月と書いた語は、この 2 行に出てきました。

## Evals, then the fix, then a hook

The checks came first and the fixes followed them. The Verifier (schema and rules, the rendered page in a browser, then Vision) and the test suites play the part of the evals: they say which screen fails and on which check, and the seat that owns the cause finds it and fixes it there. When the level-5 screens were changed to show the evacuation site too, the Verifier failed the 16:9 and 1:1 shapes on text size. The cause was not the new screens: the lower limit for text had been derived from viewing distance, while the author's Figma layouts used smaller sizes on those shapes. The limit was revised shape by shape to the Figma sizes, with the old values and the reasoning kept in `agents/FINDINGS.md`, and the six 由利本荘市 screens were run again: 6 of 6 passed. What keeps a fixed defect fixed is automatic: the PostToolUse hook validates every file a session writes, the app and agents test suites run before each merge, and a sweep renders every screen on every shape and aspect (440 renders) and counts overflow and missing items.

検査が先にあり、直しはその後に続きました。Verifier（スキーマと規則、ブラウザで描いた画面、Vision）とテスト群が評価の役で、どの画面がどの検査で落ちたかを示し、原因を持つセッションがそれを突き止めてその場で直します。警戒レベル 5 の画面にも避難場所を出すように変えたとき、Verifier は 16:9 と 1:1 を文字の大きさで落としました。原因は新しい画面ではなく、文字の下限を視距離から導いていた一方で、作者が Figma で組んだレイアウトはその形でもっと小さい文字を使っていたことでした。下限を形ごとに Figma の実寸へ改め、旧値と理由を `agents/FINDINGS.md` に残してから、由利本荘市の 6 画面を回し直すと 6 画面とも通りました。直した欠陥が戻らないようにする仕組みは自動です。PostToolUse フックがセッションの書いたファイルを毎回検証し、統合の前に app と agents のテストが走り、全画面を全形状・全画角で描く走査（440 枚）が溢れと欠けを数えます。

## Built for next year's model

The parts that decide what a screen may say are fixed outside the model: the layout, alert, municipality and feed schemas in `schema/`, the renderer's DOM attributes that the Verifier reads, and the approval gate (`/api/live-layout` serves a layout only for an approved bulletin at a site with automatic delivery switched on; approvals live in `data/approvals.json`). The Reader, the Writer and the Vision Verifier sit inside that frame. A newer model can replace any of them, write better text or catch more defects, and the screens still have the same cells, the same checks and the same rule that nothing reaches a screen without a person's approval. The Reader was chosen this way during the week: Haiku and Sonnet were run on the same 輪島市 documents and compared on the same output schema (`agents/README.md`).

画面に何を出してよいかを決める部分は、モデルの外に固定してあります。`schema/` の layout・alert・municipality・feed のスキーマ、検査役が読む描画側の DOM 属性、承認ゲート（`/api/live-layout` は、自動配信を入れたサイトの承認済みの電文にだけレイアウトを返す。承認の記録は `data/approvals.json`）。資料を読む役、文章を書く役、画面を見て検査する役は、その枠の中にいます。新しいモデルに入れ替えて、文章が良くなっても検査で拾える欠陥が増えても、画面のセルも、検査の規則も、人が承認したものしか画面に出ないという決まりも変わりません。今回も資料を読む役のモデルは、同じ輪島市の資料を Haiku と Sonnet で読ませ、同じ出力のスキーマの上で比べて選びました（`agents/README.md`）。

## Claude in the pipeline

- **Reader**: Sonnet 5.5 turns municipal hazard-map PDFs into knowledge files, with citations and structured outputs. When a PDF's text layer drops characters, it reads the page images instead.
- **Writer**: Opus 5.5 writes the action text in ten languages within per-shape character budgets. Its output passes deterministic lints and is cached so that the same alert gives the same screen.
- **Verifier (Vision)**: Sonnet 5.5 compares each rendered shape with its bulletin.

## Claude Code features

- **Skills**: `evac-fanout`, `evac-verify` and `evac-contract` in `.claude/skills/`.
- **Subagents**: used for parallel research, for example one subagent per municipality when surveying hazard-map PDFs.
- **Hooks**: a PostToolUse hook (`.claude/settings.json`, `.claude/hooks/check-data.sh`) runs on every Write and Edit. It validates layouts, municipality files and fixtures against `schema/` and lints Writer records, and a violation goes straight back to the session that wrote the file. Files outside those paths are not touched, so the other seats are unaffected. Changing project settings is not something a session may do by itself, so the author installed the hook after reviewing the draft.
- **MCP**: none in the product. The Reader, Writer and Vision Verifier call the Claude API through `@anthropic-ai/sdk`, and the Verifier's browser check drives Chrome with `puppeteer-core`, so the pipeline runs headless with no MCP server in the loop. During development the commander used the Claude in Chrome extension (an MCP server into the author's own browser) once, to search Pinterest for signage references before deciding how to show the alert level; that design was later dropped. `blender-mcp` was weighed for the 3D scenes and rejected in favour of plain `bpy` scripts, so the scene is reproducible from the repository (`demo/APPROACH.md`). Traffic between the seats is Claude Code's cross-session messaging, not MCP.
