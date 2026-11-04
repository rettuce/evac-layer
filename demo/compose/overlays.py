"""Subtitles, telops and the logo of the cut list, as timed overlays.

python3 demo/compose/overlays.py [--edl demo/compose/edl.json] [--csv demo/out/overlays-v8.csv]

The final edit lays Figma-exported transparent PNGs over the clean picture in DaVinci; this table gives each
overlay's cut, kind, start and end (seconds on the whole timeline), its text and the PNG name the brand seat
exports it as (ov-<cut>-<kind>-<n>.png). compose.py --mode vcon burns the same overlays in for timing checks.
"""

import argparse
import csv
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
LINE_BREAK = "／"


def overlays(edl):
    rows = []
    t = 0.0
    for segment in edl["segments"]:
        start, end = t, t + segment["seconds"]
        t = end
        cut = segment["cut"]
        if segment.get("subtitle_ja"):
            rows.append({"cut": cut, "kind": "subtitle", "start_s": start + segment.get("subtitle_from_s", 0.0), "end_s": end,
                         "text_ja": segment["subtitle_ja"], "text_en": segment.get("subtitle_en", "")})
        if segment.get("telop_ja"):
            rows.append({"cut": cut, "kind": "telop", "start_s": start, "end_s": end,
                         "text_ja": segment["telop_ja"], "text_en": segment.get("telop_en", "")})
        if segment.get("logo"):
            rows.append({"cut": cut, "kind": "logo", "start_s": start, "end_s": end, "text_ja": "", "text_en": "",
                         "file": segment["logo"]})
    counts = {}
    for row in rows:
        key = (row["cut"], row["kind"])
        counts[key] = counts.get(key, 0) + 1
        row["png_name"] = f"ov-{row['cut']}-{row['kind']}-{counts[key]}.png"
    return rows


def lines(text):
    return text.replace(LINE_BREAK, "\n") if text else ""


def write_csv(rows, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["cut", "kind", "start_s", "end_s", "text_ja", "text_en", "png_name"])
        for row in rows:
            writer.writerow([row["cut"], row["kind"], f"{row['start_s']:.2f}", f"{row['end_s']:.2f}",
                             row["text_ja"], row["text_en"], row["png_name"]])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--edl", default=str(HERE / "edl.json"))
    parser.add_argument("--csv", default=str(HERE.parent / "out" / "overlays-v8.csv"))
    args = parser.parse_args()
    rows = overlays(json.loads(Path(args.edl).read_text(encoding="utf-8")))
    write_csv(rows, Path(args.csv))
    print(f"OVERLAYS {len(rows)} → {args.csv}")


if __name__ == "__main__":
    main()
