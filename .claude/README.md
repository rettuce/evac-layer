# .claude

Project settings for Claude Code: three skills and one hook. Every session that worked on this repository loaded them.

Claude Code のプロジェクト設定です。スキル 3 本とフック 1 本があり、このリポジトリで作業したセッションはすべてこれを読み込みました。

## Skills / スキル

| Skill | Purpose | When it fires | What it protects |
|---|---|---|---|
| [`evac-contract`](skills/evac-contract/SKILL.md) | The contract between the Composer, Writer and Verifier, the renderer and the demo: layout JSON fields, templates, shapes, the DOM attributes the Verifier reads. | Before changing a layout field, a template, a shape, a DOM attribute or anything another part depends on. | One change, made in one place and announced to every part that reads it. `schema/` is the machine-checked version. |
| [`evac-verify`](skills/evac-verify/SKILL.md) | How to read Verifier results and decide where a finding goes back to: the Writer, the Composer or the renderer. | When a screen fails, when a report or finding needs explaining, or before changing the revision loop. | The Writer is never asked to fix what code writes (the JMA headline, the shelter, the source), and a failed screen is never published by hand. |
| [`evac-fanout`](skills/evac-fanout/SKILL.md) | Replays the recorded JMA feed of one or more municipalities through the revision loop and writes `data/layouts` and `data/reports`. | When asked to regenerate screens, add a municipality or re-verify after a Composer, Writer or renderer change. | Only a browser or Vision pass may mark a screen as shown, and every bulletin without a screen keeps its reason in `index.json`. |

| スキル | 目的 | いつ使うか | 何を守るか |
|---|---|---|---|
| `evac-contract` | Composer・Writer・Verifier・Renderer・デモの間の取り決め（layout の JSON の項目・テンプレート・形状・Verifier が読む DOM の属性）。 | layout の項目・テンプレート・形状・DOM の属性など、ほかの部分が頼るものを変える前。 | 変更は 1 か所で行い、それを読むすべての部分に知らせる。機械で検査する版は `schema/`。 |
| `evac-verify` | Verifier の結果の読み方と、指摘の戻し先（Writer・Composer・Renderer）の決め方。 | 画面が落ちたとき、検査レポートや指摘を説明するとき、書き直しのループを変える前。 | コードが書く部分（気象庁の見出し・避難先・出典）を Writer に直させない。落ちた画面を手で公開しない。 |
| `evac-fanout` | 自治体ごとに記録した気象庁の電文を書き直しのループに通し、`data/layouts` と `data/reports` を書く。 | 画面を作り直すとき、自治体を足すとき、Composer・Writer・Renderer を変えた後に検査し直すとき。 | 画面を出してよいと記録できるのはブラウザか Vision の検査だけ。画面の無い電文にも、理由を `index.json` に残す。 |

## Hook / フック

[`hooks/check-data.sh`](hooks/check-data.sh) runs after every Write and Edit (PostToolUse). It validates layout, municipality, site and test-fixture JSON against `schema/`, and checks Writer records against the writing rules. A violation is returned to the session that wrote the file at once; other paths are left alone.

[`hooks/check-data.sh`](hooks/check-data.sh) は、Write と Edit のたびに走ります（PostToolUse）。レイアウト・自治体・施設・テスト用のデータの JSON を `schema/` で検証し、Writer の記録を文章の規則で検査します。違反は、そのファイルを書いたセッションにすぐ戻ります。対象外のパスには触れません。

## settings.json

[`settings.json`](settings.json) only registers that hook: `PostToolUse`, matcher `Write|Edit`, timeout 60 s. It grants no permissions and sets no model. A session may not change project settings by itself, so the author installed the hook after reviewing the draft.

[`settings.json`](settings.json) は、上のフックを登録しているだけです（`PostToolUse`・対象は `Write|Edit`・60 秒で打ち切り）。権限やモデルの設定はありません。プロジェクトの設定はセッションが自分で変えてよいものではないので、作者が下書きを確かめてからフックを入れました。
