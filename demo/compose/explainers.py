"""Cuts 3, 4 and 10: the README's coverage sheets held still, the system diagram lit stage by stage, and the end card.

python3 demo/compose/explainers.py

Outputs in demo/capture/out/: cut03_sheets.mp4 (12 s), cut04_system.mp4 (10 s) and cut10_endcard.png.
"""

import re
import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEMO = HERE.parent
REPO = DEMO.parent
OUT_DIR = DEMO / "capture" / "out"
FONT_DIR = HERE / "fonts"
FONT_REGULAR_URL = "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/JP/NotoSansJP-Regular.otf"
BRAVE = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"

WIDTH, HEIGHT, FPS = 1920, 1080, 30
SHEETS = ["coverage-hazards.png", "coverage-pictograms.png", "coverage-shapes.png"]
SHEET_SECONDS = 4
SHEET_BACKGROUND = "white"
STAGE_SECONDS = 2.5
LOGO = REPO / "docs" / "brand" / "evac-layer-logo-2line-black.svg"
REPO_URL = "github.com/rettuce/evac-layer"
LOGO_WIDTH_PX = 760
DIM_OPACITY = 0.6
# Zones as drawn by docs/diagrams/system.py: (first column, last column, row) per stage, in reading order.
STAGES = [
    ("平時", [(0, 2, 0), (4, 4, 0)]),
    ("有事", [(0, 4, 1)]),
    ("検査", [(3, 4, 2)]),
    ("承認と配信", [(0, 2, 2)]),
]


def encode(args, out):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args, "-r", str(FPS), "-c:v", "libx264", "-preset", "medium",
                    "-crf", "18", "-pix_fmt", "yuv420p", "-an", str(out)], check=True)


def concat(parts, out):
    listing = out.with_suffix(".txt")
    listing.write_text("".join(f"file '{p}'\n" for p in parts))
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy",
                    str(out)], check=True)
    listing.unlink()


def sheets(work):
    parts = []
    for i, name in enumerate(SHEETS):
        part = work / f"sheet_{i}.mp4"
        fit = (f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease,"
               f"pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2:color={SHEET_BACKGROUND}")
        encode(["-loop", "1", "-framerate", str(FPS), "-i", str(REPO / "docs" / name), "-t", str(SHEET_SECONDS), "-vf", fit], part)
        parts.append(part)
    concat(parts, OUT_DIR / "cut03_sheets.mp4")


def diagram_geometry():
    source = (REPO / "docs" / "diagrams" / "system.py").read_text(encoding="utf-8")
    geometry = {}
    for line in source.splitlines():
        if re.match(r"^(W, H|CW, CH|COLS|ROWS) = ", line):
            exec(line, {}, geometry)
    return geometry


def zone_rect(g, c0, c1, r):
    x, y = g["COLS"][c0] - 24, g["ROWS"][r] - 52
    return x, y, g["COLS"][c1] + g["CW"] + 24 - x, g["CH"] + 52 + 28


def stage_page(svg, g, zones, font_regular, font_bold):
    holes = "".join(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="black"/>'
                    for x, y, w, h in (zone_rect(g, *zone) for zone in zones))
    scale = min(WIDTH / g["W"], HEIGHT / g["H"])
    return f"""<!doctype html><meta charset="utf-8"><style>
@font-face{{font-family:'Noto Sans JP';src:url("{font_regular.as_uri()}");font-weight:400}}
@font-face{{font-family:'Noto Sans JP';src:url("{font_bold.as_uri()}");font-weight:700}}
html,body{{margin:0;width:{WIDTH}px;height:{HEIGHT}px;background:#fff;overflow:hidden}}
.stage{{position:absolute;left:{(WIDTH - g["W"] * scale) / 2}px;top:{(HEIGHT - g["H"] * scale) / 2}px;
  width:{g["W"]}px;height:{g["H"]}px;transform:scale({scale});transform-origin:0 0}}
.stage svg{{position:absolute;left:0;top:0}}
</style><div class="stage">{svg}
<svg width="{g["W"]}" height="{g["H"]}" viewBox="0 0 {g["W"]} {g["H"]}"><defs><mask id="lit">
<rect width="{g["W"]}" height="{g["H"]}" fill="white"/>{holes}</mask></defs>
<rect width="{g["W"]}" height="{g["H"]}" fill="white" opacity="{DIM_OPACITY}" mask="url(#lit)"/></svg></div>"""


def system(work):
    font_regular = FONT_DIR / "NotoSansJP-Regular.otf"
    if not font_regular.exists():
        urllib.request.urlretrieve(FONT_REGULAR_URL, font_regular)
    svg = (REPO / "docs" / "diagrams" / "system.svg").read_text(encoding="utf-8")
    g = diagram_geometry()
    parts = []
    for i, (_, zones) in enumerate(STAGES):
        page = work / f"stage_{i}.html"
        page.write_text(stage_page(svg, g, zones, font_regular, FONT_DIR / "NotoSansJP-Bold.otf"), encoding="utf-8")
        png = work / f"stage_{i}.png"
        subprocess.run([BRAVE, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files",
                        f"--window-size={WIDTH},{HEIGHT}", "--force-device-scale-factor=1", f"--screenshot={png}",
                        page.as_uri()], check=True, capture_output=True)
        part = work / f"stage_{i}.mp4"
        encode(["-loop", "1", "-framerate", str(FPS), "-i", str(png), "-t", str(STAGE_SECONDS)], part)
        parts.append(part)
    concat(parts, OUT_DIR / "cut04_system.mp4")


def endcard(work):
    font = FONT_DIR / "NotoSansJP-Regular.otf"
    page = work / "endcard.html"
    page.write_text(f"""<!doctype html><meta charset="utf-8"><style>
@font-face{{font-family:Noto;src:url("{font.as_uri()}")}}
html,body{{margin:0;width:{WIDTH}px;height:{HEIGHT}px;background:#000;overflow:hidden}}
body{{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:56px}}
img{{width:{LOGO_WIDTH_PX}px}}p{{margin:0;color:#b8b8b8;font:30px Noto,sans-serif;letter-spacing:.02em}}
</style><img src="{LOGO.as_uri()}"><p>{REPO_URL}</p>""", encoding="utf-8")
    subprocess.run([BRAVE, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files",
                    f"--window-size={WIDTH},{HEIGHT}", "--force-device-scale-factor=1",
                    f"--screenshot={OUT_DIR / 'cut10_endcard.png'}", page.as_uri()], check=True, capture_output=True)


def main():
    work = Path(tempfile.mkdtemp(prefix="evac-explainers-"))
    try:
        sheets(work)
        system(work)
        endcard(work)
    finally:
        shutil.rmtree(work)
    for name in ("cut03_sheets.mp4", "cut04_system.mp4", "cut10_endcard.png"):
        print(f"EXPLAINER {OUT_DIR / name}")


if __name__ == "__main__":
    main()
