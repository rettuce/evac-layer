"""The DaVinci edit kit: picture, overlay PNGs, subtitles and sound as separate files on one timeline.

python3 demo/compose/davinci.py --version v9 --out <review/davinci>
    [--clean demo/out/evac-layer-demo-<version>-clean.mp4] [--vcon demo/out/evac-layer-demo-<version>-vcon.mp4]
    [--stems demo/out/stems-<version>] [--mix demo/out/evac-layer-demo-v1-mix.wav]

Layout and rules: log/specs/davinci-assets.md (田中, 2026-11-05). The previous kit moves to _prev/<its version>/.
compose.py --export-cuts writes video/cuts/ and cuts.csv; this script places everything and writes README.md.
"""

import argparse
import csv
import json
import re
import shutil
import subprocess
from datetime import datetime
from pathlib import Path

from mix_audio import BEEPS, BGM_DEFAULT, BGM_LUFS, cut_starts, integrated_lufs
from overlays import LINE_BREAK, overlays, timeline_subtitles

HERE = Path(__file__).resolve().parent
DEMO = HERE.parent
OVERLAY_PNGS = HERE / "overlays"
SWITCH_WAV = HERE / "audio" / "switch.wav"
TEXT_TABLE = Path("/Users/you/Dropbox/dev/claude-hackathon-2026/docs/plan/demo-v8-text.md")
PRORES = ["-c:v", "prores_ks", "-profile:v", "2", "-pix_fmt", "yuv422p10le", "-an"]


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, check=True).stdout
    return float(out)


def cut_file(index, cut):
    return f"{index:02d}-{'end' if cut == 'end' else 'cut' + cut}.mov"


def export_cuts(clean, edl, cuts_dir):
    """One ProRes 422 clip per cut of the clean picture, split on the cut list's boundaries."""
    cuts_dir.mkdir(parents=True, exist_ok=True)
    fps = edl["fps"]
    rows = []
    t = 0.0
    for i, segment in enumerate(edl["segments"]):
        name = cut_file(i, segment["cut"])
        frames = round(segment["seconds"] * fps)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(clean), "-vf",
                        f"select='between(n\\,{round(t * fps)}\\,{round(t * fps) + frames - 1})',setpts=N/FRAME_RATE/TB",
                        "-frames:v", str(frames), "-r", str(fps), *PRORES, str(cuts_dir / name)], check=True)
        about = (segment.get("slate") or segment.get("telop_ja") or segment["kind"]).split("\n")[0].replace(LINE_BREAK, " ")
        rows.append([segment["cut"], f"cuts/{name}", f"{t:.2f}", f"{t + segment['seconds']:.2f}", f"{segment['seconds']:.2f}", about])
        t += segment["seconds"]
    with (cuts_dir.parent / "cuts.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["cut", "file", "start_s", "end_s", "duration_s", "about"])
        writer.writerows(rows)
    print(f"CUTS {len(rows)} ProRes clips → {cuts_dir}")


def stamp(seconds):
    ms = round(seconds * 1000)
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def write_srt(spans, path):
    body = [f"{i}\n{stamp(a)} --> {stamp(b)}\n{text}\n" for i, (a, b, text) in enumerate(spans, 1)]
    path.write_text("\n".join(body), encoding="utf-8")


def rotate(out, version):
    readme = out / "README.md"
    if not readme.exists():
        return
    found = re.search(r"^version: (\S+)", readme.read_text(encoding="utf-8"), re.M)
    old = found.group(1) if found else "unknown"
    if old == version:
        return
    prev = out / "_prev"
    if prev.exists():
        shutil.rmtree(prev)
    keep = prev / old
    keep.mkdir(parents=True)
    for item in list(out.iterdir()):
        if item.name != "_prev":
            shutil.move(str(item), str(keep / item.name))


def assemble(args, edl):
    out = Path(args.out)
    rotate(out, args.version)
    for sub in ("vcon", "video", "overlays", "subtitles", "audio/bgm", "audio/se", "audio/stems", "audio/mix", "docs"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    v = args.version
    shutil.copyfile(args.vcon, out / "vcon" / f"evac-layer-{v}-vcon.mp4")
    shutil.copyfile(args.clean, out / "video" / f"evac-layer-{v}-clean.mp4")
    export_cuts(Path(args.clean), edl, out / "video" / "cuts")
    rows = overlays(edl)
    pngs = sorted(OVERLAY_PNGS.glob("ov-*.png"))
    for png in pngs:
        shutil.copyfile(png, out / "overlays" / png.name)
    with (out / "overlays.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["cut", "kind", "start_s", "end_s", "text_ja", "text_en", "png"])
        for row in rows:
            writer.writerow([row["cut"], row["kind"], f"{row['start_s']:.2f}", f"{row['end_s']:.2f}", row["text_ja"], row["text_en"], row["png_name"]])
    missing = sorted({row["png_name"] for row in rows} - {png.name for png in pngs})
    subtitles = timeline_subtitles(edl)
    write_srt([(a, b, ja.replace(LINE_BREAK, "\n")) for a, b, _, _, ja, _ in subtitles], out / "subtitles" / f"evac-layer-{v}.ja.srt")
    write_srt([(a, b, en.replace(LINE_BREAK, "\n")) for a, b, _, _, _, en in subtitles if en], out / "subtitles" / f"evac-layer-{v}.en.srt")
    shutil.copyfile(BGM_DEFAULT, out / "audio" / "bgm" / BGM_DEFAULT.name)
    shutil.copyfile(SWITCH_WAV, out / "audio" / "se" / "switch.wav")
    starts, _ = cut_starts(edl)
    with (out / "audio" / "se.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["cut", "at_s"])
        writer.writerows([[cut, f"{starts[cut][0] + offset:.2f}"] for cut, offset in BEEPS])
    for stem in sorted(Path(args.stems).glob("*.wav")):
        shutil.copyfile(stem, out / "audio" / "stems" / stem.name)
    mix = out / "audio" / "mix" / f"evac-layer-{v}-mix.wav"
    shutil.copyfile(args.mix, mix)
    if TEXT_TABLE.exists():
        shutil.copyfile(TEXT_TABLE, out / "docs" / TEXT_TABLE.name)
    write_readme(out, v, edl, missing, mix)
    return missing


def write_readme(out, version, edl, missing, mix):
    total = sum(segment["seconds"] for segment in edl["segments"])
    listing = []
    for path in sorted(p for p in out.rglob("*") if p.is_file() and "_prev" not in p.parts and p.name != "README.md"):
        rel = path.relative_to(out)
        extra = f" · {duration(path):.2f} s" if path.suffix in (".mp4", ".mov", ".wav") else ""
        listing.append(f"- `{rel}` ({path.stat().st_size / 1e6:.1f} MB{extra})")
    lines = [
        "# EVAC LAYER demo — DaVinci edit kit",
        "",
        f"version: {version}",
        f"updated: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"timeline: {total:.0f} s · {edl['size'][0]}x{edl['size'][1]} @ {edl['fps']} fps · every file starts at t = 0",
        f"mix: {integrated_lufs(mix):.1f} LUFS integrated (BGM set to {BGM_LUFS:.0f} LUFS; no narration)",
        "",
        "## Use",
        "",
        "- `vcon/` is the check copy with subtitles, telops, switch sound and music burned in.",
        "- `video/` is the picture without any text: the whole timeline, and one ProRes 422 clip per cut (`cuts.csv` gives start, end and what is in it).",
        "- `overlays/` are the Figma exports (1920x1080, transparent) and `overlays.csv` their start and end on the timeline; lay each PNG over the picture for its span.",
        "- `subtitles/` holds the same spans as SRT (Japanese and English).",
        "- `audio/mix/` is the finished mix; `audio/stems/` the layers it was made of, `audio/bgm/` and `audio/se/` the sources, `audio/se.csv` when the switch sound plays.",
        "- `docs/demo-v8-text.md` is the text table (Figma is the source of the wording).",
        "",
        "## Rights",
        "",
        "- Music: Suno Pro, generated for this demo (see ASSETS.md in the repository).",
        "- Switch sound and ambience: Adobe Audition SFX. They may be used inside the film but not handed out on their own, so this folder is for editing only and stays private.",
        "",
        "## Files",
        "",
        *listing,
    ]
    if missing:
        lines += ["", "## Missing overlay PNGs", "", *[f"- `{name}` (in overlays.csv, not exported yet)" for name in missing]]
    (out / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"README {out / 'README.md'}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--edl", default=str(HERE / "edl.json"))
    parser.add_argument("--clean")
    parser.add_argument("--vcon")
    parser.add_argument("--stems")
    parser.add_argument("--mix", default=str(DEMO / "out" / "evac-layer-demo-v1-mix.wav"))
    args = parser.parse_args()
    v = args.version
    args.clean = args.clean or str(DEMO / "out" / f"evac-layer-demo-{v}-clean.mp4")
    args.vcon = args.vcon or str(DEMO / "out" / f"evac-layer-demo-{v}-vcon.mp4")
    args.stems = args.stems or str(DEMO / "out" / f"stems-{v}")
    edl = json.loads(Path(args.edl).read_text(encoding="utf-8"))
    missing = assemble(args, edl)
    print(f"DAVINCI {args.out} version={v} missing_overlays={missing or 'none'}")


if __name__ == "__main__":
    main()
