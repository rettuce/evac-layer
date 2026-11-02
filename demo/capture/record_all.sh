#!/usr/bin/env bash
set -uo pipefail
# Records each shape x cut used by the 3D shots. Point it at a server nobody else is editing:
# a dev server's HMR reloads the page whenever another seat saves a file.
#   CUTS="ambient switch" SHAPES="9x16 32x9" demo/capture/record_all.sh http://127.0.0.1:3151
cd "$(dirname "$0")/../.."
base_url="${1:-http://127.0.0.1:3151}"
cuts="${CUTS:-ambient switch alert}"
shapes="${SHAPES:-16x9 9x16 32x9 1x1}"
site_args=()
[ -n "${SITE_NAME:-}" ] && site_args=(--site-name "$SITE_NAME")
failed=0
for cut in $cuts; do
  for shape in $shapes; do
    node demo/capture/record.mjs --base-url "$base_url" --shape "$shape" --cut "$cut" ${site_args[@]+"${site_args[@]}"} --verify \
      || failed=$((failed + 1))
  done
done
echo "RECORD_ALL done failed=${failed}"
exit "$failed"
