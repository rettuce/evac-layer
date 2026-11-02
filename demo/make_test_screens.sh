#!/usr/bin/env bash
set -euo pipefail
# Synthetic moving content for verifying the MOVIE texture path before real recordings exist.
cd "$(dirname "$0")/screens"
seconds="${1:-10}"
for spec in 9x16:1080x1920 16x9:1920x1080 32x9:3840x1080 1x1:1080x1080; do
  shape="${spec%%:*}"
  size="${spec#*:}"
  ffmpeg -y -loglevel error -f lavfi -i "testsrc2=size=${size}:rate=30:duration=${seconds}" \
    -c:v libx264 -pix_fmt yuv420p -crf 23 -an "${shape}.mp4"
  echo "${shape}.mp4 ${size} ${seconds}s"
done
