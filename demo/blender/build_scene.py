"""Station-concourse corner with four embedded signage screens, rendered headless with Eevee.

blender -b -P demo/blender/build_scene.py -- --out demo/renders/test.mp4 --seconds 5 --res 1280x720
blender -b -P demo/blender/build_scene.py -- --look A --still demo/renders/look_A.png
blender -b -P demo/blender/build_scene.py -- --look C --cams hero,near-column --stills-dir demo/renders/stills
blender -b -P demo/blender/build_scene.py -- --look C --cut switch --seconds 27 --frame 555 --still x.png --verify-colors
"""

import argparse
import json
import math
import shutil
import subprocess
import sys
import time
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))

from layout import (
    BACK_WALL_Y, elevation_canvas, elevation_crop, nearest_louver_gap_x, CEILING_Z, COLUMN_CLAD_M, COLUMN_CLAD_TOP_Z, COLUMN_SIZE, COLUMNS, EYE_Z, HEADWALL_BOTTOM_Z,
    HEADWALL_DEPTH, HEADWALL_Y, LEFT_WALL_X, RIBBON_PANEL_H, RIBBON_PANEL_W,
    RIGHT_WALL_X,
)
from led_wrap import build_led_wrap
from looks import LOOKS, build_look
from primitives import box, principled, vertical_plane
from verify_colors import report_screen_colors

DEMO_DIR = Path(__file__).resolve().parent.parent
SCREENS_DIR = DEMO_DIR / "screens"
CACHE_DIR = DEMO_DIR / "cache"
HDRI_PATH = DEMO_DIR / "assets" / "metro_vijzelgracht_1k.hdr"
PLACEHOLDER_FONT = Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")
CUTS = ("ambient", "switch", "alert", "ambient-real", "switch-real", "alert-real", "cut08-seq", "off", "test")

INCH = 0.0254
JOINT_M = 0.003
FLUSH_EPS_M = 0.001
# With the Standard view transform an unlit emission of 1.0 shows the recording's own sRGB values.
SCREEN_EMISSION = 1.0
# Standard has no highlight roll-off, so the room (not the screens) is dimmed to keep the floor from clipping.
ROOM_LIGHT_SCALE = 0.55
LENS_MM = 35.0
F_STOP = 2.8
# Look B (35 downlights) and C (louvers) overflow the default 512 MB shadow pool.
SHADOW_POOL_MB = "1536"
# 4K stills need more shadow pages than the pool above holds (7353 of 6144 at 3840x2160).
SHADOW_POOL_LARGE_MB = "2048"


def facing(yaw):
    return Vector((math.sin(yaw), -math.cos(yaw), 0.0))


def panel_from_diagonal(diagonal_in, aspect_w, aspect_h):
    unit = diagonal_in * INCH / math.hypot(aspect_w, aspect_h)
    return aspect_w * unit, aspect_h * unit


COLUMN_CLAD_HALF = COLUMN_SIZE / 2 + COLUMN_CLAD_M
COLUMN_LED_BOTTOM_Z = 0.4
COLUMN_LED_TOP_Z = 3.6
COLUMN_LED_RADIUS = 0.03
COLUMN_LED_MID_Z = (COLUMN_LED_BOTTOM_Z + COLUMN_LED_TOP_Z) / 2
COLUMN_LED_PERIMETER = 8 * (COLUMN_SIZE / 2 + COLUMN_CLAD_M - COLUMN_LED_RADIUS) + 2 * math.pi * COLUMN_LED_RADIUS
RIBBON_SIZE = (RIBBON_PANEL_W, RIBBON_PANEL_H)
RIBBON_Z = HEADWALL_BOTTOM_Z + RIBBON_PANEL_H / 2
# The middle ribbon panel sits on the hero camera axis (x = 0), so the three repeats read as centred.
RIBBON_CENTER_X = 0.0
BACK_WALL_SCREEN_Z = 2.0
BACK_WALL_9X16 = panel_from_diagonal(120, 9, 16)
BACK_WALL_9X16_COUNT = 3


def back_wall_mounts():
    """Portrait screens spaced evenly between the two back columns, each centred on the nearest louver gap."""
    inner = COLUMNS[3][0] - COLUMN_CLAD_HALF
    width = BACK_WALL_9X16[0]
    gap = (2 * inner - BACK_WALL_9X16_COUNT * width) / (BACK_WALL_9X16_COUNT + 1)
    return [(Vector((nearest_louver_gap_x(-inner + gap * (i + 1) + width * (i + 0.5)), BACK_WALL_Y, BACK_WALL_SCREEN_Z)), 0.0)
            for i in range(BACK_WALL_9X16_COUNT)]


HEADWALL_FRONT_Y = HEADWALL_Y - HEADWALL_DEPTH / 2


def column_front(x, y, z):
    return Vector((x, y - COLUMN_CLAD_HALF, z)), 0.0


def ribbon_xs():
    pitch = RIBBON_SIZE[0] + 2 * JOINT_M
    return [RIBBON_CENTER_X, RIBBON_CENTER_X - pitch, RIBBON_CENTER_X + pitch]


def screen_spec(size, pixels, mounts):
    center, yaw = mounts[0]
    return {"size": size, "pixels": pixels, "mounts": mounts, "center": center, "yaw": yaw}


# Each shape is mounted flush in several surfaces; the first mount is the one cameras aim at.
# yaw: rotation about Z; yaw 0 means the screen faces -Y (toward the camera side of the concourse).
SCREENS = {
    "pillar": {**screen_spec((COLUMN_LED_PERIMETER, COLUMN_LED_TOP_Z - COLUMN_LED_BOTTOM_Z), (3308, 2524),
                             [column_front(*COLUMNS[0], COLUMN_LED_MID_Z)]),
               "mounts": [], "wraps": COLUMNS},
    "9x16": screen_spec(BACK_WALL_9X16, (1080, 1920), back_wall_mounts()),
    "32x9": screen_spec(RIBBON_SIZE, (3840, 1080),
                        [(Vector((x, HEADWALL_FRONT_Y, RIBBON_Z)), 0.0) for x in ribbon_xs()]),
}
BACK_WALL_SHAPES = ("9x16",)

SHOT_ORDER = ["pillar", "9x16", "32x9"]
CAMERA_WAYPOINTS = [
    Vector((-5.5, -3.5, EYE_Z)),
    Vector((-0.5, 3.5, EYE_Z + 0.1)),
    Vector((0.8, -2.0, EYE_Z - 0.1)),
    Vector((2.2, -4.0, EYE_Z)),
]


def in_front_of(shape, distance, angle_deg, height):
    spec = SCREENS[shape]
    offset = Matrix.Rotation(math.radians(angle_deg), 3, "Z") @ facing(spec["yaw"]) * distance
    return Vector((spec["center"].x + offset.x, spec["center"].y + offset.y, height))


# The wide shot looks straight down the concourse axis: ribbon, four columns and the back wall, symmetric.
HERO_LOCATION = Vector((0.0, -8.6, EYE_Z))
HERO_TARGET = Vector((0.0, BACK_WALL_Y, 2.3))
HERO_LENS_MM = 28.0


CLOSE_LENS_MM = 35.0
# The white world looks up a little from the concourse axis.
CLAY_LENS_MM = 28.0
CLAY_EYE_Z = 0.95
CLAY_TARGET = Vector((0.0, BACK_WALL_Y, 2.6))


def along_axis(y):
    return Vector((HERO_LOCATION.x, y, HERO_LOCATION.z)), HERO_TARGET


# Near cameras sit at a horizontal distance from the screen, rotated off its normal so the
# concourse behind falls out of focus at f/2.8.
STILL_CAMERAS = {
    "hero": {"location": HERO_LOCATION, "target": HERO_TARGET, "focus": "pillar", "lens": HERO_LENS_MM},
    "near-column": {"location": in_front_of("pillar", 1.5, -35, EYE_Z), "focus": "pillar", "lens": 24.0, "aim_shift": 0.3},
    "near-ribbon": {"location": in_front_of("32x9", 3.5, -25, EYE_Z), "focus": "32x9", "lens": 24.0, "aim_shift": 0.0},
    # The sim's hero2 (sim/src/main.ts), from its Y-up glTF axes back to Blender's: (x, -z, y).
    "hero2": {"location": Vector((3.32, -8.33, 1.24)), "target": Vector((-0.91, 8.69, 2.81)), "lens": 28.0},
}


# Storyboard 3D cuts: camera path as (location, target) keys spread evenly over the cut,
# which screen recording to show, and a light multiplier (night = everything dimmed).
RIBBON_FACE = Vector((RIBBON_CENTER_X, HEADWALL_FRONT_Y, RIBBON_Z))
WALL_FACE_Y = BACK_WALL_Y


def oblique(target, distance, angle_deg, height, lens, aim_offset=(0.0, 0.0, 0.0)):
    """Camera on a surface facing -Y, swung angle_deg toward +X (the concourse centre for the left column);
    aim_offset pans the view without moving the camera."""
    angle = math.radians(angle_deg)
    location = Vector((target.x + math.sin(angle) * distance, target.y - math.cos(angle) * distance, height))
    return {"location": location, "target": target + Vector(aim_offset), "lens": lens}


CLOSEUP_TARGETS = {
    "col": Vector((COLUMNS[0][0], COLUMNS[0][1], COLUMN_LED_MID_Z)),
    "rib": RIBBON_FACE,
    "wall": Vector((0.0, WALL_FACE_Y, BACK_WALL_SCREEN_Z)),
}
# (target, angle, height, lens, distance): each keeps the whole screen in frame with some room around it.
CLOSEUP_OPTIONS = {
    "col-30-eye-35": ("col", 30, EYE_Z, 35.0, 9.0),
    "col-45-eye-35": ("col", 45, EYE_Z, 35.0, 9.0),
    "col-30-low-35": ("col", 30, 0.8, 35.0, 9.0),
    "col-45-high-35": ("col", 45, 3.0, 35.0, 9.0),
    "col-35-eye-50": ("col", 35, EYE_Z, 50.0, 11.5),
    "rib-30-eye-35": ("rib", 30, EYE_Z, 35.0, 11.5),
    "rib-30-mid-35": ("rib", 30, 3.0, 35.0, 11.5),
    "rib-15-eye-35": ("rib", 15, EYE_Z, 35.0, 11.5),
    "rib-m30-mid-35": ("rib", -30, 2.4, 35.0, 11.5),
    "rib-30-eye-50": ("rib", 30, 2.0, 50.0, 15.0),
    "wall-30-eye-35": ("wall", 30, EYE_Z, 35.0, 6.5),
    "wall-45-eye-35": ("wall", 45, EYE_Z, 35.0, 6.5),
    "wall-30-low-35": ("wall", 30, 0.9, 35.0, 6.5),
    "wall-30-eye-50": ("wall", 30, EYE_Z, 50.0, 9.0),
    "wall-20-high-50": ("wall", 20, 2.6, 50.0, 9.0),
    # Chosen for cut 8: the low column view panned to between the two left columns, the left-side ribbon view
    # brought closer, and the 45-degree wall view panned right to trim the empty wall on the left.
    "col-final": ("col", 30, 0.8, 35.0, 9.0, (0.0, 2.5, 0.0)),
    # Cut 0: straight on to the column's front face, the whole LED band just inside the frame height; at 50 mm
    # the shelter line reads at about 25 px in 1080p (the 35 mm framing from 5.6 m did not).
    "col-front-50": ("col", 0, COLUMN_LED_MID_Z, 50.0, 8.6),
    "rib-final": ("rib", -30, 2.4, 35.0, 8.5),
    "wall-final": ("wall", 45, EYE_Z, 35.0, 6.5, (1.2, 0.0, 0.0)),
}
# Mesh objects that make up each close-up's screen (a column's LED band is four strips).
CLOSEUP_OBJECTS = {"col": [f"led_wrap_0_{face}" for face in range(4)], "rib": ["screen_32x9_0"], "wall": ["screen_9x16_1"]}
STILL_CAMERAS.update({name: oblique(CLOSEUP_TARGETS[t], d, a, h, lens, *rest)
                      for name, (t, a, h, lens, d, *rest) in CLOSEUP_OPTIONS.items()})
CLOSE_PUSH_M = 0.6
# Cut 8d: back from the column view and turned right, so column, ribbon and back wall share one frame.
WIDE_OPTIONS = {
    "wide-a": {"location": Vector((-0.5, -7.4, 0.9)), "target": Vector((-2.6, 5.0, 2.4)), "lens": 35.0},
    "wide-b": {"location": Vector((0.0, -8.4, 1.1)), "target": Vector((-1.6, 5.5, 2.4)), "lens": 35.0},
    "wide-c": {"location": Vector((0.0, -8.4, 1.2)), "target": Vector((-0.6, 6.0, 2.6)), "lens": 28.0},
}
STILL_CAMERAS.update(WIDE_OPTIONS)
KV_RAISE_M = 0.4
STILL_CAMERAS.update({
    "wide-a-high": {**WIDE_OPTIONS["wide-a"], "location": WIDE_OPTIONS["wide-a"]["location"] + Vector((0.0, 0.0, KV_RAISE_M))},
    "wide-a-28": {**WIDE_OPTIONS["wide-a"], "lens": 28.0},
})


def push_from(name, metres=CLOSE_PUSH_M):
    """The chosen still, then metres closer along the view, for a slow push-in."""
    spec = STILL_CAMERAS[name]
    step = (spec["target"] - spec["location"]).normalized() * metres
    return [(spec["location"], spec["target"]), (spec["location"] + step, spec["target"] + step)]


def pan_right_from(name, metres):
    """The chosen still with the aim sliding metres to the right at the target: a slow pan."""
    spec = STILL_CAMERAS[name]
    view = spec["target"] - spec["location"]
    right = Vector((view.y, -view.x, 0.0)).normalized() * metres
    return [(spec["location"], spec["target"]), (spec["location"], spec["target"] + right)]



# Cut 2's dolly line: 田中 (v9) wanted it closer than the first -8.6 m, same direction and length.
CUT02_DOLLY_Y = -6.0

SHOTS = {
    "cut01": {
        "seconds": 10, "screens": "off", "light_scale": 1.0, "lens": CLAY_LENS_MM, "focus": "pillar", "clay": True,
        "path": [(Vector((0.0, y, CLAY_EYE_Z)), CLAY_TARGET) for y in (-8.4, -6.8)],
    },
    "cut02": {
        "seconds": 16, "screens": "ambient-real", "light_scale": 1.0, "lens": HERO_LENS_MM, "focus": "32x9",
        "path": [(Vector((-0.7, CUT02_DOLLY_Y, EYE_Z)), Vector((-0.7, BACK_WALL_Y, 2.3))),
                 (Vector((0.7, CUT02_DOLLY_Y, EYE_Z)), Vector((0.7, BACK_WALL_Y, 2.3)))],
    },
    # Cut 0: the switch seen on one column face from a step further back (45 mm, v9), on a real-time clock: 15:54:55 at 0 s, the 0.3 s of black
    # at 5.0 s and the level-3 screen scaling in at 5.3 s.
    "cut00": {
        "seconds": 13, "screens": "switch-real", "light_scale": 1.0, "lens": 45.0,
        "path": push_from("col-front-50", 0.3), "focus_point": CLOSEUP_TARGETS["col"],
    },
    "cut05": {
        "seconds": 21, "screens": "switch", "light_scale": 1.0, "lens": WIDE_OPTIONS["wide-a"]["lens"],
        "path": push_from("wide-a", 0.4),
    },
    # Cut 8: one camera move column -> ribbon -> back wall, holding on each screen and easing between them; the
    # screens change bulletin as each move starts (demo/capture/cut08_sequence.sh).
    "cut08": {
        "seconds": 15, "screens": "cut08-seq", "light_scale": 1.0, "lens": CLOSE_LENS_MM, "focus_follows": True,
        "path": [held for name in ("col-final", "rib-final", "wall-final") for held in [(STILL_CAMERAS[name]["location"], STILL_CAMERAS[name]["target"])] * 2],
        "path_s": [0.0, 11 / 3, 17 / 3, 28 / 3, 34 / 3, 15.0],
    },
    "cut09": {
        "seconds": 10, "screens": "alert-real", "light_scale": 1.0, "lens": HERO_LENS_MM, "focus": "pillar",
        "path": [along_axis(-8.6), along_axis(-7.9)],
    },
}

CLAY_ALBEDO = 0.85
# Screens a shade darker than the room, so the silent panels still read in the white world.
CLAY_SCREEN_ALBEDO = 0.55
CLAY_WORLD = 1.15
CLAY_CYCLES_SAMPLES = 48
CLAY_AO_DISTANCE_M = 4.0


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=str(DEMO_DIR / "renders" / "test.mp4"))
    parser.add_argument("--seconds", type=float, default=10.0)
    parser.add_argument("--res", default="1920x1080")
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--samples", type=int, default=32)
    parser.add_argument("--look", choices=sorted(LOOKS), default="base")
    parser.add_argument("--cut", choices=CUTS,
                        help="read demo/screens/<shape>_<cut>.mp4; off = black screens, test = <shape>.mp4|png")
    parser.add_argument("--shot", choices=sorted(SHOTS), help="storyboard 3D cut; sets seconds, screens, lights, camera")
    parser.add_argument("--frame", type=int, default=1, help="frame rendered by --still")
    parser.add_argument("--still", help="render one frame from --cam to this PNG")
    parser.add_argument("--cam", choices=sorted(STILL_CAMERAS), default="hero")
    parser.add_argument("--stills-dir", default=str(DEMO_DIR / "renders" / "stills"))
    parser.add_argument("--cams", help="comma-separated still cameras, each rendered to --stills-dir/<layout>_<cam>.png")
    parser.add_argument("--verify-colors", action="store_true",
                        help="after --still, compare flat screen areas in the render with the recording's frame")
    parser.add_argument("--clay-screen-albedo", type=float, default=CLAY_SCREEN_ALBEDO,
                        help="screen surfaces in the clay shot (CLAY_ALBEDO makes them vanish into the room)")
    parser.add_argument("--room-light", type=float, default=1.0, help="extra factor on the room lighting (screens unaffected)")
    parser.add_argument("--canvas-dir", help="per-window stills from demo/capture/canvas_stills.mjs")
    parser.add_argument("--crops-json", help="write each screen's window on the elevation canvas to this file and exit")
    parser.add_argument("--save-blend", action="store_true")
    args = parser.parse_args(argv)
    args.width, args.height = (int(v) for v in args.res.lower().split("x"))
    return args


def screen_source(shape, cut):
    if cut == "off":
        return make_black(shape)
    if cut and cut != "test":
        candidate = SCREENS_DIR / f"{shape}_{cut}.mp4"
        if not candidate.exists():
            raise FileNotFoundError(f"--cut {cut} needs {candidate}")
        return candidate
    for ext in ("mp4", "png"):
        candidate = SCREENS_DIR / f"{shape}.{ext}"
        if candidate.exists():
            return candidate
    return make_placeholder(shape)


def make_black(shape):
    SCREENS_DIR.mkdir(parents=True, exist_ok=True)
    out = SCREENS_DIR / f"{shape}_off.png"
    width, height = SCREENS[shape]["pixels"]
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"color=c=black:s={width}x{height}",
                    "-frames:v", "1", str(out)], check=True)
    return out


def make_placeholder(shape):
    SCREENS_DIR.mkdir(parents=True, exist_ok=True)
    out = SCREENS_DIR / f"{shape}.png"
    width, height = SCREENS[shape]["pixels"]
    font = f"fontfile='{PLACEHOLDER_FONT}':" if PLACEHOLDER_FONT.exists() else ""
    vf = (
        "drawbox=x=0:y=0:w=iw:h=ih:color=0x9a9aa0:t=24,"
        f"drawtext={font}text='{shape.replace('x', ' x ')}':fontcolor=white:fontsize={min(width, height) // 4}"
        ":x=(w-text_w)/2:y=(h-text_h)/2"
    )
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"color=c=0x3c3c46:s={width}x{height}",
         "-frames:v", "1", "-vf", vf, str(out)],
        check=True,
    )
    return out


def screen_material(shape, source, frame_count, offset_frames=0):
    """Emission only: the screen shows its recording and takes no light or reflection from the room."""
    mat = bpy.data.materials.new(f"screen_{shape}")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(str(source))
    tex.extension = "CLIP"
    if source.suffix == ".mp4":
        tex.image.source = "MOVIE"
        user = tex.image_user
        user.frame_start = 1
        user.frame_offset = offset_frames
        user.frame_duration = min(tex.image.frame_duration, frame_count) or frame_count
        user.use_cyclic = True
        user.use_auto_refresh = True
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = SCREEN_EMISSION
    output = nodes.new("ShaderNodeOutputMaterial")
    links.new(tex.outputs["Color"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return mat


def window_recording(name, cut):
    """record.mjs --window <name> --cut <cut>: that window's part of the room-wide screen."""
    if not cut or cut in ("off", "test"):
        return None
    candidate = SCREENS_DIR / f"{name}_{cut}.mp4"
    return candidate if candidate.exists() else None


def build_screens(frame_count, cut, canvas_dir=None, offset_frames=0):
    """canvas_dir: one still per window (<shape>_<i>.png, pillar_<i>.png) cut from a single room canvas.
    Window recordings (<shape>_<i>_<cut>.mp4) take the place of the shape's recording on their surface."""
    joint = principled("joint", (0.004, 0.004, 0.004), 0.5)
    sources = {}

    def window_material(name, shared):
        if canvas_dir:
            return screen_material(name, Path(canvas_dir) / f"{name}.png", frame_count)
        recording = window_recording(name, cut)
        return screen_material(name, recording, frame_count, offset_frames) if recording else shared()

    for shape, spec in SCREENS.items():
        width, height = spec["size"]
        windows = [f"{shape}_{i}" for i in range(len(spec["mounts"]) or len(spec.get("wraps", [])))]
        if all(window_recording(name, cut) for name in windows):
            sources[shape] = window_recording(windows[0], cut)
            shared = None
        else:
            sources[shape] = screen_source(shape, cut)
            built = screen_material(shape, sources[shape], frame_count, offset_frames)
            shared = lambda built=built: built
        if canvas_dir and spec["mounts"]:
            sources[shape] = Path(canvas_dir) / f"{shape}_0.png"
        for i, (surface, yaw) in enumerate(spec["mounts"]):
            material = window_material(f"{shape}_{i}", shared)
            normal = facing(yaw)
            vertical_plane(f"joint_{shape}_{i}", surface + normal * (FLUSH_EPS_M / 2),
                           width + 2 * JOINT_M, height + 2 * JOINT_M, yaw, joint)
            vertical_plane(f"screen_{shape}_{i}", surface + normal * FLUSH_EPS_M, width, height, yaw, material)
        for i, (x, y) in enumerate(spec.get("wraps", [])):
            build_led_wrap(f"led_wrap_{i}", (x, y), COLUMN_CLAD_HALF + FLUSH_EPS_M, COLUMN_LED_RADIUS,
                           COLUMN_LED_BOTTOM_Z, COLUMN_LED_TOP_Z, window_material(f"pillar_{i}", shared))
    build_screen_housings()
    return sources


def build_screen_housings():
    cladding = principled("column_cladding", (0.035, 0.035, 0.038), 0.32, metallic=0.7)
    side = 2 * COLUMN_CLAD_HALF
    for i, (x, y) in enumerate(COLUMNS):
        for part, (z0, z1) in enumerate([(0.0, COLUMN_LED_BOTTOM_Z), (COLUMN_LED_TOP_Z, COLUMN_CLAD_TOP_Z)]):
            box(f"column_cladding_{i}_{part}", (x, y, (z0 + z1) / 2), (side, side, z1 - z0), cladding)
    headwall = principled("headwall", (0.09, 0.09, 0.095), 0.55)
    height = CEILING_Z - HEADWALL_BOTTOM_Z
    width = RIGHT_WALL_X - LEFT_WALL_X
    box("headwall", ((LEFT_WALL_X + RIGHT_WALL_X) / 2, HEADWALL_Y, HEADWALL_BOTTOM_Z + height / 2),
        (width, HEADWALL_DEPTH, height), headwall)


def build_world(strength):
    world = bpy.data.worlds.new("world")
    bpy.context.scene.world = world
    nodes, links = world.node_tree.nodes, world.node_tree.links
    nodes.clear()
    env = nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(str(HDRI_PATH))
    background = nodes.new("ShaderNodeBackground")
    background.inputs["Strength"].default_value = strength
    output = nodes.new("ShaderNodeOutputWorld")
    links.new(env.outputs["Color"], background.inputs["Color"])
    links.new(background.outputs["Background"], output.inputs["Surface"])


def add_camera(location, target_location, lens=LENS_MM):
    bpy.ops.object.empty_add(location=target_location)
    target = bpy.context.active_object
    target.name = "camera_target"
    bpy.ops.object.camera_add(location=location)
    camera = bpy.context.active_object
    camera.name = "camera"
    camera.data.lens = lens
    camera.data.dof.use_dof = True
    camera.data.dof.aperture_fstop = F_STOP
    constraint = camera.constraints.new("TRACK_TO")
    constraint.target = target
    constraint.track_axis = "TRACK_NEGATIVE_Z"
    constraint.up_axis = "UP_Y"
    bpy.context.scene.camera = camera
    return camera, target


def build_dolly(frame_count):
    camera, target = add_camera(CAMERA_WAYPOINTS[0], SCREENS[SHOT_ORDER[0]]["center"])
    camera.data.dof.focus_object = target
    key_frames = shot_frames(frame_count)
    for frame, shape, position in zip(key_frames, SHOT_ORDER, CAMERA_WAYPOINTS):
        camera.location = position
        camera.keyframe_insert("location", frame=frame)
        target.location = SCREENS[shape]["center"]
        target.keyframe_insert("location", frame=frame)
    return key_frames


def build_shot_camera(shot, frame_count):
    location, target_location = shot["path"][0]
    camera, target = add_camera(location, target_location, shot["lens"])
    if shot.get("focus_follows"):
        camera.data.dof.focus_object = target
    else:
        focus = shot.get("focus_point") or (SCREENS[shot["focus"]]["center"] if "focus" in shot else shot["path"][0][1])
        bpy.ops.object.empty_add(location=focus)
        camera.data.dof.focus_object = bpy.context.active_object
    last = len(shot["path"]) - 1
    times = shot.get("path_s")
    for i, (location, target_location) in enumerate(shot["path"]):
        frame = 1 + round((times[i] / shot["seconds"] if times else i / last) * (frame_count - 1))
        camera.location = location
        camera.keyframe_insert("location", frame=frame)
        target.location = target_location
        target.keyframe_insert("location", frame=frame)
    return [1, (frame_count + 1) // 2, frame_count]


def clay_material(name, albedo):
    mat = principled(name, (albedo,) * 3, 1.0)
    mat.node_tree.nodes["Principled BSDF"].inputs["Specular IOR Level"].default_value = 0.0
    return mat


def make_clay(screen_albedo):
    """White diffuse everywhere, lit only by a uniform white world, so the room reads as form and occlusion."""
    clay = clay_material("clay", CLAY_ALBEDO)
    screen = clay_material("clay_screen", screen_albedo)
    for obj in list(bpy.data.objects):
        if obj.type == "LIGHT":
            bpy.data.objects.remove(obj)
        elif obj.type == "MESH":
            obj.data.materials.clear()
            obj.data.materials.append(screen if obj.name.startswith(("screen_", "led_wrap_")) else clay)
    world = bpy.context.scene.world
    world.node_tree.nodes.clear()
    background = world.node_tree.nodes.new("ShaderNodeBackground")
    background.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    background.inputs["Strength"].default_value = CLAY_WORLD
    output = world.node_tree.nodes.new("ShaderNodeOutputWorld")
    world.node_tree.links.new(background.outputs["Background"], output.inputs["Surface"])


def scale_lights(scale):
    for obj in bpy.data.objects:
        if obj.type == "LIGHT":
            obj.data.energy *= scale
    for mat in bpy.data.materials:
        if mat.name.startswith("screen_") or not mat.node_tree:
            continue
        for node in mat.node_tree.nodes:
            if node.type == "EMISSION":
                node.inputs["Strength"].default_value *= scale


def build_still_camera(name):
    spec = STILL_CAMERAS[name]
    if "focus" in spec:
        screen = SCREENS[spec["focus"]]
        focus_point = screen["center"]
        tangent = Matrix.Rotation(screen["yaw"], 3, "Z") @ Vector((1.0, 0.0, 0.0))
        target = spec.get("target", focus_point + tangent * spec.get("aim_shift", 0.0))
    else:
        focus_point = target = spec["target"]
    camera, _ = add_camera(spec["location"], target, spec["lens"])
    camera.data.dof.focus_distance = (focus_point - spec["location"]).length
    return camera


COLUMN_FACES = 4


def whole_pixels_per_face(width):
    return width - width % COLUMN_FACES


def column_seam_hidden_from_hero(x):
    return "right" if x > 0 else "left"


COLUMN_FACE_NAMES = ("front", "right", "back", "left")


def column_face_crops(left, top, width, height, seam):
    """Each face's own window on the strip: the picture advances one face width per face round the column,
    and a seam on the front-right edge puts the strip's last quarter on the front (AmbientLayer draws the same)."""
    face_width = width // COLUMN_FACES
    first_quarter = COLUMN_FACES - 1 if seam == "right" else 0
    return {name: [left + ((k + first_quarter) % COLUMN_FACES) * face_width, top, face_width, height]
            for k, name in enumerate(COLUMN_FACE_NAMES)}


def lower_band_crops(columns, portraits, canvas, band_top):
    """The columns and the portrait screens side by side under the ribbons with equal gaps, each centred in the
    band: two columns share an elevation x (one behind the other), so their windows cannot come from the
    elevation, and the band has room for all seven only in one row. The front columns come first and the back
    ones last, the portrait screens between them, so a column and the one behind it show far-apart parts of
    the picture."""
    width, height = canvas
    front_y = min(item[2] for item in columns)
    front = sorted((item for item in columns if item[2] == front_y), key=lambda item: item[1])
    back = sorted((item for item in columns if item[2] != front_y), key=lambda item: item[1])
    items = front + sorted(portraits, key=lambda item: item[1]) + back
    gap = (width - sum(item[3] for item in items)) / (len(items) + 1)
    if gap < 0:
        raise SystemExit("CROPS: the columns and portrait screens do not fit side by side on the canvas")
    boxes = {}
    x = gap
    for name, _, _, w, h in items:
        boxes[name] = (round(x), band_top + (height - band_top - h) // 2, w, h)
        x += w + gap
    return boxes


def canvas_crops():
    """Each screen's window on the elevation canvas; a column's LED band is its four faces laid side by side.
    The ribbons keep their elevation windows; the columns and portrait screens share the band below them."""
    crops = {}
    shapes = {}
    seam = {}
    faces = {}
    canvas = elevation_canvas()
    width, height = SCREENS["32x9"]["size"]
    ribbon_bottom = 0
    for i, (center, _) in enumerate(SCREENS["32x9"]["mounts"]):
        crops[f"32x9_{i}"] = elevation_crop(center.x, center.z, width, height)
        shapes[f"32x9_{i}"] = "32x9"
        ribbon_bottom = max(ribbon_bottom, crops[f"32x9_{i}"][1] + crops[f"32x9_{i}"][3])
    columns = []
    for i, (x, y) in enumerate(COLUMNS):
        left, _, strip, band = elevation_crop(x, COLUMN_LED_MID_Z, COLUMN_LED_PERIMETER, COLUMN_LED_TOP_Z - COLUMN_LED_BOTTOM_Z)
        columns.append((f"pillar_{i}", x, y, whole_pixels_per_face(strip), band))
        shapes[f"pillar_{i}"] = "pillar"
        seam[f"pillar_{i}"] = column_seam_hidden_from_hero(x)
    w9, h9 = SCREENS["9x16"]["size"]
    portraits = [(f"9x16_{i}", center.x, 0.0, *elevation_crop(center.x, center.z, w9, h9)[2:]) for i, (center, _) in enumerate(SCREENS["9x16"]["mounts"])]
    for name, *_ in portraits:
        shapes[name] = "9x16"
    crops.update(lower_band_crops(columns, portraits, canvas, ribbon_bottom))
    for name, *_ in columns:
        faces[name] = column_face_crops(*crops[name], seam[name])
    return {"canvas": list(canvas), "crops": {name: list(box) for name, box in crops.items()}, "shapes": shapes, "seam": seam,
            "faces": faces}


def framing_report(name, key=None):
    """Share of a screen's surface (key: col, rib or wall) inside the frame and not hidden, sampled per face."""
    from bpy_extras.object_utils import world_to_camera_view
    scene = bpy.context.scene
    camera = scene.camera
    depsgraph = bpy.context.evaluated_depsgraph_get()
    origin = camera.matrix_world.translation
    facing_points = inside = 0
    for obj_name in CLOSEUP_OBJECTS[key or name.split("-")[0]]:
        obj = bpy.data.objects[obj_name]
        for poly in obj.data.polygons:
            center = obj.matrix_world @ poly.center
            if (obj.matrix_world.to_3x3() @ poly.normal).dot(origin - center) <= 0:
                continue
            corners = [obj.matrix_world @ obj.data.vertices[i].co for i in poly.vertices]
            for point in [center] + [center + (corner - center) * 0.96 for corner in corners]:
                facing_points += 1
                ndc = world_to_camera_view(scene, camera, point)
                ray = point - origin
                hit, _, _, _, hit_obj, _ = scene.ray_cast(depsgraph, origin, ray.normalized(), distance=ray.length + 0.01)
                if 0 <= ndc.x <= 1 and 0 <= ndc.y <= 1 and ndc.z > 0 and hit and hit_obj.name == obj_name:
                    inside += 1
    print(f"FRAMING {name}{' ' + key if key else ''} visible={inside}/{facing_points}")


def verify_screen_colors(png, frame, sources):
    flat = {shape: SCREENS[shape] for shape in ("9x16", "32x9")}
    report_screen_colors(png, frame, sources, flat, FLUSH_EPS_M, CACHE_DIR)


def shot_frames(frame_count):
    last = len(SHOT_ORDER) - 1
    return [1 + round(i * (frame_count - 1) / last) for i in range(len(SHOT_ORDER))]


def use_cycles():
    """Path-traced occlusion for the clay shot. The room is a closed box, so world light cannot reach inside;
    Fast GI's ambient occlusion counts any direction clear for CLAY_AO_DISTANCE_M as lit by the white world."""
    scene = bpy.context.scene
    scene.cycles.use_fast_gi = True
    scene.cycles.fast_gi_method = "REPLACE"
    scene.cycles.ao_bounces_render = 1
    scene.world.light_settings.ao_factor = 1.0
    scene.world.light_settings.distance = CLAY_AO_DISTANCE_M
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for device in prefs.devices:
        device.use = True
    scene.cycles.device = "GPU"
    scene.cycles.samples = CLAY_CYCLES_SAMPLES
    scene.cycles.use_denoising = True
    scene.render.use_persistent_data = True


def configure_render(args, frame_count, frames_dir):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = args.samples
    scene.eevee.shadow_pool_size = SHADOW_POOL_LARGE_MB if args.width > 1920 else SHADOW_POOL_MB
    if hasattr(scene.eevee, "use_raytracing"):
        scene.eevee.use_raytracing = True
    scene.render.resolution_x, scene.render.resolution_y = args.width, args.height
    scene.render.resolution_percentage = 100
    scene.render.fps = args.fps
    scene.frame_start, scene.frame_end = 1, frame_count
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(frames_dir / "####")


def encode_mp4(frames_dir, fps, out_path):
    out_path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps), "-i", str(frames_dir / "%04d.png"),
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-an", str(out_path)],
        check=True,
    )


def export_stills(frames_dir, key_frames, stills_dir, names):
    stills_dir.mkdir(parents=True, exist_ok=True)
    for frame, name in zip(key_frames, names):
        shutil.copyfile(frames_dir / f"{frame:04d}.png", stills_dir / f"{name}.png")


def render_still(path, frame):
    scene = bpy.context.scene
    scene.frame_set(frame)
    scene.render.filepath = str(path)
    started = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    return time.perf_counter() - started


def main():
    args = parse_args()
    if args.crops_json:
        Path(args.crops_json).write_text(json.dumps(canvas_crops(), indent=2) + "\n")
        print(f"CROPS {args.crops_json}")
        return
    shot = SHOTS.get(args.shot)
    seconds = shot["seconds"] if shot else args.seconds
    frame_count = max(2, round(seconds * args.fps))
    cut = args.cut or (shot["screens"] if shot else None)
    light_scale = (shot["light_scale"] if shot else 1.0) * ROOM_LIGHT_SCALE * args.room_light
    # One frames folder per shot: renders run side by side, and each clears its own folder first.
    frames_dir = CACHE_DIR / "frames" / (args.shot or "default")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    back_wall_clear = [(center.x - SCREENS[shape]["size"][0] / 2 - JOINT_M, center.x + SCREENS[shape]["size"][0] / 2 + JOINT_M)
                       for shape in BACK_WALL_SHAPES for center, _ in SCREENS[shape]["mounts"]]
    look = build_look(args.look, back_wall_clear)
    sources = build_screens(frame_count, cut, args.canvas_dir, round((shot.get("screens_from_s", 0.0) if shot else 0.0) * args.fps))
    build_world(look["hdri_strength"] * light_scale)
    scale_lights(light_scale)
    if shot and shot.get("clay"):
        make_clay(args.clay_screen_albedo)
    if shot:
        key_frames = build_shot_camera(shot, frame_count)
        still_names = [f"{args.shot}_{frame:04d}" for frame in key_frames]
    elif args.still or args.cams:
        build_still_camera(args.cam)
    else:
        key_frames = build_dolly(frame_count)
        still_names = [f"shot_{shape}" for shape in SHOT_ORDER]
    configure_render(args, frame_count, frames_dir)
    if shot and shot.get("clay"):
        use_cycles()

    if args.save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=str(CACHE_DIR / f"scene_{args.look}.blend"))

    for shape, source in sources.items():
        width, height = SCREENS[shape]["size"]
        print(f"SCREEN {shape} {width:.3f}m x {height:.3f}m source={source.name}")

    if args.cams:
        stills_dir = Path(args.stills_dir).resolve()
        for name in args.cams.split(","):
            build_still_camera(name)
            if name in CLOSEUP_OPTIONS:
                framing_report(name)
            if name in WIDE_OPTIONS:
                for key in CLOSEUP_OBJECTS:
                    framing_report(name, key)
            elapsed = render_still(stills_dir / f"{name}.png", args.frame)
            print(f"RENDER_STATS still look={args.look} cam={name} total_s={elapsed:.1f}")
        return

    if args.still:
        elapsed = render_still(Path(args.still).resolve(), args.frame)
        print(f"RENDER_STATS still look={args.look} shot={args.shot} cam={args.cam} frame={args.frame} res={args.width}x{args.height} "
              f"samples={args.samples} total_s={elapsed:.1f}")
        if args.verify_colors:
            verify_screen_colors(Path(args.still).resolve(), args.frame, sources)
        return

    if frames_dir.exists():
        shutil.rmtree(frames_dir)
    frames_dir.mkdir(parents=True)
    started = time.perf_counter()
    bpy.ops.render.render(animation=True)
    elapsed = time.perf_counter() - started
    encode_mp4(frames_dir, args.fps, Path(args.out).resolve())
    export_stills(frames_dir, key_frames, Path(args.stills_dir).resolve(), still_names)
    print(f"RENDER_STATS look={args.look} shot={args.shot} frames={frame_count} res={args.width}x{args.height} "
          f"samples={args.samples} total_s={elapsed:.1f} per_frame_s={elapsed / frame_count:.2f}")


main()
