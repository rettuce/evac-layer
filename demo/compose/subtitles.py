"""Write the narration script and the English subtitle track from the EDL.

python3 demo/compose/subtitles.py [--with-narration]

- demo/compose/narration.md: the recording sheet, one take per narrated cut: file name, the Japanese line,
  the time it may take, and its length against what fits at 300 characters a minute
- demo/out/evac-layer-demo-v2.en.srt: English for every caption and title card (and, with --with-narration,
  the narration once it is recorded), as a separate track; nothing is burned into the picture
"""

import argparse
import json
import re
from pathlib import Path

from overlays import lines, timeline_subtitles

from mix_audio import narration_filename

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
        begin = start + seg.get("narration_from_s", 0.0)
        windows.append((begin, end - begin, seg))
    return windows


def spoken_length(text):
    return len(re.sub(r"\s", "", text))


def english_lines(text):
    return "\n".join(line for line in text.split("\n") if not CJK.search(line))


RECORDING_GUIDE = [
    "1. 静かな部屋で、外付けマイクで録る（エアコン・PC のファンを止める）",
    "2. 1 カット 1 ファイル。ファイル名は下の表のとおり `demo/compose/audio/narration/` に置く",
    "3. WAV・48 kHz・モノラルが既定（違う形式でも `mix_audio.py` が変換する）",
    "4. 文末で 0.5 秒置いてから止める。「使える秒数」を超えないこと",
    "5. 言い直したら最後のテイクだけ残す（ファイルを上書きする）",
]


def telop_en(seg):
    return lines(seg["telop_en"]) if seg.get("telop_en") and seg["telop_en"] != seg.get("telop_ja") else ""


def write_narration(windows, out):
    lines = [
        "# ナレーション録音台本",
        "",
        *RECORDING_GUIDE,
        "",
        "`demo/compose/edl.json` の `narration_ja` から `subtitles.py` が生成する。話速 300 字/分（5 字/秒）で、"
        "そのカットの開始から次にナレーションのあるカットの開始までを「使える秒数」とし、上限の字数を示す。"
        "置いたファイルは `mix_audio.py` がそのカットの開始秒に載せる。",
        "",
        "| ファイル名 | 読み上げ文 | 使える秒数 | 字数／上限 | 読み方 |",
        "|---|---|---|---|---|",
    ]
    for start, window, seg in windows:
        text = seg["narration_ja"]
        limit = int(window * CHARS_PER_SECOND)
        mark = "" if spoken_length(text) <= limit else "（超過）"
        lines.append(f"| `narration/{narration_filename(seg['cut'])}` | {text} | {window:.0f} s（{start:.0f} s から） "
                     f"| {spoken_length(text)}／{limit}{mark} | {seg.get('reading_ja', '')} |")
    alternates = [(seg, seg["narration_ja_alt"]) for _, _, seg in windows if seg.get("narration_ja_alt")]
    if alternates:
        lines += ["", "## 別案（録音時に両方読んで選ぶ）", ""]
        lines += [f"- {seg['cut']}: {alt}（{spoken_length(alt)} 字）" for seg, alt in alternates]
    lines += ["", "## 英訳（字幕用）", ""]
    lines += [f"- {seg['cut']}: {seg['narration_en']}" for _, _, seg in windows]
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")


def stamp(seconds):
    ms = round(seconds * 1000)
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def write_srt(edl, rows, windows, with_narration, out):
    cues = []
    for start, seg in rows:
        if telop_en(seg):
            cues.append((start, start + seg["seconds"], telop_en(seg)))
    cues += [(a, b, lines(en)) for a, b, _, _, _, en in timeline_subtitles(edl) if en]
    if with_narration:
        for start, window, seg in windows:
            speak = spoken_length(seg["narration_ja"]) / CHARS_PER_SECOND
            lead = seg.get("narration_from_s", 0.0) + NARRATION_LEAD_S
            cues.append((start + lead, start + min(window, lead + speak), seg["narration_en"]))
    cues.sort()
    body = [f"{i}\n{stamp(a)} --> {stamp(b)}\n{text}\n" for i, (a, b, text) in enumerate(cues, 1)]
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(body), encoding="utf-8")
    return len(cues)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--edl", default=str(HERE / "edl.json"))
    parser.add_argument("--with-narration", action="store_true")
    parser.add_argument("--srt", default=str(HERE.parent / "out" / "evac-layer-demo-v8.en.srt"))
    args = parser.parse_args()
    edl = json.loads(Path(args.edl).read_text(encoding="utf-8"))
    rows, total = timeline(edl)
    windows = narration_windows(rows, total)
    write_narration(windows, HERE / "narration.md")
    count = write_srt(edl, rows, windows, args.with_narration, Path(args.srt))
    over = [seg["cut"] for _, w, seg in windows if spoken_length(seg["narration_ja"]) > int(w * CHARS_PER_SECOND)]
    print(f"NARRATION {len(windows)} lines over_limit={over or 'none'} SRT {count} cues → {args.srt}")


if __name__ == "__main__":
    main()
