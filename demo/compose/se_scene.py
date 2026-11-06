"""Scene-transition sounds for the cuts between scenes, synthesised with the standard library.

python3 demo/compose/se_scene.py --out <dir> [--only A1,B2]

Softer than the switch SE, only enough to mark the cut: noise and 9 kHz+ tones, no pitched mid range, no falling
pitch, no reverb. Every sound is set to TARGET_LUFS with its peak held under PEAK_CAP_DBFS; edit CANDIDATES to tune.
"""

import argparse
import json
import math
import random
import re
import subprocess
import wave
from pathlib import Path

RATE = 48000
GRID_HZ = 6000 / 128
EDGE_S = 0.001
TARGET_LUFS = -22.0
PEAK_CAP_DBFS = -12.0
SEED = 20261106

CANDIDATES = {
    "A1": dict(name="inhale", kind="swell", seconds=0.20, hp_hz=3000, lp_from_hz=4000, lp_to_hz=14000, rise=0.97, fall=0.03,
               note="雑音の短い吸い込み。明るくなりながら膨らみ、最後は硬く切る"),
    "A2": dict(name="breath", kind="swell", seconds=0.25, hp_hz=6000, lp_from_hz=16000, lp_to_hz=16000, rise=0.5, fall=0.5,
               note="6 kHz 以上の空気の一息。膨らんで同じだけ引く"),
    "A3": dict(name="band-swell", kind="swell", seconds=0.35, hp_hz=9000, lp_from_hz=13000, lp_to_hz=13000, rise=0.95, fall=0.05,
               note="9〜13 kHz の帯域雑音が膨らみ、硬く切れる"),
    "A4": dict(name="air-short", kind="swell", seconds=0.30, hp_hz=4500, lp_from_hz=9000, lp_to_hz=18000, rise=0.4, fall=0.6,
               note="前回 09 を短くしたもの。4.5 kHz 以上・頭寄りに膨らむ"),
    "B1": dict(name="static-soft", kind="static", bursts=3, burst_s=0.012, gap_s=0.035, hp_from_hz=3000, hp_step_hz=1500, drive=3.0,
               note="白色雑音 12 ms × 3。ハイパスが 3 → 6 kHz と上がる"),
    "B2": dict(name="grain-6", kind="grain", grains=6, grain_s=0.006, gap_s=0.015, hp_from_hz=5000, hp_step_hz=1000, drive=4.0,
               note="6 ms の雑音の粒 × 6。15 ms 間隔・粒ごとに少し明るく"),
    "B3": dict(name="hybrid-tail", kind="hybrid", head_s=0.008, head_hp_hz=6000, head_drive=4.0, tail_mult=288, tail_s=0.12, tail_decay_s=0.035,
               note="6 kHz 以上の雑音 8 ms の頭に 13.5 kHz の短い尾"),
    "B4": dict(name="tickzip-slow", kind="zip", tick_s=0.003, hp_hz=8000, drive=8.0, gaps_s=(0.08, 0.06, 0.045, 0.035, 0.028, 0.022),
               note="8 kHz 以上の 3 ms の雑音ティック 7 発が 80 → 22 ms 間隔へ遅く詰まる"),
}


def highpass_series(samples, cutoff):
    a = math.exp(-2 * math.pi * cutoff / RATE)
    out, px, py = [], 0.0, 0.0
    for x in samples:
        py = a * (py + x - px)
        px = x
        out.append(py)
    return out


def swell(rng, p):
    n = int(RATE * p["seconds"])
    hp = [highpass_series([rng.uniform(-1, 1) for _ in range(n)], p["hp_hz"]) for _ in range(2)]
    out, ys = [], [0.0, 0.0]
    up, down = p["rise"] * n, p["fall"] * n
    for i in range(n):
        cutoff = p["lp_from_hz"] * (p["lp_to_hz"] / p["lp_from_hz"]) ** (i / n)
        a = math.exp(-2 * math.pi * cutoff / RATE)
        env = min(0.5 - 0.5 * math.cos(math.pi * min(1, i / up)), 0.5 - 0.5 * math.cos(math.pi * min(1, (n - 1 - i) / down)))
        frame = []
        for c in range(2):
            ys[c] = a * ys[c] + (1 - a) * hp[c][i]
            frame.append(ys[c] * env)
        out.append(tuple(frame))
    return out


def saturate(v, drive):
    return math.tanh(drive * v) / math.tanh(drive) if drive else v


def bursts(rng, count, length_s, gap_s, hp_from, hp_step, edge, drive=0.0):
    span = int(RATE * (gap_s * (count - 1) + length_s)) + 1
    buf = [[0.0, 0.0] for _ in range(span)]
    n = int(RATE * length_s)
    for k in range(count):
        start = int(RATE * gap_s * k)
        for c in range(2):
            burst = highpass_series([rng.uniform(-1, 1) for _ in range(n)], hp_from + hp_step * k)
            for i, v in enumerate(burst):
                buf[start + i][c] += saturate(v, drive) * min(1.0, i / edge, (n - 1 - i) / edge)
    return [tuple(f) for f in buf]


def static(rng, p):
    return bursts(rng, p["bursts"], p["burst_s"], p["gap_s"], p["hp_from_hz"], p["hp_step_hz"], int(RATE * EDGE_S), p["drive"])


def grain(rng, p):
    return bursts(rng, p["grains"], p["grain_s"], p["gap_s"], p["hp_from_hz"], p["hp_step_hz"], int(RATE * EDGE_S), p["drive"])


def hybrid(rng, p):
    head_n = int(RATE * p["head_s"])
    head = [saturate(v, p["head_drive"]) for v in highpass_series([rng.uniform(-1, 1) for _ in range(head_n)], p["head_hp_hz"])]
    freq = GRID_HZ * p["tail_mult"]
    tail_n = int(RATE * p["tail_s"])
    tail = [math.sin(2 * math.pi * freq * i / RATE) * math.exp(-i / (RATE * p["tail_decay_s"])) for i in range(tail_n)]
    mono = head + tail
    return [(v, v) for v in mono]


def zip_(rng, p):
    gaps = p["gaps_s"]
    count = len(gaps) + 1
    times = [sum(gaps[:k]) for k in range(count)]
    frames = [[0.0, 0.0] for _ in range(int(RATE * (times[-1] + p["tick_s"])) + 1)]
    n = int(RATE * p["tick_s"])
    edge = max(1, n // 8)
    for t in times:
        start = int(RATE * t)
        for c in range(2):
            tick = highpass_series([rng.uniform(-1, 1) for _ in range(n)], p["hp_hz"])
            for i, v in enumerate(tick):
                frames[start + i][c] += saturate(v, p["drive"]) * min(1.0, i / edge, (n - 1 - i) / edge)
    return [tuple(f) for f in frames]


KINDS = {"swell": swell, "static": static, "grain": grain, "hybrid": hybrid, "zip": zip_}


def edge_fade(frames):
    e = int(RATE * EDGE_S)
    n = len(frames)
    return [(l * min(1.0, i / e, (n - 1 - i) / e), r * min(1.0, i / e, (n - 1 - i) / e)) for i, (l, r) in enumerate(frames)]


def write_wav(path, frames, gain=1.0):
    data = bytearray()
    for l, r in frames:
        for v in (l, r):
            data += int(max(-1.0, min(1.0, v * gain)) * 8388607).to_bytes(3, "little", signed=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(3)
        w.setframerate(RATE)
        w.writeframes(bytes(data))


def short_lufs(path):
    result = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "apad=whole_dur=3,ebur128",
                             "-f", "null", "-"], capture_output=True, text=True, errors="replace")
    return float(re.findall(r"I:\s+(-?[\d.]+) LUFS", result.stderr)[-1])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--only", help="comma-separated keys from CANDIDATES")
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    keys = args.only.split(",") if args.only else list(CANDIDATES)
    meta = []
    for key in keys:
        p = CANDIDATES[key]
        frames = edge_fade(KINDS[p["kind"]](random.Random(f"{SEED}-{key}"), p))
        peak = max(max(abs(l), abs(r)) for l, r in frames)
        probe = out / f".{key}.wav"
        write_wav(probe, frames, 1.0 / peak)
        loudness_gain = 10 ** ((TARGET_LUFS - short_lufs(probe)) / 20) / peak
        gain = min(loudness_gain, 10 ** (PEAK_CAP_DBFS / 20) / peak)
        path = out / f"{key}-{p['name']}.wav"
        write_wav(path, frames, gain)
        probe.unlink()
        meta.append(dict(key=key, name=p["name"], file=path.name, seconds=round(len(frames) / RATE, 3),
                         lufs=round(short_lufs(path), 1), peak_dbfs=round(20 * math.log10(peak * gain), 1), note=p["note"]))
        print(meta[-1])
    (out / "se_scene.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
