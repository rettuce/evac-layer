"""Cut 7b: five municipalities' 16:9 screens in one frame, each from its own documents.

python3 demo/compose/cut07b.py

Inputs: demo/screens/16x9_muni-<code>.mp4 from `node demo/capture/record.mjs --shape 16x9 --cut muni-<code>`.
Output: demo/capture/out/cut07b.mp4 (1920x1080, 30 fps, 10 s).
"""

import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEMO = HERE.parent
REPO = DEMO.parent
FONT = HERE / "fonts" / "NotoSansJP-Bold.otf"
OUT = DEMO / "capture" / "out" / "cut07b.mp4"

WIDTH, HEIGHT, FPS, SECONDS = 1920, 1080, 30, 10
TILE_W, TILE_H = 544, 306
GAP = 40
LABEL_SIZE = 30
QUIET_SIZE = 26
BACKGROUND = "0x111111"
# Two rows (3 + 2) keep each headline legible; the bottom row ends above the burned-in caption.
ROWS = [(104, ["05210", "17204", "15205"]), (486, ["22424", "14100"])]
QUIET = {"22424", "14100"}


def municipality_name(code):
    return json.loads((REPO / "data" / "layouts" / code / "index.json").read_text(encoding="utf-8"))["name"]


def tiles():
    placed = []
    for top, codes in ROWS:
        row_width = len(codes) * TILE_W + (len(codes) - 1) * GAP
        left = (WIDTH - row_width) // 2
        for i, code in enumerate(codes):
            placed.append((code, left + i * (TILE_W + GAP), top))
    return placed


def text(value, size, x, y, box=False):
    escaped = value.replace(":", r"\:").replace("'", r"\'")
    options = [f"fontfile='{FONT}'", f"text='{escaped}'", "fontcolor=white", f"fontsize={size}", f"x={x}", f"y={y}"]
    if box:
        options += ["box=1", "boxcolor=black@0.7", f"boxborderw={size // 3}"]
    return "drawtext=" + ":".join(options)


def main():
    placed = tiles()
    inputs, chains = [], [f"color=c={BACKGROUND}:s={WIDTH}x{HEIGHT}:r={FPS}:d={SECONDS}[base]"]
    previous = "base"
    for i, (code, x, y) in enumerate(placed):
        inputs += ["-i", str(DEMO / "screens" / f"16x9_muni-{code}.mp4")]
        chains.append(f"[{i}:v]fps={FPS},scale={TILE_W}:{TILE_H},tpad=stop_mode=clone:stop=-1[t{i}]")
        chains.append(f"[{previous}][t{i}]overlay={x}:{y}:shortest=0[o{i}]")
        previous = f"o{i}"
    labels = []
    for code, x, y in placed:
        labels.append(text(municipality_name(code), LABEL_SIZE, x, y - LABEL_SIZE - 14))
        if code in QUIET:
            labels.append(text("警報なし  No warning", QUIET_SIZE, x + 20, y + TILE_H - QUIET_SIZE - 24, box=True))
    chains.append(f"[{previous}]{','.join(labels)}[out]")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", ";".join(chains), "-map", "[out]",
                    "-t", str(SECONDS), "-r", str(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "18",
                    "-pix_fmt", "yuv420p", "-an", str(OUT)], check=True)
    print(f"CUT07B {OUT} {SECONDS}s tiles={len(placed)}")


if __name__ == "__main__":
    main()
