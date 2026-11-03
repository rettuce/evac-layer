#!/usr/bin/env bash
# Live screens only show approved bulletins (data/approvals.json, gitignored), so the EVAC LAYER content needs
# the 2026-10-21 flood bulletins approved once per app checkout, through the app's loopback-only admin API.
#   sim/scripts/approve-live.sh [http://127.0.0.1:3153]
set -euo pipefail
BASE=${1:-${VITE_SCREEN_ORIGIN:-http://127.0.0.1:3153}}
MUNICIPALITY=05210
SITE_ID=05210-demo-honjo-station
WINDOW='from=2026-10-21T18:10%2B09:00&to=2026-10-21T19:40%2B09:00'
post() { curl -sf -o /dev/null -w "$1 %{http_code}\n" -H 'content-type: application/json' -H "Origin: $BASE" -H 'Sec-Fetch-Site: same-origin' -X POST "$BASE$1" -d "$2"; }
post /api/admin/site "{\"site_id\":\"$SITE_ID\",\"auto_publish\":true}"
ids=$(curl -sf "$BASE/api/replay?municipality=$MUNICIPALITY&speed=1&$WINDOW" | python3 -c 'import sys, json; print(" ".join(r["bulletin_id"] for r in json.load(sys.stdin)["rows"] if r.get("screen")))')
for id in $ids; do post /api/admin/approve "{\"municipality\":\"$MUNICIPALITY\",\"bulletin_id\":\"$id\",\"approved\":true}"; done
