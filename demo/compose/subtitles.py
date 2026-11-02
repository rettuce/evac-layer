"""Write the narration script and the English subtitle track from the EDL.

python3 demo/compose/subtitles.py [--with-narration]

- demo/compose/narration.md: per cut, start, the time the line may take, the Japanese line, its length and
  whether it fits at 300 characters a minute, and the caption it sits under
- demo/out/evac-layer-demo-v2.en.srt: English for every caption and title card (and, with --with-narration,
  the narration once it is recorded), as a separate track; nothing is burned into the picture
"""

import argparse
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
CHARS_PER_SECOND = 300 / 60
NARRATION_LEAD_S = 0.3
CJK = re.compile(r"[　-ヿ㐀-鿿＀-￯]")


def timeline(edl):
    t, rows = 0.0, []
    for segment in edl["segments"]:
        rows.append((t, segment))
        t += segment["seconds"]
    return rows, t


def narration_windows(rows, total):
    spoken = [(start, seg) for start, seg in rows if seg.get("narration_ja")]
    windows = []
    for i, (start, seg) in enumerate(spoken):
        end = spoken[i + 1][0] if i + 1 < len(spoken) else total
        windows.append((start, end - start, seg))
    return windows


def spoken_length(text):
    return len(re.sub(r"\s", "", text))


def english_lines(text):
    return "\n".join(line for line in text.split("\n") if not CJK.search(line))


def caption_of(seg):
    return seg.get("caption") or seg.get("title") or ""


def write_narration(windows, out):
    lines = [
        "# ナレーション台本（下書き）",
        "",
        "`demo/compose/edl.json` の `narration_ja` / `narration_en` から `subtitles.py` が生成する。話速 300 字/分（5 字/秒）で、"
        "そのカットの開始から次にナレーションのあるカットの開始までに収まるかを「字数／上限」で示す。"
        "録音は `demo/compose/audio/narration.wav`（全長 179 s・-18 LUFS 目安）として置けば `mix_audio.py` が載せる。",
        "",
        "| カット | 開始 | 使える秒数 | 読み上げ文 | 字数／上限 | テロップ |",
        "|---|---|---|---|---|---|",
    ]
    for start, window, seg in windows:
        text = seg["narration_ja"]
        limit = int(window * CHARS_PER_SECOND)
        mark = "" if spoken_length(text) <= limit else "（超過）"
        caption = caption_of(seg).replace("\n", " / ")
        lines.append(f"| {seg['cut']} | {start:.0f} s | {window:.0f} s | {text} | {spoken_length(text)}／{limit}{mark} | {caption} |")
    lines += ["", "## 英訳（字幕用）", ""]
    lines += [f"- {seg['cut']}: {seg['narration_en']}" for _, _, seg in windows]
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")


def stamp(seconds):
    ms = round(seconds * 1000)
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def write_srt(rows, windows, with_narration, out):
    cues = []
    for start, seg in rows:
        text = seg.get("caption_en") or english_lines(caption_of(seg))
        if seg.get("subtitle"):
            text = f"{text}\n{seg['subtitle']}" if text else seg["subtitle"]
        if text:
            cues.append((start, start + seg["seconds"], text))
    if with_narration:
        for start, window, seg in windows:
            speak = spoken_length(seg["narration_ja"]) / CHARS_PER_SECOND
            cues.append((start + NARRATION_LEAD_S, start + min(window, NARRATION_LEAD_S + speak), seg["narration_en"]))
    cues.sort()
    body = [f"{i}\n{stamp(a)} --> {stamp(b)}\n{text}\n" for i, (a, b, text) in enumerate(cues, 1)]
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(body), encoding="utf-8")
    return len(cues)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--edl", default=str(HERE / "edl.json"))
    parser.add_argument("--with-narration", action="store_true")
    parser.add_argument("--srt", default=str(HERE.parent / "out" / "evac-layer-demo-v2.en.srt"))
    args = parser.parse_args()
    edl = json.loads(Path(args.edl).read_text(encoding="utf-8"))
    rows, total = timeline(edl)
    windows = narration_windows(rows, total)
    write_narration(windows, HERE / "narration.md")
    count = write_srt(rows, windows, args.with_narration, Path(args.srt))
    over = [seg["cut"] for _, w, seg in windows if spoken_length(seg["narration_ja"]) > int(w * CHARS_PER_SECOND)]
    print(f"NARRATION {len(windows)} lines over_limit={over or 'none'} SRT {count} cues → {args.srt}")


if __name__ == "__main__":
    main()
