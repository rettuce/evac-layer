"""Station-concourse corner with four embedded signage screens, rendered headless with Eevee.

blender -b -P demo/blender/build_scene.py -- --out demo/renders/test.mp4 --seconds 5 --res 1280x720
blender -b -P demo/blender/build_scene.py -- --look A --still demo/renders/look_A.png
blender -b -P demo/blender/build_scene.py -- --look C --cams hero,opt-axis --stills-dir demo/renders/options
blender -b -P demo/blender/build_scene.py -- --look C --cut switch --seconds 27 --frame 555 --still x.png --verify-colors
"""

import argparse
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
    LAYOUT_NAME, BACK_WALL_Y, CEILING_Z, COLUMN_CLAD_M, COLUMN_CLAD_TOP_Z, COLUMN_SIZE, COLUMNS, EYE_Z, HEADWALL_BOTTOM_Z,
    HEADWALL_DEPTH, HEADWALL_Y, LEFT_WALL_X, PILLAR_CENTER, PILLAR_SIZE, PILLAR_YAW, RIBBON_PANEL_H, RIBBON_PANEL_W,
    RIGHT_WALL_X,
)
from led_wrap import build_led_wrap
from looks import LOOKS, build_look
from primitives import box, principled, spot_light, vertical_plane
from verify_colors import report_screen_colors

DEMO_DIR = Path(__file__).resolve().parent.parent
SCREENS_DIR = DEMO_DIR / "screens"
CACHE_DIR = DEMO_DIR / "cache"
HDRI_PATH = DEMO_DIR / "assets" / "metro_vijzelgracht_1k.hdr"
PLACEHOLDER_FONT = Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")
CUTS = ("ambient", "switch", "alert", "off", "test")

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
NIGHT_LIGHT_COLOR = (0.82, 0.90, 1.0)


def facing(yaw):
    return Vector((math.sin(yaw), -math.cos(yaw), 0.0))


def panel_from_diagonal(diagonal_in, aspect_w, aspect_h):
    unit = diagonal_in * INCH / math.hypot(aspect_w, aspect_h)
    return aspect_w * unit, aspect_h * unit


def pillar_face_center(height_z):
    front = Matrix.Rotation(PILLAR_YAW, 3, "Z") @ Vector((0.0, -PILLAR_SIZE[1] / 2, 0.0))
    return Vector((PILLAR_CENTER.x, PILLAR_CENTER.y, height_z)) + front


COLUMN_CLAD_HALF = COLUMN_SIZE / 2 + COLUMN_CLAD_M
COLUMN_LED_BOTTOM_Z = 0.4
COLUMN_LED_TOP_Z = 3.6
COLUMN_LED_RADIUS = 0.03
COLUMN_LED_MID_Z = (COLUMN_LED_BOTTOM_Z + COLUMN_LED_TOP_Z) / 2
COLUMN_LED_PERIMETER = 8 * (COLUMN_SIZE / 2 + COLUMN_CLAD_M - COLUMN_LED_RADIUS) + 2 * math.pi * COLUMN_LED_RADIUS
RIBBON_SIZE = (RIBBON_PANEL_W, RIBBON_PANEL_H)
RIBBON_Z = HEADWALL_BOTTOM_Z + RIBBON_PANEL_H / 2
RIBBON_CENTER_X = 1.0
BACK_WALL_SCREEN_Z = 2.0
BACK_WALL_GAP_M = 0.4
# Four aspect ratios in one row on the back wall (no real wall mixes them; the point is that every shape
# renders the same bulletin), centred so the row fits between the back columns.
BACK_WALL_ROW = ["9x16", "1x1", "16x9", "9x16"]
BACK_WALL_SIZES = {"9x16": panel_from_diagonal(120, 9, 16), "1x1": (1.4, 1.4), "16x9": panel_from_diagonal(100, 16, 9)}


def back_wall_mounts(shape):
    widths = [BACK_WALL_SIZES[s][0] for s in BACK_WALL_ROW]
    x = -(sum(widths) + BACK_WALL_GAP_M * (len(widths) - 1)) / 2
    mounts = []
    for name, width in zip(BACK_WALL_ROW, widths):
        if name == shape:
            mounts.append((Vector((x + width / 2, BACK_WALL_Y, BACK_WALL_SCREEN_Z)), 0.0))
        x += width + BACK_WALL_GAP_M
    return mounts
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
    "16x9": screen_spec(BACK_WALL_SIZES["16x9"], (1920, 1080), back_wall_mounts("16x9")),
    "9x16": screen_spec(BACK_WALL_SIZES["9x16"], (1080, 1920), back_wall_mounts("9x16")),
    "32x9": screen_spec(RIBBON_SIZE, (3840, 1080),
                        [(Vector((x, HEADWALL_FRONT_Y, RIBBON_Z)), 0.0) for x in ribbon_xs()]),
    "1x1": screen_spec(BACK_WALL_SIZES["1x1"], (1080, 1080), back_wall_mounts("1x1")),
}
BACK_WALL_SHAPES = ("9x16", "1x1", "16x9")

SHOT_ORDER = ["pillar", "16x9", "32x9", "1x1"]
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


# Near cameras sit at a horizontal distance from the screen, rotated off its normal so the
# concourse behind falls out of focus at f/2.8.
STILL_CAMERAS = {
    "hero": {"location": Vector((-1.5, -7.5, EYE_Z)), "target": Vector((-2.6, 4.0, 2.4)), "focus": "pillar", "lens": 35.0},
    "near-column": {"location": in_front_of("pillar", 1.5, -35, EYE_Z), "focus": "pillar", "lens": 24.0, "aim_shift": 0.3},
    "near-wall": {"location": in_front_of("16x9", 2.0, 30, EYE_Z), "focus": "16x9", "lens": 28.0, "aim_shift": -0.3},
    "near-ribbon": {"location": in_front_of("32x9", 3.5, -25, EYE_Z), "focus": "32x9", "lens": 24.0, "aim_shift": 0.0},
    "near-pillar": {"location": in_front_of("1x1", 1.5, 30, EYE_Z), "focus": "1x1", "lens": 28.0, "aim_shift": -0.3},
    "opt-axis": {"location": Vector((0.0, -8.6, EYE_Z)), "target": Vector((0.0, BACK_WALL_Y, 2.3)), "lens": 28.0},
    "opt-entrance": {"location": Vector((-9.2, -8.6, 1.7)), "target": Vector((1.0, 5.0, 2.0)), "lens": 24.0},
    "opt-high": {"location": Vector((-7.5, -7.8, 4.4)), "target": Vector((0.5, 4.5, 1.4)), "lens": 24.0},
    "opt-low": {"location": Vector((-6.4, -2.0, 0.55)), "target": Vector((1.5, BACK_WALL_Y - 0.5, 2.6)), "lens": 24.0},
    "opt-wall": {"location": Vector((-0.2, -1.5, 1.8)), "target": Vector((-0.2, BACK_WALL_Y, 2.0)), "lens": 20.0},
}


# Storyboard 3D cuts: camera path as (location, target) keys spread evenly over the cut,
# which screen recording to show, and a light multiplier (night = everything dimmed).
SHOTS = {
    "cut01": {
        "seconds": 10, "screens": "off", "light_scale": 0.03, "lens": 35.0, "focus": "pillar",
        "night_lights": [
            (Vector((-2.8, -2.6, CEILING_Z - 0.2)), Vector((-4.5, 1.0, 1.4)), 600.0),
            (Vector((1.5, 5.2, CEILING_Z - 0.2)), Vector((1.5, 9.0, 1.2)), 320.0),
        ],
        "path": [
            (Vector((-0.8, -8.2, EYE_Z)), Vector((-3.0, 3.5, 2.6))),
            (Vector((-2.4, -4.8, EYE_Z)), Vector((-4.0, 1.5, 2.2))),
        ],
    },
    "cut02": {
        "seconds": 10, "screens": "ambient", "light_scale": 1.0, "lens": 35.0, "focus": "32x9",
        "path": [
            (Vector((-6.2, -5.5, EYE_Z)), Vector((-4.5, 1.0, 2.0))),
            (Vector((0.8, -6.2, EYE_Z)), Vector((0.5, 6.0, 2.8))),
        ],
    },
    "cut05": {
        "seconds": 25, "screens": "switch", "light_scale": 1.0, "lens": 30.0, "focus": "pillar",
        "path": [
            (Vector((-6.0, -7.2, EYE_Z)), Vector((-0.5, 4.5, 2.6))),
            (Vector((-2.5, -7.8, EYE_Z)), Vector((-1.5, 4.5, 2.5))),
            (Vector((1.5, -7.0, EYE_Z)), Vector((-2.5, 4.0, 2.4))),
        ],
    },
    "cut08": {
        "seconds": 18, "screens": "alert", "light_scale": 1.0, "lens": 35.0, "focus": "pillar",
        "path": [
            (Vector((-1.5, -7.5, EYE_Z)), Vector((-2.6, 4.0, 2.4))),
            (Vector((-2.6, -3.0, 1.5)), Vector((-4.3, 1.0, 1.6))),
            (Vector((-3.5, -0.5, 1.0)), Vector((-4.5, 0.97, 0.75))),
        ],
    },
    "cut09": {
        "seconds": 10, "screens": "alert", "light_scale": 1.0, "lens": 35.0, "focus": "pillar",
        "path": [
            (Vector((-1.5, -7.5, EYE_Z)), Vector((-2.6, 4.0, 2.4))),
            (Vector((-1.4, -6.7, EYE_Z)), Vector((-2.6, 4.0, 2.4))),
        ],
    },
}


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


def screen_material(shape, source, frame_count):
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
        user.frame_offset = 0
        user.frame_duration = min(tex.image.frame_duration, frame_count) or frame_count
        user.use_cyclic = True
        user.use_auto_refresh = True
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = SCREEN_EMISSION
    output = nodes.new("ShaderNodeOutputMaterial")
    links.new(tex.outputs["Color"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return mat


def build_screens(frame_count, cut):
    joint = principled("joint", (0.004, 0.004, 0.004), 0.5)
    sources = {}
    for shape, spec in SCREENS.items():
        width, height = spec["size"]
        sources[shape] = screen_source(shape, cut)
        material = screen_material(shape, sources[shape], frame_count)
        for i, (surface, yaw) in enumerate(spec["mounts"]):
            normal = facing(yaw)
            vertical_plane(f"joint_{shape}_{i}", surface + normal * (FLUSH_EPS_M / 2),
                           width + 2 * JOINT_M, height + 2 * JOINT_M, yaw, joint)
            vertical_plane(f"screen_{shape}_{i}", surface + normal * FLUSH_EPS_M, width, height, yaw, material)
        for i, (x, y) in enumerate(spec.get("wraps", [])):
            build_led_wrap(f"led_wrap_{i}", (x, y), COLUMN_CLAD_HALF + FLUSH_EPS_M, COLUMN_LED_RADIUS,
                           COLUMN_LED_BOTTOM_Z, COLUMN_LED_TOP_Z, material)
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
    bpy.ops.object.empty_add(location=SCREENS[shot["focus"]]["center"])
    camera.data.dof.focus_object = bpy.context.active_object
    last = len(shot["path"]) - 1
    for i, (location, target_location) in enumerate(shot["path"]):
        frame = 1 + round(i * (frame_count - 1) / last)
        camera.location = location
        camera.keyframe_insert("location", frame=frame)
        target.location = target_location
        target.keyframe_insert("location", frame=frame)
    return [1, (frame_count + 1) // 2, frame_count]


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


def verify_screen_colors(png, frame, sources):
    flat = {shape: SCREENS[shape] for shape in ("16x9", "9x16", "1x1", "32x9")}
    report_screen_colors(png, frame, sources, flat, FLUSH_EPS_M, CACHE_DIR)


def shot_frames(frame_count):
    last = len(SHOT_ORDER) - 1
    return [1 + round(i * (frame_count - 1) / last) for i in range(len(SHOT_ORDER))]


def configure_render(args, frame_count, frames_dir):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = args.samples
    scene.eevee.shadow_pool_size = SHADOW_POOL_MB
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
    shot = SHOTS.get(args.shot)
    seconds = shot["seconds"] if shot else args.seconds
    frame_count = max(2, round(seconds * args.fps))
    cut = args.cut or (shot["screens"] if shot else None)
    light_scale = (shot["light_scale"] if shot else 1.0) * ROOM_LIGHT_SCALE
    frames_dir = CACHE_DIR / "frames"

    bpy.ops.wm.read_factory_settings(use_empty=True)
    back_wall_clear = [(center.x - SCREENS[shape]["size"][0] / 2 - JOINT_M, center.x + SCREENS[shape]["size"][0] / 2 + JOINT_M)
                       for shape in BACK_WALL_SHAPES for center, _ in SCREENS[shape]["mounts"]]
    look = build_look(args.look, back_wall_clear)
    sources = build_screens(frame_count, cut)
    build_world(look["hdri_strength"] * light_scale)
    scale_lights(light_scale)
    for i, (location, aim, energy) in enumerate(shot.get("night_lights", []) if shot else []):
        light = spot_light(f"night_light_{i}", location, energy, NIGHT_LIGHT_COLOR, 38.0, 0.6)
        light.rotation_euler = (aim - location).to_track_quat("-Z", "Y").to_euler()
    if shot:
        key_frames = build_shot_camera(shot, frame_count)
        still_names = [f"{args.shot}_{frame:04d}" for frame in key_frames]
    elif args.still or args.cams:
        build_still_camera(args.cam)
    else:
        key_frames = build_dolly(frame_count)
        still_names = [f"shot_{shape}" for shape in SHOT_ORDER]
    configure_render(args, frame_count, frames_dir)

    if args.save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=str(CACHE_DIR / f"scene_{args.look}.blend"))

    for shape, source in sources.items():
        width, height = SCREENS[shape]["size"]
        print(f"SCREEN {shape} {width:.3f}m x {height:.3f}m source={source.name}")

    if args.cams:
        stills_dir = Path(args.stills_dir).resolve()
        for name in args.cams.split(","):
            build_still_camera(name)
            elapsed = render_still(stills_dir / f"{LAYOUT_NAME}_{name}.png", args.frame)
            print(f"RENDER_STATS still layout={LAYOUT_NAME} look={args.look} cam={name} total_s={elapsed:.1f}")
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
