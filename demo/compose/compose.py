"""Assemble the 3-minute demo from 3D cuts, screen captures and Japanese captions.

python3 demo/compose/compose.py [--edl demo/compose/edl.json]

Each segment is normalized to the EDL size/fps, captioned with drawtext, and concatenated
without audio (sound is mixed in a later pass). A missing 3D cut whose screen recordings exist
becomes a four-shape preview of those recordings; any other missing source becomes a labeled
slate, so the full timeline can be previewed before every cut exists.
"""

import argparse
import json
import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCREENS_DIR = HERE.parent / "screens"
FONT_DIR = HERE / "fonts"
FONT_URL = "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/JP/NotoSansJP-Bold.otf"
FONT_LICENSE_URL = "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/LICENSE"
FONT_PATH = FONT_DIR / "NotoSansJP-Bold.otf"

CAPTION_SIZE_RATIO = 0.042
SLATE_SIZE_RATIO = 0.03
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
    over_picture = bool(segment.get("src"))
    if segment.get("caption"):
        size = round(height * CAPTION_SIZE_RATIO)
        caption = drawtext(write_text(work, f"cap_{segment['cut']}", segment["caption"]), size, f"h-text_h-{size * 2}")
        if segment.get("caption_from_s"):
            caption += f":enable='gte(t\\,{segment['caption_from_s']})'"
        filters.append(caption)
    if segment.get("title"):
        size = round(height * TITLE_SIZE_RATIO)
        y = "(h-text_h)/2-th" if segment.get("subtitle") else "(h-text_h)/2"
        filters.append(drawtext(write_text(work, f"title_{segment['cut']}", segment["title"]), size, y, box=over_picture))
    if segment.get("subtitle"):
        size = round(height * CAPTION_SIZE_RATIO)
        filters.append(drawtext(write_text(work, f"sub_{segment['cut']}", segment["subtitle"]), size, f"h/2+{size * 3}", box=over_picture))
    return filters


# Four-shape preview on a 1920x1080 canvas: (shape, x, y, width, height) as fractions of the canvas.
SCREEN_GRID = [
    ("9x16", 0.0083, 0.0259, 0.3, 0.9481),
    ("32x9", 0.3167, 0.0259, 0.675, 0.3375),
    ("16x9", 0.3167, 0.3787, 0.45, 0.45),
    ("1x1", 0.775, 0.3787, 0.2167, 0.3852),
]


def screen_grid_inputs(segment):
    if not segment.get("screens"):
        return None
    sources = [SCREENS_DIR / f"{shape}_{segment['screens']}.mp4" for shape, *_ in SCREEN_GRID]
    return sources if all(path.exists() for path in sources) else None


def screen_grid_filter(width, height, fps):
    chains = [f"color=c={SLATE_COLOR}:s={width}x{height}:r={fps}[base]"]
    previous = "base"
    for i, (_, x, y, w, h) in enumerate(SCREEN_GRID):
        box_w, box_h = round(w * width), round(h * height)
        chains.append(f"[{i}:v]scale={box_w}:{box_h}:force_original_aspect_ratio=decrease,fps={fps},"
                      f"tpad=stop_mode=clone:stop=-1[s{i}]")
        chains.append(f"[{previous}][s{i}]overlay=x={round(x * width)}+({box_w}-w)/2:y={round(y * height)}+({box_h}-h)/2"
                      f":shortest=0[g{i}]")
        previous = f"g{i}"
    return ";".join(chains), previous


KIND_LABELS = {"3d": "3D（Blender）", "capture": "画面収録", "title": "タイトル", "composite": "素材＋テロップ"}


def slate_text(segment, edl):
    lines = [f"CUT {segment['cut']}  ·  {KIND_LABELS.get(segment['kind'], segment['kind'])}  ·  {segment['seconds']} 秒  ·  未着"]
    if segment.get("slate"):
        lines.append(segment["slate"])
    if segment["kind"] == "capture" and edl.get("capture_spec"):
        lines.append(edl["capture_spec"])
    if segment.get("screens"):
        lines.append(f"画面素材: demo/screens/<shape>_{segment['screens']}.mp4")
    lines.append(f"→ {segment['src']}")
    return "\n".join(lines)


def render_segment(segment, index, work, edl):
    width, height = edl["size"]
    fps = edl["fps"]
    out = work / f"seg_{index:02d}.mp4"
    seconds = str(segment["seconds"])
    src = segment.get("src")
    source = (HERE / src).resolve() if src else None
    filters = segment_filters(segment, work, width, height)
    grid = None if source and source.exists() else screen_grid_inputs(segment)
    if grid:
        size = round(height * SLATE_SIZE_RATIO)
        label = write_text(work, f"grid_{segment['cut']}", f"CUT {segment['cut']} · 3D 未レンダ · 画面素材 4 形状（{segment['screens']}）")
        graph, last = screen_grid_filter(width, height, fps)
        corner = drawtext(label, size, f"h-text_h-{size}", box=False).replace("x=(w-text_w)/2", f"x=w-text_w-{size}")
        chain = ",".join([corner, *filters])
        command = ["ffmpeg", "-y", "-loglevel", "error"]
        for path in grid:
            command += ["-i", str(path)]
        command += ["-filter_complex", f"{graph};[{last}]{chain}[out]", "-map", "[out]", "-t", seconds]
        subprocess.run([*command, "-r", str(fps), *ENCODE, str(out)], check=True)
        print(f"CUT {segment['cut']:>3} {segment['seconds']:>3}s grid {segment['screens']} x{len(grid)}")
        return out
    if source and source.exists():
        inputs = ["-i", str(source)]
        fit = f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,fps={fps},tpad=stop_mode=clone:stop=-1"
        filters.insert(0, fit)
        status = f"ok  {source.name}"
    else:
        inputs = ["-f", "lavfi", "-i", f"color=c={SLATE_COLOR if src else 'black'}:s={width}x{height}:r={fps}"]
        if src:
            size = round(height * SLATE_SIZE_RATIO)
            filters.insert(0, drawtext(write_text(work, f"slate_{segment['cut']}", slate_text(segment, edl)), size, f"{size * 2}", box=False))
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
        parts = [render_segment(segment, i, work, edl) for i, segment in enumerate(edl["segments"])]
        out_path = Path(args.out).resolve() if args.out else (HERE / edl["output"]).resolve()
        concat(parts, work, out_path)
    finally:
        shutil.rmtree(work)
    total = sum(segment["seconds"] for segment in edl["segments"])
    print(f"COMPOSED {out_path} {total}s {width}x{height}@{edl['fps']}")


if __name__ == "__main__":
    main()
