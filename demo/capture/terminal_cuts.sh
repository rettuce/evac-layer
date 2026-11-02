#!/usr/bin/env bash
#   JMA_SAMPLES_DIR=... JMA_FEED_DIR=... VERIFIER_URL=http://127.0.0.1:3153 demo/capture/terminal_cuts.sh [cut03 cut04 cut06]
# VERIFIER_URL must be a dev server of this worktree: the browser Verifier reads /api/layout, which is dev only.
# Without an API key, cut 3 shows the Reader stopping on the suspect PDF and then the knowledge file a live run
# wrote; cut 4 shows the cached live Writer output and composes it. Both are re-shot with the key after the freeze.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${JMA_SAMPLES_DIR:?set JMA_SAMPLES_DIR to the JMA sample XML directory}"
: "${JMA_FEED_DIR:?set JMA_FEED_DIR to the recorded JMA feed directory}"
verifier_url="${VERIFIER_URL:-http://127.0.0.1:3153}"

writer_cache=data/writer/05210/VXKOii-202610211815-e713da0e3c05.json
cut4_alert="$JMA_FEED_DIR/bodies/20261021/20261021091533_0_VXKO55_050000.xml"
cut6_alert="$JMA_SAMPLES_DIR/32-39_12_02_250206_VTSE41.xml"
fixtures=agents/test/fixtures

cut03() {
  node demo/capture/terminal.mjs --name cut03 \
    --show 'pnpm -F agents reader --municipality 17204' \
    --cmd "pnpm -s -F agents reader --municipality 17204; sleep 1.2; \
      printf '\033[38;5;245m\$\033[0m %s\n' 'jq \".hazards[0]\" data/municipalities/17204.json'; sleep 0.8; \
      jq -C '.hazards[0]' data/municipalities/17204.json"
}

cut04() {
  mkdir -p tmp/cut4
  jq '.output' "$writer_cache" > tmp/cut4/writer-1815.json
  node demo/capture/terminal.mjs --name cut04 \
    --show "jq -c '.output.cells[] | {role, ja, ja_easy, en}' $writer_cache" \
    --cmd "jq -C -c '.output.cells[] | {role, ja: .text.ja, ja_easy: .text.ja_easy, en: .text.en}' $writer_cache; sleep 1.5; \
      printf '\033[38;5;245m\$\033[0m %s\n' 'pnpm -F agents compose --alert …VXKO55_050000.xml --municipality 05210 --site data/sites/05210-demo.json --writer writer-1815.json'; sleep 0.8; \
      pnpm -s -F agents compose --alert '$cut4_alert' --municipality 05210 --site data/sites/05210-demo.json --writer tmp/cut4/writer-1815.json --out-dir tmp/cut4 2>&1 | sed 's|$PWD/||'; sleep 0.8; \
      for f in tmp/cut4/05210-*.json; do jq -C -c '{shape, template, roles: [.cells[].role]}' \"\$f\"; done"
}

cut06() {
  node demo/capture/terminal.mjs --name cut06 \
    --show 'pnpm -F agents pipeline --alert …VTSE41.xml --municipality 17204 --writer …advisory-distance.json --revisions …advisory.json --verifier browser' \
    --cmd "pnpm -s -F agents pipeline --alert '$cut6_alert' --municipality 17204 --site $fixtures/site-wajima-test.json \
      --writer $fixtures/writer-tsunami-advisory-distance.json --revisions $fixtures/writer-tsunami-advisory.json \
      --verifier browser --base-url $verifier_url"
}

[ $# -eq 0 ] && set -- cut03 cut04 cut06
for cut in "$@"; do "$cut"; done
