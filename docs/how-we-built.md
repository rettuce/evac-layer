# How we built it

Draft from the agents seat; the commander finishes it.

## Seats

EVAC LAYER was built by four Claude Code sessions working at the same time, each in its own git worktree and branch, while the author watched every tab and stepped in directly when needed.

- **Commander**: writes the specs, fixes the contract between the seats, reviews each seat's work and is the only one who merges `work/*` into `main`.
- **agents** (`agents/`, `schema/`, `data/`): JMA parser, Reader, Writer, Composer, Verifier, the revision loop and the export.
- **render** (`app/`): the renderer, the live feed, the delivery API and the admin screen.
- **demo** (`demo/`): the 3D scenes and the recordings.

The seats talk through cross-session messages, using one fixed shape: conclusion, files changed, how it was checked, what could not be checked, open points. A seat stops and asks only when a design decision comes up, when the spec and the code disagree, when the same failure happens twice, or before a destructive step.

## The contract

The layout JSON is the one thing every seat depends on: the Composer writes it, the renderer draws it, the Verifier checks it. It is fixed in `schema/` and summarised in the `evac-contract` skill (`.claude/skills/`). Every change goes through the commander and is announced to the seats that read it. The renderer's DOM attributes (`data-overflow="<cell>:<lang>"` and others) are part of the same contract, so the Verifier never reaches into the renderer's internals.

## The revision loop

Compose → verify (static schema, then the rendered page in a browser, then Vision) → send the findings back → at most three attempts. A finding goes back to whoever wrote the cell: Writer text is rewritten, while anything the code writes (the JMA headline, the shelter, the source) stops the loop with a reason instead of asking the Writer for something it cannot change. The `evac-verify` skill has the full routing.

Run over the recorded feed, this loop found 25 defects on its first Vision pass and 0 by the fifth (`docs/evaluation.md`, `agents/FINDINGS.md`).

## Claude in the pipeline

- **Reader**: Sonnet 5.5 turns municipal hazard-map PDFs into knowledge files, with citations and structured outputs. When a PDF's text layer drops characters, it reads the page images instead.
- **Writer**: Opus 5.5 writes the action text in six languages within per-shape character budgets. Its output passes deterministic lints and is cached so that the same alert gives the same screen.
- **Verifier (Vision)**: Sonnet 5.5 compares each rendered shape with its bulletin.

## Claude Code features

- **Skills**: `evac-fanout`, `evac-verify` and `evac-contract` in `.claude/skills/`.
- **Subagents**: used for parallel research, for example one subagent per municipality when surveying hazard-map PDFs.
- **Hooks**: a PostToolUse hook (`.claude/settings.json`, `.claude/hooks/check-data.sh`) runs on every Write and Edit. It validates layouts, municipality files and fixtures against `schema/` and lints Writer records, and a violation goes straight back to the session that wrote the file. Files outside those paths are not touched, so the other seats are unaffected. Changing project settings is not something a session may do by itself, so the author installed the hook after reviewing the draft.
- **MCP**: the commander fills this in.
