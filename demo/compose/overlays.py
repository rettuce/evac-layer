"""Subtitles, telops, captions and the logo of the cut list, as timed overlays.

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


def subtitle_spans(segment):
    """(from_s, to_s, ja, en) within the segment. A subtitle in several parts shares the segment in proportion
    to each part's spoken length, so every part stays up as long as reading it takes relative to the others."""
    start = segment.get("subtitle_from_s", 0.0)
    if segment.get("subtitle_parts"):
        parts = segment["subtitle_parts"]
    elif segment.get("subtitle_ja"):
        parts = [{"ja": segment["subtitle_ja"], "en": segment.get("subtitle_en", "")}]
    else:
        return []
    weights = [len("".join(part["ja"].split()).replace(LINE_BREAK, "")) for part in parts]
    span = segment["seconds"] - start
    spans = []
    t = start
    for part, weight in zip(parts, weights):
        end = t + span * weight / sum(weights)
        spans.append((t, end, part["ja"], part.get("en", "")))
        t = end
    return spans


def overlays(edl):
    rows = []
    t = 0.0
    for segment in edl["segments"]:
        start, end = t, t + segment["seconds"]
        t = end
        cut = segment["cut"]

        if segment.get("telop_ja"):
            rows.append({"cut": cut, "kind": "telop", "start_s": start, "end_s": end,
                         "text_ja": segment["telop_ja"], "text_en": segment.get("telop_en", "")})
        if segment.get("caption_ja"):
            rows.append({"cut": cut, "kind": "caption", "start_s": start + segment["caption_from_s"],
                         "end_s": start + segment["caption_to_s"], "text_ja": segment["caption_ja"],
                         "text_en": segment.get("caption_en", ""), "fade_ms": segment.get("caption_fade_ms", 0)})
        if segment.get("logo"):
            rows.append({"cut": cut, "kind": "logo", "start_s": start, "end_s": end, "text_ja": "", "text_en": "",
                         "file": segment["logo"]})
    for a, b, cut, _, ja, en in timeline_subtitles(edl):
        rows.append({"cut": cut, "kind": "subtitle", "start_s": a, "end_s": b, "text_ja": ja, "text_en": en})
    order = {segment["cut"]: i for i, segment in enumerate(edl["segments"])}
    kinds = {"subtitle": 0, "telop": 1, "caption": 2, "logo": 3}
    rows.sort(key=lambda row: (order[row["cut"]], kinds[row["kind"]], row["start_s"]))
    counts = {}
    for row in rows:
        key = (row["cut"], row["kind"])
        counts[key] = counts.get(key, 0) + 1
        row["png_name"] = f"ov-{row['cut']}-{row['kind']}-{counts[key]}.png"
    return rows


EPS = 1e-6
JA_PER_S = 5
EN_PER_S = 15


def reading_seconds(ja, en):
    """Time to read a subtitle: Japanese at 5 characters a second, English at 15, whichever takes longer."""
    ja_chars = len("".join(ja.split()).replace(LINE_BREAK, ""))
    en_chars = len(" ".join(en.replace(LINE_BREAK, " ").split()))
    return max(ja_chars / JA_PER_S, en_chars / EN_PER_S), ja_chars, en_chars


def timeline_subtitles(edl):
    """Every subtitle as (start_s, end_s, cut, part, ja, en) on the whole timeline. A subtitle shown for less than
    its reading time first starts earlier, into time the subtitle before it can spare, then runs on into time
    nobody uses after it; cuts keep their length and subtitles never overlap."""
    spans = []
    t = 0.0
    for segment in edl["segments"]:
        for part, (a, b, ja, en) in enumerate(subtitle_spans(segment), 1):
            spans.append([t + a, t + b, segment["cut"], part, ja, en])
        t += segment["seconds"]
    total = t
    need = [reading_seconds(span[4], span[5])[0] for span in spans]
    for i, span in enumerate(spans):
        short = need[i] - (span[1] - span[0])
        if short <= EPS:
            continue
        before = spans[i - 1] if i else None
        if before and before[1] >= span[0] - EPS:
            take = min(short, max(0.0, (before[1] - before[0]) - need[i - 1]))
            before[1] -= take
            span[0] -= take
            short -= take
        if short > EPS:
            ceiling = spans[i + 1][0] if i + 1 < len(spans) else total
            span[1] = min(ceiling, span[1] + short)
    return [tuple(span) for span in spans]


def lines(text):
    return text.replace(LINE_BREAK, "\n") if text else ""


def write_csv(rows, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["cut", "kind", "start_s", "end_s", "text_ja", "text_en", "png_name", "fade_ms"])
        for row in rows:
            writer.writerow([row["cut"], row["kind"], f"{row['start_s']:.2f}", f"{row['end_s']:.2f}",
                             row["text_ja"], row["text_en"], row["png_name"], row.get("fade_ms", "")])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--edl", default=str(HERE / "edl.json"))
    parser.add_argument("--csv", default=str(HERE.parent / "out" / "overlays-v8.csv"))
    parser.add_argument("--check", action="store_true", help="list each subtitle's time on screen against its reading time")
    args = parser.parse_args()
    rows = overlays(json.loads(Path(args.edl).read_text(encoding="utf-8")))
    if args.check:
        short = 0
        print("| overlay | on screen s | ja chars | en chars | needs s | |")
        print("|---|---|---|---|---|---|")
        for row in rows:
            if row["kind"] != "subtitle":
                continue
            need, ja, en = reading_seconds(row["text_ja"], row["text_en"])
            shown = row["end_s"] - row["start_s"]
            ok = shown >= need - EPS
            short += not ok
            print(f"| {row['png_name']} | {shown:.2f} | {ja} | {en} | {need:.2f} | {'ok' if ok else 'SHORT'} |")
        print(f"READING {short} short")
    write_csv(rows, Path(args.csv))
    print(f"OVERLAYS {len(rows)} → {args.csv}")


if __name__ == "__main__":
    main()
