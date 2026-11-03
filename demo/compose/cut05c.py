"""Cut 5c: the same bulletin at four display sites, an OpenStreetMap map on the left and that site's 16:9 screen on the right.

python3 demo/compose/cut05c.py [--zoom 16]

Inputs: demo/sites/<slug>/site.json and 16x9.json, the GSI emergency evacuation sites in
data/municipalities/05210.shelters.json, and demo/screens/16x9_site-<slug>.mp4 from
`node demo/capture/record.mjs --shape 16x9 --cut site-<slug>`.
Output: demo/capture/out/cut05c.mp4 (1920x1080, 30 fps, 2.5 s per site).
"""

import argparse
import html
import json
import math
import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEMO = HERE.parent
REPO = DEMO.parent
SITES = ["honjo-station", "tsurumai-kaikan", "yuri-hs-ground", "ishiwaki-park"]
REFERENCE = "honjo-station"
SHELTERS = REPO / "data" / "municipalities" / "05210.shelters.json"
TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
# OSM tile usage policy: identify the application, and fetch each tile once (cached, never bulk).
USER_AGENT = "evac-layer-demo/1.0 (+https://github.com/rettuce/evac-layer)"
TILE_CACHE = DEMO / "cache" / "osm"
FONT = HERE / "fonts" / "NotoSansJP-Bold.otf"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT = DEMO / "capture" / "out" / "cut05c.mp4"

WIDTH, HEIGHT, FPS = 1920, 1080, 30
SECONDS_PER_SITE = 2.5
MAP_WIDTH = round(WIDTH * 0.4)
TILE = 256
# The burned-in caption covers the bottom of the frame, so markers and the screen stay above it.
MAP_TOP, MAP_BOTTOM, MAP_SIDE = 150, 840, 90
SCREEN_MARGIN = 32
SCREEN_TOP = 200
LV4 = "rgb(170,0,170)"
SHELTER_GREEN = "rgb(0,150,80)"
DIRECTIONS = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"]
# Beside, above or below the display marker: the first box inside the map area, farthest from the arrow's shelter.
PLACE_LABEL_JS = f"""
const el = document.querySelector('.label');
const [ax, ay, sx, sy] = el.dataset.at.split(',').map(Number);
const w = el.offsetWidth, h = el.offsetHeight, gap = 26;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const boxes = [[ax + gap, ay - h / 2], [ax - gap - w, ay - h / 2], [ax - w / 2, ay - gap - h], [ax - w / 2, ay + gap]]
  .map(([x, y]) => [clamp(x, 16, {MAP_WIDTH} - 16 - w), clamp(y, 110, {MAP_BOTTOM} + 20 - h)]);
const away = ([x, y]) => Math.hypot(x + w / 2 - sx, y + h / 2 - sy);
const hits = ([x, y], px, py) => px > x - 18 && px < x + w + 18 && py > y - 18 && py < y + h + 18;
const clear = (box) => [[ax, ay], [sx, sy], [(ax + sx) / 2, (ay + sy) / 2]].every(([px, py]) => !hits(box, px, py));
const [x, y] = boxes.filter(clear).sort((p, q) => away(q) - away(p))[0] ?? boxes[0];
el.style.left = x + 'px'; el.style.top = y + 'px';
"""


def world_px(lat, lng, zoom):
    scale = TILE * 2 ** zoom
    x = (lng + 180) / 360 * scale
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * scale
    return x, y


def distance_m(a, b):
    r = 6371008.8
    la1, la2 = math.radians(a[0]), math.radians(b[0])
    dla, dlo = la2 - la1, math.radians(b[1] - a[1])
    h = math.sin(dla / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlo / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def bearing_label(a, b):
    la1, la2 = math.radians(a[0]), math.radians(b[0])
    dlo = math.radians(b[1] - a[1])
    deg = math.degrees(math.atan2(math.sin(dlo) * math.cos(la2),
                                  math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dlo)))
    return DIRECTIONS[round((deg % 360) / 45) % 8]


def load_sites():
    shelters = json.loads(SHELTERS.read_text(encoding="utf-8"))["shelters"]
    sites = []
    for slug in SITES:
        site = json.loads((DEMO / "sites" / slug / "site.json").read_text(encoding="utf-8"))
        layout = json.loads((DEMO / "sites" / slug / "16x9.json").read_text(encoding="utf-8"))
        cells = {cell["role"]: cell for cell in layout["cells"]}
        shelter_name = cells["shelter"]["text"]["ja"]
        shelter = next(s for s in shelters if s["name"] == shelter_name and s["kind"] == "emergency_evacuation_site")
        facility = next(s["name"] for s in shelters if (s["lat"], s["lng"]) == (site["lat"], site["lng"]))
        sites.append({
            "slug": slug, "facility": facility, "pos": (site["lat"], site["lng"]),
            "shelter": shelter_name, "shelter_pos": (shelter["lat"], shelter["lng"]),
            "distance_m": cells["shelter"]["distance_m"], "direction": cells["direction"]["text"]["ja"],
        })
    return sites


def fetch_tile(z, x, y):
    path = TILE_CACHE / str(z) / str(x) / f"{y}.png"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        url = TILE_URL.format(z=z, x=x, y=y)
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=20) as response:
            path.write_bytes(response.read())
    return path


def viewport(sites, zoom):
    points = [world_px(*p, zoom) for s in sites for p in (s["pos"], s["shelter_pos"])]
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    scale = min((MAP_WIDTH - 2 * MAP_SIDE) / (max(xs) - min(xs)), (MAP_BOTTOM - MAP_TOP) / (max(ys) - min(ys)))
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    origin = (cx - MAP_WIDTH / 2 / scale, cy - ((MAP_TOP + MAP_BOTTOM) / 2) / scale)
    return origin, scale


def to_screen(pos, origin, scale, zoom):
    x, y = world_px(*pos, zoom)
    return (x - origin[0]) * scale, (y - origin[1]) * scale


def tiles_html(zoom, origin, scale):
    x0, y0 = int(origin[0] // TILE), int(origin[1] // TILE)
    x1, y1 = int((origin[0] + MAP_WIDTH / scale) // TILE), int((origin[1] + HEIGHT / scale) // TILE)
    size = TILE * scale
    parts = []
    for tx in range(x0, x1 + 1):
        for ty in range(y0, y1 + 1):
            path = fetch_tile(zoom, tx, ty)
            left, top = (tx * TILE - origin[0]) * scale, (ty * TILE - origin[1]) * scale
            parts.append(f'<img src="{path.as_uri()}" style="left:{left:.2f}px;top:{top:.2f}px;width:{size + 0.5:.2f}px;height:{size + 0.5:.2f}px">')
    return "".join(parts)


def arrow(a, b, color, width, opacity, gap):
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy)
    ux, uy = dx / length, dy / length
    start = (a[0] + ux * gap, a[1] + uy * gap)
    end = (b[0] - ux * gap, b[1] - uy * gap)
    head = width * 3.2
    left = (end[0] - ux * head - uy * head * 0.6, end[1] - uy * head + ux * head * 0.6)
    right = (end[0] - ux * head + uy * head * 0.6, end[1] - uy * head - ux * head * 0.6)
    return (f'<line x1="{start[0]:.1f}" y1="{start[1]:.1f}" x2="{end[0] - ux * head * 0.8:.1f}" y2="{end[1] - uy * head * 0.8:.1f}" '
            f'stroke="{color}" stroke-width="{width}" stroke-linecap="round" opacity="{opacity}"/>'
            f'<polygon points="{end[0]:.1f},{end[1]:.1f} {left[0]:.1f},{left[1]:.1f} {right[0]:.1f},{right[1]:.1f}" fill="{color}" opacity="{opacity}"/>')


def relative_label(site, reference):
    if site["slug"] == reference["slug"]:
        return "羽後本荘駅前"
    meters = distance_m(reference["pos"], site["pos"])
    return f"駅前から {round(meters):,} m {bearing_label(reference['pos'], site['pos'])}"


def frame_html(sites, current, zoom, origin, scale):
    reference = next(s for s in sites if s["slug"] == REFERENCE)
    svg = []
    for site in sites:
        a = to_screen(site["pos"], origin, scale, zoom)
        b = to_screen(site["shelter_pos"], origin, scale, zoom)
        active = site["slug"] == current["slug"]
        svg.append(arrow(a, b, LV4 if active else "rgb(40,40,40)", 6 if active else 3, 1 if active else 0.55, 16 if active else 11))
    for site in sites:
        b = to_screen(site["shelter_pos"], origin, scale, zoom)
        r = 13 if site["slug"] == current["slug"] else 9
        svg.append(f'<circle cx="{b[0]:.1f}" cy="{b[1]:.1f}" r="{r}" fill="{SHELTER_GREEN}" stroke="white" stroke-width="3"/>')
    for site in sites:
        a = to_screen(site["pos"], origin, scale, zoom)
        active = site["slug"] == current["slug"]
        half = 14 if active else 8
        svg.append(f'<rect x="{a[0] - half:.1f}" y="{a[1] - half:.1f}" width="{half * 2}" height="{half * 2}" '
                   f'fill="{LV4 if active else "white"}" stroke="{"white" if active else "rgb(40,40,40)"}" stroke-width="3"/>')
    a = to_screen(current["pos"], origin, scale, zoom)
    b = to_screen(current["shelter_pos"], origin, scale, zoom)
    label = (f'<div class="label" data-at="{a[0]:.1f},{a[1]:.1f},{b[0]:.1f},{b[1]:.1f}">'
             f'<b>{html.escape(current["facility"])}</b><span>{html.escape(relative_label(current, reference))}</span>'
             f'<span class="to">→ {html.escape(current["shelter"])}　{current["distance_m"]:,} m {html.escape(current["direction"].removesuffix("へ"))}</span></div>')
    return f"""<!doctype html><html lang="ja"><meta charset="utf-8"><style>
@font-face{{font-family:Noto;src:url("{FONT.as_uri()}")}}
html,body{{margin:0;width:{WIDTH}px;height:{HEIGHT}px;background:#000;overflow:hidden;font-family:Noto,sans-serif}}
.map{{position:absolute;left:0;top:0;width:{MAP_WIDTH}px;height:{HEIGHT}px;overflow:hidden}}
.map img{{position:absolute;filter:saturate(0.55) brightness(1.03)}}
svg{{position:absolute;left:0;top:0}}
.label{{position:absolute;background:rgba(255,255,255,0.94);border-left:6px solid {LV4};padding:8px 14px;color:#111;
  display:flex;flex-direction:column;gap:2px;font-size:22px;line-height:1.3;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.25)}}
.label b{{font-size:26px}}.label .to{{color:{LV4}}}
.head{{position:absolute;left:24px;top:22px;background:rgba(255,255,255,0.94);padding:6px 12px;color:#111;font-size:22px}}
.credit{{position:absolute;left:24px;top:72px;background:rgba(255,255,255,0.9);padding:3px 10px;color:#333;font-size:15px}}
.legend{{font-size:18px;color:#333;margin-left:10px}}
</style><div class="map">{tiles_html(zoom, origin, scale)}
<svg width="{MAP_WIDTH}" height="{HEIGHT}">{''.join(svg)}</svg>{label}
<div class="head">由利本荘市<span class="legend">■ ディスプレイ　● 指定緊急避難場所</span></div>
<div class="credit">地図: © OpenStreetMap contributors にディスプレイと避難場所の位置を追記</div></div>
<script>{PLACE_LABEL_JS}</script></html>"""


def screenshot(page, png):
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files",
                    f"--window-size={WIDTH},{HEIGHT}", "--force-device-scale-factor=1", f"--screenshot={png}", page.as_uri()],
                   check=True, capture_output=True)


def segment(map_png, screen_mp4, out):
    screen_w = WIDTH - MAP_WIDTH - 2 * SCREEN_MARGIN
    screen_h = round(screen_w * 9 / 16)
    x, y = MAP_WIDTH + SCREEN_MARGIN, SCREEN_TOP
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-framerate", str(FPS), "-i", str(map_png),
                    "-i", str(screen_mp4), "-filter_complex",
                    f"[1:v]fps={FPS},scale={screen_w}:{screen_h},tpad=stop_mode=clone:stop=-1[s];[0:v][s]overlay={x}:{y}",
                    "-t", str(SECONDS_PER_SITE), "-r", str(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "18",
                    "-pix_fmt", "yuv420p", "-an", str(out)], check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--zoom", type=int, default=16)
    parser.add_argument("--keep-frames", help="directory to keep the four map frames in")
    args = parser.parse_args()
    sites = load_sites()
    origin, scale = viewport(sites, args.zoom)
    work = Path(tempfile.mkdtemp(prefix="evac-5c-"))
    try:
        parts = []
        for i, site in enumerate(sites):
            page = work / f"map_{i}.html"
            page.write_text(frame_html(sites, site, args.zoom, origin, scale), encoding="utf-8")
            png = work / f"map_{i}.png"
            screenshot(page, png)
            parts.append(work / f"seg_{i}.mp4")
            segment(png, DEMO / "screens" / f"16x9_site-{site['slug']}.mp4", parts[-1])
            computed = distance_m(site["pos"], site["shelter_pos"])
            print(f"SITE {site['slug']:<16} to {site['shelter']} {computed:.0f} m (layout {site['distance_m']} m) "
                  f"{bearing_label(site['pos'], site['shelter_pos'])} (layout {site['direction']})")
            if args.keep_frames:
                Path(args.keep_frames).mkdir(parents=True, exist_ok=True)
                shutil.copy(png, Path(args.keep_frames) / f"cut05c_map_{i}.png")
        listing = work / "concat.txt"
        listing.write_text("".join(f"file '{p}'\n" for p in parts))
        OUT.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy",
                        str(OUT)], check=True)
    finally:
        shutil.rmtree(work)
    print(f"CUT05C {OUT} {len(sites) * SECONDS_PER_SITE}s z={args.zoom} scale={scale:.3f}")


if __name__ == "__main__":
    main()
