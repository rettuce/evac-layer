"""Mix the soundtrack for the demo from the EDL timeline, then mux it onto the composed video.

python3 demo/compose/mix_audio.py --sfx-dir <Adobe Audition SFX folder> [--video demo/renders/evac-layer-demo.mp4]
    [--bgm demo/compose/audio/bgm/<track>.mp3]

Narration is either one 179 s demo/compose/audio/narration.wav, or one take per cut in
demo/compose/audio/narration/cutNN.wav (names from narration_filename) placed at that cut's start.

Adobe Audition SFX may be used inside a production but not handed out on their own, so the source WAVs are
copied into demo/compose/audio/ (gitignored) and only the mix leaves this machine, inside the video.
"""

import argparse
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
AUDIO_DIR = HERE / "audio"
OUT_DIR = HERE.parent / "out"
RATE = 48000
# -18 LUFS is kept for the narration; the beds sit well under it so a voice can be laid on top unchanged.
NARRATION_LUFS = -18.0
AMBIENCE_LUFS = -30.0
DRONE_LUFS = -26.0
# A fixed gain for the music bed, no ducking under narration yet, so a candidate can be judged on its own level.
BGM_LUFS = -24.0
BEEP_PEAK_DB = -6.0
FADE_S = 0.5

SOURCES = {
    "ambience": "Ambience_1/Ambience Court House Security Checkpoint Interior Opposite Not Busy 02.wav",
    "beep": "Science Fiction/Science Fiction Sci-Fi Electronic Alert Beep High 01.wav",
    "drone": "Drones/Drone Production Element Imaging Bed Deep Bass 01.wav",
}
AMBIENCE_CUTS = ["1", "2", "5", "8", "9"]
# Cut 0 is the cold open: the calm screen switches to the alert at 5.0 s (15:55:00 on the real-time clock).
# Cut 5 plays the live switch recording from replay t=5.0 s: Lv3 at 13.1 s, Lv4 at 20.1 s, Lv5 at 24.6 s.
BEEPS = [("0", 5.0), ("5", 8.1), ("5", 15.1), ("5", 19.6)]
DRONE_FROM = ("5", 8.1)
DRONE_UNTIL_END_OF = "8"
NARRATION = AUDIO_DIR / "narration.wav"
NARRATION_DIR = AUDIO_DIR / "narration"


def narration_filename(cut):
    number, suffix = re.fullmatch(r"(\d+)(\D*)", cut).groups()
    return f"cut{int(number):02d}{suffix}.wav"


def ensure_sources(sfx_dir):
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    paths = {}
    for key, rel in SOURCES.items():
        dest = AUDIO_DIR / f"{key}.wav"
        if not dest.exists():
            if not sfx_dir:
                raise SystemExit(f"{dest} is missing; pass --sfx-dir to copy {rel}")
            shutil.copyfile(Path(sfx_dir) / rel, dest)
        paths[key] = dest
    return paths


def cut_starts(edl):
    starts, t = {}, 0.0
    for segment in edl["segments"]:
        starts[segment["cut"]] = (t, segment["seconds"])
        t += segment["seconds"]
    return starts, t


def integrated_lufs(path):
    result = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128", "-f", "null", "-"],
                            capture_output=True, text=True, check=True)
    return float(re.findall(r"I:\s+(-?[\d.]+) LUFS", result.stderr)[-1])


def peak_db(path):
    result = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "volumedetect", "-f", "null", "-"],
                            capture_output=True, text=True, check=True)
    return float(re.search(r"max_volume: (-?[\d.]+) dB", result.stderr).group(1))


def ensure_narration(total):
    if not NARRATION.exists():
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"anullsrc=r={RATE}:cl=stereo",
                        "-t", f"{total:.3f}", str(NARRATION)], check=True)


def duration(path):
    result = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                            capture_output=True, text=True, check=True)
    return float(result.stdout)


def narration_track(edl, starts, total, out):
    narrated = [s["cut"] for s in edl["segments"] if s.get("narration_ja")]
    by_name = {narration_filename(cut): cut for cut in narrated}
    found = sorted(NARRATION_DIR.glob("*.wav")) if NARRATION_DIR.is_dir() else []
    for path in found:
        if path.name not in by_name:
            print(f"NARRATION ignored {path.name}: no narrated cut has that name")
    takes = [(path, by_name[path.name]) for path in found if path.name in by_name]
    if not takes:
        ensure_narration(total)
        return NARRATION
    ends = {cut: (starts[narrated[i + 1]][0] if i + 1 < len(narrated) else total) for i, cut in enumerate(narrated)}
    inputs, chains = [], []
    lead = {s["cut"]: s.get("narration_from_s", 0.0) for s in edl["segments"]}
    for i, (path, cut) in enumerate(takes):
        start = starts[cut][0] + lead[cut]
        if start + duration(path) > ends[cut]:
            print(f"NARRATION overrun {path.name}: {duration(path):.1f}s from {start:.0f}s runs past {ends[cut]:.0f}s")
        inputs += ["-i", str(path)]
        chains.append(f"[{i}:a]aresample={RATE},aformat=channel_layouts=mono,pan=stereo|c0=c0|c1=c0,"
                      f"adelay={start * 1000:.0f}:all=1[n{i}]")
    graph = ";".join(chains) + f";{''.join(f'[n{i}]' for i in range(len(takes)))}amix=inputs={len(takes)}:normalize=0:" \
        f"duration=longest,apad=whole_dur={total},atrim=0:{total}[out]"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", graph, "-map", "[out]",
                    "-ar", str(RATE), "-ac", "2", str(out)], check=True)
    print(f"NARRATION {len(takes)}/{len(narrated)} takes from {NARRATION_DIR}")
    return out


def layers(paths, narration, starts, total, bgm=None):
    items = []

    def add(path, filters, stem):
        items.append((path, filters, stem))

    ambience_gain = AMBIENCE_LUFS - integrated_lufs(paths["ambience"])
    for i, cut in enumerate(AMBIENCE_CUTS):
        start, seconds = starts[cut]
        add(paths["ambience"], f"aloop=loop=-1:size={RATE * 120},atrim=0:{seconds},asetpts=N/SR/TB,volume={ambience_gain:.2f}dB,"
            f"afade=t=in:d={FADE_S},afade=t=out:st={seconds - FADE_S}:d={FADE_S},adelay={start * 1000:.0f}:all=1", "ambience")

    drone_start = starts[DRONE_FROM[0]][0] + DRONE_FROM[1]
    end_start, end_seconds = starts[DRONE_UNTIL_END_OF]
    drone_length = end_start + end_seconds - drone_start
    drone_gain = DRONE_LUFS - integrated_lufs(paths["drone"])
    add(paths["drone"], f"aloop=loop=-1:size={RATE * 120},atrim=0:{drone_length},asetpts=N/SR/TB,volume={drone_gain:.2f}dB,"
        f"afade=t=in:d=1.5,afade=t=out:st={drone_length - 2}:d=2,adelay={drone_start * 1000:.0f}:all=1", "drone")

    beep_gain = BEEP_PEAK_DB - peak_db(paths["beep"])
    for i, (cut, offset) in enumerate(BEEPS):
        at = starts[cut][0] + offset
        add(paths["beep"], f"volume={beep_gain:.2f}dB,adelay={at * 1000:.0f}:all=1", "se")

    if bgm:
        bgm_gain = BGM_LUFS - integrated_lufs(bgm)
        add(bgm, f"aloop=loop=-1:size={RATE * 600},atrim=0:{total},asetpts=N/SR/TB,volume={bgm_gain:.2f}dB,"
            f"afade=t=in:d=1.5,afade=t=out:st={total - 3}:d=3", "bgm")

    add(narration, "anull", "narration")
    return items


def render(items, total, out):
    inputs, chains = [], []
    for i, (path, filters, _) in enumerate(items):
        inputs += ["-i", str(path)]
        chains.append(f"[{i}:a]{filters}[l{i}]")
    graph = ";".join(chains) + f";{''.join(f'[l{i}]' for i in range(len(items)))}amix=inputs={len(items)}:normalize=0:" \
        f"duration=longest,apad=whole_dur={total},atrim=0:{total}[mix]"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", graph, "-map", "[mix]",
                    "-ar", str(RATE), "-ac", "2", str(out)], check=True)


def write_stems(items, total, stems_dir):
    stems_dir.mkdir(parents=True, exist_ok=True)
    for stem in dict.fromkeys(stem for _, _, stem in items):
        out = stems_dir / f"{stem}.wav"
        render([item for item in items if item[2] == stem], total, out)
        print(f"STEM {out}")


def limit(raw, out):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw), "-af", "alimiter=limit=0.89", str(out)], check=True)
    return integrated_lufs(out)


def mux(video, audio, out):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(video), "-i", str(audio), "-map", "0:v", "-map", "1:a",
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", str(out)], check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--edl", default=str(HERE / "edl.json"))
    parser.add_argument("--sfx-dir")
    parser.add_argument("--video", default=str(HERE.parent / "renders" / "evac-layer-demo.mp4"))
    parser.add_argument("--out", default=str(OUT_DIR / "evac-layer-demo-v1.mp4"))
    parser.add_argument("--bgm", help="music bed, looped or trimmed to the video and set to BGM_LUFS")
    parser.add_argument("--switch-se", help="WAV for the switch sound in place of the default beep (bgm seat's candidates)")
    # Stems stay at their mix gains and skip the limiter, so they sum back to the mix for an editor to rebalance.
    parser.add_argument("--stems", help="also write one 48 kHz WAV per layer, full length from 0 s, into this folder")
    args = parser.parse_args()
    edl = json.loads(Path(args.edl).read_text(encoding="utf-8"))
    starts, total = cut_starts(edl)
    paths = ensure_sources(args.sfx_dir)
    if args.switch_se:
        paths["beep"] = Path(args.switch_se)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="evac-mix-"))
    try:
        narration = narration_track(edl, starts, total, work / "narration.wav")
        items = layers(paths, narration, starts, total, Path(args.bgm) if args.bgm else None)
        render(items, total, work / "raw.wav")
        if args.stems:
            write_stems(items, total, Path(args.stems))
        mix = OUT_DIR / "evac-layer-demo-v1-mix.wav"
        lufs = limit(work / "raw.wav", mix)
    finally:
        shutil.rmtree(work)
    mux(Path(args.video), mix, Path(args.out))
    print(f"MIXED {mix} {total:.0f}s integrated={lufs:.1f} LUFS → {args.out}")


if __name__ == "__main__":
    main()
