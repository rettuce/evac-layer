#!/usr/bin/env bash
#   LOOK=C demo/blender/render_cut.sh cut01 cut02 cut05 cut08 cut09
# cut08 is three close-ups (column, ribbon, back wall) rendered as cut08a-c and joined.
# cut09 gets the minimal-CMS clip (demo/capture/out/cut09_pip.mp4) inset bottom right.
set -euo pipefail
cd "$(dirname "$0")/../.."
look="${LOOK:-C}"
pip_width=540
pip_margin=48
render_shot() {
  blender -b -P demo/blender/build_scene.py -- --shot "$1" --look "$look" --out "$2" 2>&1 \
    | grep -E "RENDER_STATS|Error|Traceback" || true
  [ -s "$2" ] || { echo "RENDER_CUT failed: $1 produced no $2" >&2; exit 1; }
}
for cut in "$@"; do
  out="demo/renders/${cut}.mp4"
  [ "$cut" = cut09 ] && out="demo/renders/cut09_3d.mp4"
  if [ "$cut" = cut08 ]; then
    parts=demo/renders/cut08_parts.txt
    : > "$parts"
    for part in a b c; do
      render_shot "cut08$part" "demo/renders/cut08$part.mp4"
      echo "file 'cut08$part.mp4'" >> "$parts"
    done
    ffmpeg -y -loglevel error -f concat -safe 0 -i "$parts" -c copy "$out"
  else
    render_shot "$cut" "$out"
  fi
  if [ "$cut" = cut09 ]; then
    pip="demo/capture/out/cut09_pip.mp4"
    [ -s "$pip" ] || { echo "RENDER_CUT failed: cut09 needs $pip (node demo/capture/pip_cms.mjs)" >&2; exit 1; }
    ffmpeg -y -loglevel error -i "$out" -i "$pip" -filter_complex \
      "[1:v]scale=${pip_width}:-2,tpad=stop_mode=clone:stop=-1[p];[0:v][p]overlay=W-w-${pip_margin}:H-h-${pip_margin}:shortest=1" \
      -c:v libx264 -crf 18 -pix_fmt yuv420p -an demo/renders/cut09.mp4
  fi
  echo "RENDER_CUT ok $cut look=$look"
done
