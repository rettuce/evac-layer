#!/usr/bin/env bash
# Cut 8 (v9): each screen changes bulletin as the camera starts its next move (11/3 s and 28/3 s into the
# 15 s shot, the holds of build_scene.py SHOTS["cut08"]): Lv3 -> Lv4 -> tsunami drill, cut on whole frames.
#   SHAPES="16x9 9x16 32x9 1x1 pillar" demo/capture/cut08_sequence.sh   (after record.mjs --cut alert-lv3|alert-lv4|alert-tsunami)
set -euo pipefail
cd "$(dirname "$0")/../.."
shapes="${SHAPES:-16x9 9x16 32x9 1x1 pillar}"
for shape in $shapes; do
  ffmpeg -y -loglevel error \
    -i "demo/screens/${shape}_alert-lv3.mp4" -i "demo/screens/${shape}_alert-lv4.mp4" -i "demo/screens/${shape}_alert-tsunami.mp4" \
    -filter_complex "[0:v]trim=start_frame=0:end_frame=110,setpts=PTS-STARTPTS[a];[1:v]trim=start_frame=0:end_frame=170,setpts=PTS-STARTPTS[b];[2:v]trim=start_frame=0:end_frame=170,setpts=PTS-STARTPTS[c];[a][b][c]concat=n=3:v=1[out]" \
    -map "[out]" -c:v libx264 -crf 14 -pix_fmt yuv420p -r 30 "demo/screens/${shape}_cut08-seq.mp4"
  echo "CUT08_SEQ ${shape} $(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "demo/screens/${shape}_cut08-seq.mp4") frames"
done
