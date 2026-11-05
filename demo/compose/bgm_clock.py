"""A minimal clock-tick bed for the demo, standard library only.

python3 demo/compose/bgm_clock.py --click impulse|noise|lowbit --out <wav>
python3 demo/compose/bgm_clock.py --voice metal --pattern A|B --out <wav>

A dry click every 0.5 s (a second hand at double speed, 120 BPM), a sub sine pulse every 4 beats and a sparse
high texture. The bed opens up one step at STEP_AT_S, and goes quiet around every switch SE so the SE stays alone.
"""

import argparse
import array
import json
import math
import random
import sys
import wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from mix_audio import BEEPS, cut_starts

RATE = 48000
BEAT_S = 0.5
# Every pitch is a whole multiple of 6 kHz / 128 and kept out of 750-3000 Hz, where a held tone reads as "cute".
GRID_HZ = 6000 / 128
SUB_HZ = GRID_HZ
TEXTURE_HZ = [GRID_HZ * n for n in (192, 224, 256, 288, 320)]
STEP_AT_S = 60.0
SE_CLEAR_S = 0.5
PEAK_DBFS = -6.0
SEED = 20261105


def edge_env(n, edge):
    return [min(1.0, i / edge, (n - 1 - i) / edge) if edge else 1.0 for i in range(n)]


def highpass(samples, cutoff_hz):
    a = math.exp(-2 * math.pi * cutoff_hz / RATE)
    out, prev_x, prev_y = [], 0.0, 0.0
    for x in samples:
        prev_y = a * (prev_y + x - prev_x)
        prev_x = x
        out.append(prev_y)
    return out


def click_impulse(rng, accent):
    width = 4
    return [1.0] * width + [-0.6] * 2


def click_noise(rng, accent):
    n = int(RATE * 0.012)
    env = edge_env(n, 6)
    burst = highpass([rng.uniform(-1, 1) for _ in range(n)], 1500 * (3 if accent else 4))
    return [s * e for s, e in zip(burst, env)]


def click_lowbit(rng, accent):
    freq = GRID_HZ * (256 if accent else 288)
    n = int(RATE * 0.005)
    return [1.0 if math.sin(2 * math.pi * freq * i / RATE) >= 0 else -1.0 for i in range(n)]


CLICKS = {"impulse": click_impulse, "noise": click_noise, "lowbit": click_lowbit}


def sub_pulse():
    n = int(RATE * 0.128)
    fade = int(RATE * 0.012)
    return [math.sin(2 * math.pi * SUB_HZ * i / RATE) * min(1.0, i / fade, (n - 1 - i) / fade) for i in range(n)]


def texture(rng):
    freq = rng.choice(TEXTURE_HZ)
    n = int(RATE * 0.045)
    env = edge_env(n, 12)
    attack = int(RATE * 0.001)
    return [(math.sin(2 * math.pi * freq * i / RATE) + (rng.uniform(-1, 1) if i < attack else 0.0)) * env[i]
            for i in range(n)]


def square(freq, ms):
    n = int(RATE * ms / 1000)
    return [1.0 if math.sin(2 * math.pi * freq * i / RATE) >= 0 else -1.0 for i in range(n)]


LOUD, MID, SOFT = 1.0, 0.55, 0.3
HIGH, MIDDLE, LOW = GRID_HZ * 288, GRID_HZ * 272, GRID_HZ * 256
# (eighth-note step in the cycle, pitch, length ms, gain, only after STEP_AT_S). Even steps are the clock's beats.
METAL_PATTERNS = {
    "A": (8, [
        (0, HIGH, 8, LOUD, False), (2, LOW, 5, MID, False), (4, LOW, 5, MID, False), (6, LOW, 5, MID, False),
        (1, MIDDLE, 3, SOFT, True), (3, MIDDLE, 3, SOFT, True), (5, MIDDLE, 3, SOFT, True), (7, MIDDLE, 3, SOFT, True),
    ]),
    "B": (16, [
        (0, HIGH, 8, LOUD, False), (2, LOW, 5, MID, False), (4, LOW, 3, MID, False), (6, MIDDLE, 5, MID, False),
        (8, LOW, 5, MID, False), (10, LOW, 3, MID, False), (12, HIGH, 8, LOUD, False), (14, MIDDLE, 5, MID, False),
        (1, MIDDLE, 3, SOFT, True), (3, MIDDLE, 3, SOFT, True), (5, HIGH, 3, SOFT, True), (7, MIDDLE, 5, MID, True),
        (9, MIDDLE, 3, SOFT, True), (11, HIGH, 3, SOFT, True), (13, MIDDLE, 3, SOFT, True), (15, MIDDLE, 3, SOFT, True),
    ]),
}


def render_metal(pattern, se_at, total):
    buf = array.array("d", bytes(8 * 2 * int(total * RATE)))
    clear = lambda t: all(abs(t - s) > SE_CLEAR_S for s in se_at)
    cycle, hits = METAL_PATTERNS[pattern]
    eighth = BEAT_S / 2
    sounds = {(freq, ms): square(freq, ms) for _, freq, ms, _, _ in hits}
    for k in range(int(total / eighth)):
        t = k * eighth
        for step, freq, ms, gain, late in hits:
            if step == k % cycle and clear(t) and (t >= STEP_AT_S or not late):
                place(buf, t, sounds[(freq, ms)], gain, 0.4 if step % 4 == 0 else 0.6)
    fade_edges(buf)
    return buf


def place(buf, at_s, sound, gain, pan):
    start = int(round(at_s * RATE))
    left, right = gain * math.cos(pan * math.pi / 2), gain * math.sin(pan * math.pi / 2)
    for i, s in enumerate(sound):
        j = 2 * (start + i)
        if j + 1 >= len(buf):
            break
        buf[j] += s * left
        buf[j + 1] += s * right


def se_times(edl_path):
    starts, total = cut_starts(json.loads(Path(edl_path).read_text(encoding="utf-8")))
    return [starts[cut][0] + offset for cut, offset in BEEPS], total


def render(kind, se_at, total):
    rng = random.Random(SEED)
    buf = array.array("d", bytes(8 * 2 * int(total * RATE)))
    clear = lambda t: all(abs(t - s) > SE_CLEAR_S for s in se_at)
    make_click = CLICKS[kind]
    sub = sub_pulse()
    beats = int(total / BEAT_S)
    for b in range(beats):
        t = b * BEAT_S
        if not clear(t):
            continue
        lifted = t >= STEP_AT_S
        tick = b % 2 == 0
        place(buf, t, make_click(rng, tick), (0.9 if tick else 0.6) * (1.25 if lifted else 1.0), 0.35 if tick else 0.65)
        if lifted and clear(t + BEAT_S / 2):
            place(buf, t + BEAT_S / 2, make_click(rng, False), 0.25, 0.5)
        if b % 4 == 0:
            place(buf, t, sub, 0.5 if lifted else 0.35, 0.5)
        if b % 8 == 3 and rng.random() < (0.5 if lifted else 0.25):
            place(buf, t + BEAT_S / 4, texture(rng), 0.12, rng.choice((0.2, 0.8)))
    fade_edges(buf)
    return buf


def fade_edges(buf):
    fade = int(RATE * 3)
    n = len(buf) // 2
    for i in range(fade):
        g = i / fade
        for k in (2 * i, 2 * i + 1, 2 * (n - 1 - i), 2 * (n - 1 - i) + 1):
            buf[k] *= g


def write_wav(buf, out):
    peak = max(abs(min(buf)), abs(max(buf))) or 1.0
    scale = (10 ** (PEAK_DBFS / 20)) / peak * (2 ** 23 - 1)
    data = bytearray()
    for s in buf:
        data += int(round(s * scale)).to_bytes(3, "little", signed=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(3)
        w.setframerate(RATE)
        w.writeframes(bytes(data))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--click", choices=sorted(CLICKS), default="impulse")
    parser.add_argument("--voice", choices=["layered", "metal"], default="layered",
                        help="metal: only the 1-bit square click, no sub or texture")
    parser.add_argument("--pattern", choices=sorted(METAL_PATTERNS), default="A")
    parser.add_argument("--edl", default=str(HERE / "edl.json"))
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    se_at, total = se_times(args.edl)
    if args.voice == "metal":
        buf, label = render_metal(args.pattern, se_at, total), f"metal-{args.pattern}"
    else:
        buf, label = render(args.click, se_at, total), args.click
    write_wav(buf, Path(args.out))
    print(f"BGM {label} {total:.0f}s → {args.out} (SE clear at {', '.join(f'{s:.1f}' for s in se_at)} s)")


if __name__ == "__main__":
    main()
