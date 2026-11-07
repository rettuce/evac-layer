---
name: evac-fanout
description: Replay the recorded JMA feed of one or more municipalities through Composer → Verifier → Writer revisions and write data/layouts and data/reports. Use when asked to regenerate screens, run the fan-out, add a municipality, or re-verify after a Composer, Writer or renderer change.
---

# evac-fanout

Runs every recorded bulletin of each municipality through the revision loop and publishes the result.

## Before running

- The app must answer on the agents dev port: `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3152/screen` prints `200` (start it from `app/` with `pnpm exec nuxt dev --host 127.0.0.1 --port 3152` if not; the `dev` script uses the render session's port 3150; never kill another session's server by name pattern, find the PID with `lsof -nP -iTCP:<port> -sTCP:LISTEN`).
- A new municipality needs `data/municipalities/<id>.json` (Reader), `data/municipalities/<id>.shelters.json` (`pnpm -F agents shelters <id>`, after adding the id and the CSV retrieval date to `agents/src/reader/shelters-cli.ts`) and `data/sites/<id>-demo.json` (hand-written; the fan-out only reads it).
- `ANTHROPIC_API_KEY` is read from `.env` by the scripts. Do not open `.env`.

## Command

```bash
pnpm -F agents -s fanout --municipalities 05210,17204 --verifier vision --writer live --writer-model opus > tmp/fanout.log 2>&1
```

- `--verifier static | browser | vision` — only a browser or Vision pass may set `screen: true`; a static-only pass is recorded as "not browser-verified".
- `--writer live` reuses `data/writer/<id>/<bulletin>.json` when it exists. To make the Writer write again, move that file to `tmp/` (do not delete it) and re-run.
- `--skip-browser-shapes pillar` checks a shape statically only and marks the index row `browser_skipped`; use it only while the renderer lacks the shape.

## Done when

- The summary table shows `fail 0` for every municipality, or every failure has a reason in `data/layouts/<id>/index.json` that belongs to another session (for example `render-overflow[headline:ja]`).
- Every bulletin without a screen has its reason in `index.json` (below the threshold, an all-clear for something never shown).
- `pnpm -F agents validate data/layouts/<id>/*/*.json` prints only `OK`.
- The Writer and Vision costs printed on each `done:` line are recorded, and new Verifier findings go to `data/verifier-findings/` (one entry per shape, `fix` filled once fixed).

## Stop and ask when

- A finding repeats after two Writer rewrites (the loop stops by itself; do not raise the limit).
- A fix would change the layout contract (see the `evac-contract` skill) or another session's directory.
