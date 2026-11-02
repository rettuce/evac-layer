"""Assemble the 3-minute demo from 3D cuts, screen captures and Japanese captions.

python3 demo/compose/compose.py [--edl demo/compose/edl.json]

Each segment is normalized to the EDL size/fps, captioned with drawtext, and concatenated
without audio (sound is mixed in a later pass). A missing source becomes a labeled slate,
so the full timeline can be previewed before every cut exists.
"""

import argparse
import json
import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
FONT_DIR = HERE / "fonts"
FONT_URL = "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/JP/NotoSansJP-Bold.otf"
FONT_LICENSE_URL = "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/LICENSE"
FONT_PATH = FONT_DIR / "NotoSansJP-Bold.otf"

CAPTION_SIZE_RATIO = 0.042
TITLE_SIZE_RATIO = 0.07
SLATE_COLOR = "0x1b1b1f"
ENCODE = ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-an"]


def ensure_font():
    if not FONT_PATH.exists():
        FONT_DIR.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(FONT_URL, FONT_PATH)
        urllib.request.urlretrieve(FONT_LICENSE_URL, FONT_DIR / "LICENSE-OFL.txt")
    return FONT_PATH


def drawtext(text_file, size, y_expr, box=True):
    options = [
        f"fontfile='{FONT_PATH}'",
        f"textfile='{text_file}'",
        "fontcolor=white",
        f"fontsize={size}",
        f"line_spacing={size // 3}",
        "x=(w-text_w)/2",
        f"y={y_expr}",
        "text_align=C",
    ]
    if box:
        options += ["box=1", "boxcolor=black@0.55", f"boxborderw={size // 2}"]
    return "drawtext=" + ":".join(options)


def write_text(work, name, text):
    path = work / f"{name}.txt"
    path.write_text(text, encoding="utf-8")
    return path


def segment_filters(segment, work, width, height):
    filters = []
    if segment.get("caption"):
        size = round(height * CAPTION_SIZE_RATIO)
        filters.append(drawtext(write_text(work, f"cap_{segment['cut']}", segment["caption"]), size, f"h-text_h-{size * 2}"))
    if segment.get("title"):
        size = round(height * TITLE_SIZE_RATIO)
        filters.append(drawtext(write_text(work, f"title_{segment['cut']}", segment["title"]), size, "(h-text_h)/2-th", box=False))
    if segment.get("subtitle"):
        size = round(height * CAPTION_SIZE_RATIO)
        filters.append(drawtext(write_text(work, f"sub_{segment['cut']}", segment["subtitle"]), size, f"h/2+{size * 3}", box=False))
    return filters


def slate_text(segment):
    return f"CUT {segment['cut']}  {segment['kind']}  {segment['seconds']}s\n未着: {segment.get('src', '-')}"


def render_segment(segment, index, work, width, height, fps):
    out = work / f"seg_{index:02d}.mp4"
    seconds = str(segment["seconds"])
    src = segment.get("src")
    source = (HERE / src).resolve() if src else None
    filters = segment_filters(segment, work, width, height)
    if source and source.exists():
        inputs = ["-i", str(source)]
        fit = f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,fps={fps},tpad=stop_mode=clone:stop=-1"
        filters.insert(0, fit)
        status = f"ok  {source.name}"
    else:
        inputs = ["-f", "lavfi", "-i", f"color=c={SLATE_COLOR if src else 'black'}:s={width}x{height}:r={fps}"]
        if src:
            size = round(height * CAPTION_SIZE_RATIO)
            filters.insert(0, drawtext(write_text(work, f"slate_{segment['cut']}", slate_text(segment)), size, f"{size * 2}", box=False))
        status = "slate" if src else "card"
    command = ["ffmpeg", "-y", "-loglevel", "error", *inputs, "-t", seconds]
    if filters:
        command += ["-vf", ",".join(filters)]
    subprocess.run([*command, "-r", str(fps), *ENCODE, str(out)], check=True)
    print(f"CUT {segment['cut']:>3} {segment['seconds']:>3}s {status}")
    return out


def concat(parts, work, out_path):
    listing = work / "concat.txt"
    listing.write_text("".join(f"file '{part}'\n" for part in parts))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing),
                    "-c", "copy", str(out_path)], check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--edl", default=str(HERE / "edl.json"))
    parser.add_argument("--out")
    args = parser.parse_args()
    edl = json.loads(Path(args.edl).read_text(encoding="utf-8"))
    width, height = edl["size"]
    ensure_font()
    work = Path(tempfile.mkdtemp(prefix="evac-compose-"))
    try:
        parts = [render_segment(segment, i, work, width, height, edl["fps"]) for i, segment in enumerate(edl["segments"])]
        out_path = Path(args.out).resolve() if args.out else (HERE / edl["output"]).resolve()
        concat(parts, work, out_path)
    finally:
        shutil.rmtree(work)
    total = sum(segment["seconds"] for segment in edl["segments"])
    print(f"COMPOSED {out_path} {total}s {width}x{height}@{edl['fps']}")


if __name__ == "__main__":
    main()
