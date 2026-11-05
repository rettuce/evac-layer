"""Checks a crops.json: every window inside the canvas, no two windows overlapping, the four column windows
all different, and each column's four faces adjacent round the strip (front -> right -> back -> left).

python3 demo/capture/check_crops.py [demo/renders/canvas-crops.json]
"""

import json
import sys
from itertools import combinations

FACE_ORDER = ("front", "right", "back", "left")


def overlaps(a, b):
    return a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "demo/renders/canvas-crops.json"
    data = json.load(open(path, encoding="utf-8"))
    width, height = data["canvas"]
    crops = data["crops"]
    problems = []
    for name, (x, y, w, h) in crops.items():
        if x < 0 or y < 0 or x + w > width or y + h > height:
            problems.append(f"{name} leaves the {width}x{height} canvas")
    for (a, ra), (b, rb) in combinations(crops.items(), 2):
        if overlaps(ra, rb):
            problems.append(f"{a} overlaps {b}")
    columns = sorted(name for name in crops if name.startswith("pillar_"))
    if len({tuple(crops[name]) for name in columns}) != len(columns):
        problems.append("two columns share a window")
    for name in columns:
        faces = data["faces"][name]
        x, y, w, h = crops[name]
        strip = sorted(faces[face][0] for face in FACE_ORDER)
        face_width = w // len(FACE_ORDER)
        if strip != [x + k * face_width for k in range(len(FACE_ORDER))]:
            problems.append(f"{name}: faces do not tile the strip")
        quarter = [(faces[face][0] - x) // face_width for face in FACE_ORDER]
        if any((quarter[k + 1] - quarter[k]) % len(FACE_ORDER) != 1 for k in range(len(FACE_ORDER) - 1)):
            problems.append(f"{name}: front -> right -> back -> left is not continuous")
    for line in problems:
        print(f"CROPS_CHECK {line}")
    print(f"CROPS_CHECK {len(crops)} windows, {len(columns)} columns: {'ok' if not problems else f'{len(problems)} problems'}")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
