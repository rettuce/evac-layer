#!/usr/bin/env bash
#   LOOK=C demo/blender/render_cut.sh cut01 cut02 cut05 cut08 cut09
set -euo pipefail
cd "$(dirname "$0")/../.."
look="${LOOK:-C}"
render_shot() {
  blender -b -P demo/blender/build_scene.py -- --shot "$1" --look "$look" --out "$2" 2>&1 \
    | grep -E "RENDER_STATS|Error|Traceback" || true
  [ -s "$2" ] || { echo "RENDER_CUT failed: $1 produced no $2" >&2; exit 1; }
}
for cut in "$@"; do
  render_shot "$cut" "demo/renders/${cut}.mp4"
  echo "RENDER_CUT ok $cut look=$look"
done
