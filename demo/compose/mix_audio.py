"""Mix the soundtrack for the demo from the EDL timeline, then mux it onto the composed video.

python3 demo/compose/mix_audio.py --sfx-dir <Adobe Audition SFX folder> [--video demo/renders/evac-layer-demo.mp4]
    [--bgm <wav> | --no-bgm]

The demo has no narration by default (subtitles and captions carry the words); with --narration it is either one 179 s demo/compose/audio/narration.wav, or one take per cut in
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
# With --narration the voice leads: -16 LUFS over the music at -26, and the ambience and drone dip 6 dB while it
# speaks, fading 300 ms either side (田中, D-31). Without narration the music stays at BGM_LUFS.
NARRATION_LUFS = -16.0
NARRATED_BGM_LUFS = -26.0
DUCK_DB = -6.0
DUCK_FADE_S = 0.3
# ebur128 reports a silent track as -70 LUFS; it gets no gain.
SILENCE_LUFS = -69.0
AMBIENCE_LUFS = -30.0
DRONE_LUFS = -26.0
# A fixed gain for the music bed, no ducking: the demo carries no narration by default.
BGM_LUFS = -20.0
BGM_DEFAULT = AUDIO_DIR / "bgm" / "grid-cover-1-00254105.wav"
BGM_SOURCE = "https://suno.com/song/00254105-6ec5-4a63-a178-f82a1451777a"
BEEP_PEAK_DB = -6.0
FADE_S = 0.5

SOURCES = {
    "ambience": "Ambience_1/Ambience Court House Security Checkpoint Interior Opposite Not Busy 02.wav",
    "switch": "Science Fiction/Science Fiction Sci-Fi Electronic Beep 04.wav",
    "drone": "Drones/Drone Production Element Imaging Bed Deep Bass 01.wav",
}
AMBIENCE_CUTS = ["1", "2", "5", "8", "9"]
# Cut 0 is the cold open: the calm screen switches to the alert at 5.0 s (15:55:00 on the real-time clock).
# Cut 5 plays the live switch recording from replay t=5.0 s: Lv3 at 13.1 s, Lv4 at 20.1 s, Lv5 at 24.6 s.
BEEPS = [("0", 5.0), ("5", 4.0), ("5", 9.5), ("5", 15.0)]
DRONE_FROM = ("5", 4.0)
DRONE_UNTIL_END_OF = "8"
# Every take opens on a recorder click about 9 ms in; a short fade at both ends keeps it out of the mix.
NARRATION_FADE_S = 0.1
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


def edge_fades(seconds):
    f = NARRATION_FADE_S
    return f"afade=t=in:d={f},afade=t=out:st={max(seconds - f, 0):.3f}:d={f}"


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
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(NARRATION), "-af", edge_fades(duration(NARRATION)),
                        "-ar", str(RATE), "-ac", "2", str(out)], check=True)
        return out, [(starts[cut][0], starts[cut][0] + starts[cut][1]) for cut in narrated]
    ends = {cut: (starts[narrated[i + 1]][0] if i + 1 < len(narrated) else total) for i, cut in enumerate(narrated)}
    inputs, chains, spans = [], [], []
    lead = {s["cut"]: s.get("narration_from_s", 0.0) for s in edl["segments"]}
    for i, (path, cut) in enumerate(takes):
        start = starts[cut][0] + lead[cut]
        spans.append((start, start + duration(path)))
        if start + duration(path) > ends[cut]:
            print(f"NARRATION overrun {path.name}: {duration(path):.1f}s from {start:.0f}s runs past {ends[cut]:.0f}s")
        inputs += ["-i", str(path)]
        chains.append(f"[{i}:a]aresample={RATE},aformat=channel_layouts=mono,{edge_fades(duration(path))},pan=stereo|c0=c0|c1=c0,"
                      f"adelay={start * 1000:.0f}:all=1[n{i}]")
    graph = ";".join(chains) + f";{''.join(f'[n{i}]' for i in range(len(takes)))}amix=inputs={len(takes)}:normalize=0:" \
        f"duration=longest,apad=whole_dur={total},atrim=0:{total}[out]"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", graph, "-map", "[out]",
                    "-ar", str(RATE), "-ac", "2", str(out)], check=True)
    print(f"NARRATION {len(takes)}/{len(narrated)} takes from {NARRATION_DIR}")
    return out, spans


def duck(spans):
    """A volume filter that dips by DUCK_DB over each span, ramping over DUCK_FADE_S before and after it."""
    if not spans:
        return ""
    floor = 10 ** (DUCK_DB / 20)
    f = DUCK_FADE_S
    dips = [f"(1-{1 - floor:.4f}*clip((t-{a - f:.3f})/{f}\\,0\\,1)*clip(({b + f:.3f}-t)/{f}\\,0\\,1))" for a, b in spans]
    return f",volume='{'*'.join(dips)}':eval=frame"


def layers(paths, narration, starts, total, bgm=None, spans=()):
    items = []

    def add(path, filters, stem):
        items.append((path, filters, stem))

    ambience_gain = AMBIENCE_LUFS - integrated_lufs(paths["ambience"])
    for i, cut in enumerate(AMBIENCE_CUTS):
        start, seconds = starts[cut]
        add(paths["ambience"], f"aloop=loop=-1:size={RATE * 120},atrim=0:{seconds},asetpts=N/SR/TB,volume={ambience_gain:.2f}dB,"
            f"afade=t=in:d={FADE_S},afade=t=out:st={seconds - FADE_S}:d={FADE_S},adelay={start * 1000:.0f}:all=1{duck(spans)}", "ambience")

    drone_start = starts[DRONE_FROM[0]][0] + DRONE_FROM[1]
    end_start, end_seconds = starts[DRONE_UNTIL_END_OF]
    drone_length = end_start + end_seconds - drone_start
    drone_gain = DRONE_LUFS - integrated_lufs(paths["drone"])
    add(paths["drone"], f"aloop=loop=-1:size={RATE * 120},atrim=0:{drone_length},asetpts=N/SR/TB,volume={drone_gain:.2f}dB,"
        f"afade=t=in:d=1.5,afade=t=out:st={drone_length - 2}:d=2,adelay={drone_start * 1000:.0f}:all=1{duck(spans)}", "drone")

    beep_gain = BEEP_PEAK_DB - peak_db(paths["switch"])
    for i, (cut, offset) in enumerate(BEEPS):
        at = starts[cut][0] + offset
        add(paths["switch"], f"volume={beep_gain:.2f}dB,adelay={at * 1000:.0f}:all=1", "se")

    if bgm:
        bgm_gain = (NARRATED_BGM_LUFS if narration else BGM_LUFS) - integrated_lufs(bgm)
        add(bgm, f"aloop=loop=-1:size={RATE * 600},atrim=0:{total},asetpts=N/SR/TB,volume={bgm_gain:.2f}dB,"
            f"afade=t=in:d=1.5,afade=t=out:st={total - 3}:d=3", "bgm")

    if narration:
        level = integrated_lufs(narration)
        narration_gain = NARRATION_LUFS - level if level > SILENCE_LUFS else 0.0
        add(narration, f"volume={narration_gain:.2f}dB", "narration")
    return items


def render(items, total, out):
    inputs, chains = [], []
    for i, (path, filters, _) in enumerate(items):
        inputs += ["-i", str(path)]
        chains.append(f"[{i}:a]{filters}[l{i}]")
    graph = ";".join(chains) + f";{''.join(f'[l{i}]' for i in range(len(items)))}amix=inputs={len(items)}:normalize=0:" \
        f"duration=longest,apad=whole_dur={total},atrim=0:{total}[mix]"
    # Float, so the layers and the pre-limiter mix keep peaks above 0 dBFS instead of clipping them.
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", graph, "-map", "[mix]",
                    "-ar", str(RATE), "-ac", "2", "-c:a", "pcm_f32le", str(out)], check=True)


def write_stems(items, total, stems_dir):
    stems_dir.mkdir(parents=True, exist_ok=True)
    for stem in dict.fromkeys(stem for _, _, stem in items):
        out = stems_dir / f"{stem}.wav"
        render([item for item in items if item[2] == stem], total, out)
        print(f"STEM {out}")


def limit(raw, out):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw), "-af", "alimiter=limit=0.89:level=disabled", "-c:a", "pcm_s24le", str(out)], check=True)
    return integrated_lufs(out)


def mux(video, audio, out):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(video), "-i", str(audio), "-map", "0:v", "-map", "1:a",
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", str(out)], check=True)


def resolve_bgm(args):
    if args.no_bgm:
        return None
    bgm = Path(args.bgm)
    if bgm.exists():
        return bgm
    if bgm == BGM_DEFAULT:
        print(f"BGM skipped: {bgm} is missing (download the WAV from {BGM_SOURCE})")
        return None
    raise SystemExit(f"{bgm} is missing")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--edl", default=str(HERE / "edl.json"))
    parser.add_argument("--sfx-dir")
    parser.add_argument("--video", default=str(HERE.parent / "renders" / "evac-layer-demo.mp4"))
    parser.add_argument("--out", default=str(OUT_DIR / "evac-layer-demo-v1.mp4"))
    parser.add_argument("--bgm", default=str(BGM_DEFAULT), help="music bed, looped or trimmed to the video and set to BGM_LUFS")
    parser.add_argument("--no-bgm", action="store_true", help="mix without the music bed")
    parser.add_argument("--narration", action="store_true", help="also mix the narration takes from demo/compose/audio/narration")
    parser.add_argument("--switch-se", help="WAV for the switch sound in place of the default Sci-Fi Electronic Beep 04")
    # Stems stay at their mix gains and skip the limiter, so they sum back to the mix for an editor to rebalance.
    parser.add_argument("--stems", help="also write one 48 kHz WAV per layer, full length from 0 s, into this folder")
    args = parser.parse_args()
    edl = json.loads(Path(args.edl).read_text(encoding="utf-8"))
    starts, total = cut_starts(edl)
    paths = ensure_sources(args.sfx_dir)
    if args.switch_se:
        paths["switch"] = Path(args.switch_se)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="evac-mix-"))
    try:
        narration, spans = narration_track(edl, starts, total, work / "narration.wav") if args.narration else (None, [])
        items = layers(paths, narration, starts, total, resolve_bgm(args), spans)
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
