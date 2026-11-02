"""Station-concourse corner with four embedded signage screens, rendered headless with Eevee.

blender -b -P demo/blender/build_scene.py -- --out demo/renders/test.mp4 --seconds 5 --res 1280x720
"""

import argparse
import math
import shutil
import subprocess
import sys
import time
from pathlib import Path

import bpy
from mathutils import Vector

DEMO_DIR = Path(__file__).resolve().parent.parent
SCREENS_DIR = DEMO_DIR / "screens"
CACHE_DIR = DEMO_DIR / "cache"
HDRI_PATH = DEMO_DIR / "assets" / "metro_vijzelgracht_1k.hdr"
PLACEHOLDER_FONT = Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")

INCH = 0.0254
CEILING_Z = 5.2
EYE_Z = 1.6
BEZEL_M = 0.02
BEZEL_DEPTH_M = 0.06
SCREEN_EMISSION = 3.0
HDRI_STRENGTH = 0.3
BACK_WALL_Y = 9.0
AREA_LIGHT_W = 90.0


def panel_from_diagonal(diagonal_in, aspect_w, aspect_h):
    diagonal_m = diagonal_in * INCH
    unit = diagonal_m / math.hypot(aspect_w, aspect_h)
    return aspect_w * unit, aspect_h * unit


def panel_from_width(width_m, aspect_w, aspect_h):
    return width_m, width_m * aspect_h / aspect_w


# yaw: rotation about Z; yaw 0 means the screen faces -Y (toward the camera side of the concourse).
SCREENS = {
    "9x16": {
        "label": "column 55in portrait",
        "size": panel_from_diagonal(55, 9, 16),
        "pixels": (1080, 1920),
        "center": Vector((-4.5, 1.05 - BEZEL_DEPTH_M, 1.9)),
        "yaw": 0.0,
    },
    "16x9": {
        "label": "wall 75in landscape",
        "size": panel_from_diagonal(75, 16, 9),
        "pixels": (1920, 1080),
        "center": Vector((1.5, BACK_WALL_Y - BEZEL_DEPTH_M, 2.0)),
        "yaw": 0.0,
    },
    "32x9": {
        "label": "ceiling ribbon 6m",
        "size": panel_from_width(6.0, 32, 9),
        "pixels": (3840, 1080),
        "center": Vector((0.0, 4.5, 3.95)),
        "yaw": 0.0,
    },
    "1x1": {
        "label": "guide pillar square",
        "size": (0.9, 0.9),
        "pixels": (1080, 1080),
        "center": Vector((4.0, -1.25 - BEZEL_DEPTH_M, 1.6)),
        "yaw": -0.3,
    },
}

SHOT_ORDER = ["9x16", "16x9", "32x9", "1x1"]
CAMERA_WAYPOINTS = [
    Vector((-5.5, -3.5, EYE_Z)),
    Vector((-0.5, 3.5, EYE_Z + 0.1)),
    Vector((0.8, -2.0, EYE_Z - 0.1)),
    Vector((2.2, -4.0, EYE_Z)),
]


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=str(DEMO_DIR / "renders" / "test.mp4"))
    parser.add_argument("--seconds", type=float, default=10.0)
    parser.add_argument("--res", default="1920x1080")
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--samples", type=int, default=32)
    parser.add_argument("--stills-dir", default=str(DEMO_DIR / "renders" / "stills"))
    parser.add_argument("--save-blend", action="store_true")
    args = parser.parse_args(argv)
    width, height = (int(v) for v in args.res.lower().split("x"))
    args.width, args.height = width, height
    return args


def screen_source(shape):
    for ext in ("mp4", "png"):
        candidate = SCREENS_DIR / f"{shape}.{ext}"
        if candidate.exists():
            return candidate
    return make_placeholder(shape)


def make_placeholder(shape):
    SCREENS_DIR.mkdir(parents=True, exist_ok=True)
    out = SCREENS_DIR / f"{shape}.png"
    width, height = SCREENS[shape]["pixels"]
    font_size = min(width, height) // 4
    font = f"fontfile='{PLACEHOLDER_FONT}':" if PLACEHOLDER_FONT.exists() else ""
    vf = (
        f"drawbox=x=0:y=0:w=iw:h=ih:color=0x9a9aa0:t=24,"
        f"drawtext={font}text='{shape.replace('x', ' x ')}':fontcolor=white:fontsize={font_size}"
        ":x=(w-text_w)/2:y=(h-text_h)/2"
    )
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"color=c=0x3c3c46:s={width}x{height}",
         "-frames:v", "1", "-vf", vf, str(out)],
        check=True,
    )
    return out


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def principled(name, color, roughness, metallic=0.0):
    mat = bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def emissive(name, color, strength):
    mat = bpy.data.materials.new(name)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (*color, 1.0)
    emission.inputs["Strength"].default_value = strength
    output = nodes.new("ShaderNodeOutputMaterial")
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return mat


def screen_material(shape, source, frame_count):
    mat = bpy.data.materials.new(f"screen_{shape}")
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


def box(name, center, dims, material, yaw=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=center, rotation=(0.0, 0.0, yaw))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = dims
    obj.data.materials.append(material)
    return obj


def screen_plane(name, center, width, height, yaw, material):
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=center, rotation=(math.pi / 2, 0.0, yaw))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (width, height, 1.0)
    obj.data.materials.append(material)
    return obj


def facing(yaw):
    return Vector((math.sin(yaw), -math.cos(yaw), 0.0))


def build_architecture(mats):
    box("floor", (1.0, 0.5, -0.05), (24.0, 19.0, 0.1), mats["floor"])
    box("ceiling", (1.0, 0.5, CEILING_Z + 0.05), (24.0, 19.0, 0.1), mats["ceiling"])
    box("wall_back", (1.0, BACK_WALL_Y + 0.1, CEILING_Z / 2), (24.0, 0.2, CEILING_Z), mats["wall"])
    box("wall_left", (-10.1, 0.5, CEILING_Z / 2), (0.2, 19.0, CEILING_Z), mats["wall"])
    box("wall_right", (12.1, 0.5, CEILING_Z / 2), (0.2, 19.0, CEILING_Z), mats["wall"])
    for i, (x, y) in enumerate([(-4.5, 1.5), (4.5, 1.5), (-4.5, 6.5), (4.5, 6.5)]):
        box(f"column_{i}", (x, y, CEILING_Z / 2), (0.9, 0.9, CEILING_Z), mats["column"])
    box("guide_pillar", (4.0, -1.0, 1.15), (1.1, 0.45, 2.3), mats["pillar"], yaw=-0.3)
    for i, x in enumerate([-6.0, 0.0, 6.0]):
        for j, y in enumerate([-4.0, 1.0, 6.0]):
            box(f"light_strip_{i}_{j}", (x, y, CEILING_Z - 0.01), (3.0, 0.25, 0.02), mats["light_strip"])


def build_lights():
    for i, x in enumerate([-6.0, 0.0, 6.0]):
        for j, y in enumerate([-4.0, 1.0, 6.0]):
            bpy.ops.object.light_add(type="AREA", location=(x, y, CEILING_Z - 0.05))
            light = bpy.context.active_object
            light.name = f"area_{i}_{j}"
            light.data.shape = "RECTANGLE"
            light.data.size, light.data.size_y = 3.0, 0.25
            light.data.energy = AREA_LIGHT_W
            light.data.color = (1.0, 0.97, 0.92)


def build_screens(mats, frame_count):
    sources = {}
    for shape, spec in SCREENS.items():
        width, height = spec["size"]
        center, yaw = spec["center"], spec["yaw"]
        bezel_center = center + facing(yaw) * -(BEZEL_DEPTH_M / 2)
        box(f"bezel_{shape}", bezel_center, (width + 2 * BEZEL_M, BEZEL_DEPTH_M, height + 2 * BEZEL_M), mats["bezel"], yaw)
        source = screen_source(shape)
        sources[shape] = source
        plane_center = center + facing(yaw) * 0.002
        screen_plane(f"screen_{shape}", plane_center, width, height, yaw, screen_material(shape, source, frame_count))
    ribbon = SCREENS["32x9"]
    top_z = ribbon["center"].z + ribbon["size"][1] / 2
    for dx in (-2.6, 2.6):
        rod_len = CEILING_Z - top_z
        box(f"ribbon_rod_{dx:+.1f}", (ribbon["center"].x + dx, ribbon["center"].y, top_z + rod_len / 2), (0.03, 0.03, rod_len), mats["bezel"])
    return sources


def build_world():
    world = bpy.data.worlds.new("world")
    bpy.context.scene.world = world
    nodes, links = world.node_tree.nodes, world.node_tree.links
    nodes.clear()
    env = nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(str(HDRI_PATH))
    background = nodes.new("ShaderNodeBackground")
    background.inputs["Strength"].default_value = HDRI_STRENGTH
    output = nodes.new("ShaderNodeOutputWorld")
    links.new(env.outputs["Color"], background.inputs["Color"])
    links.new(background.outputs["Background"], output.inputs["Surface"])


def build_camera(frame_count):
    scene = bpy.context.scene
    bpy.ops.object.empty_add(location=SCREENS[SHOT_ORDER[0]]["center"])
    target = bpy.context.active_object
    target.name = "camera_target"
    bpy.ops.object.camera_add(location=CAMERA_WAYPOINTS[0])
    camera = bpy.context.active_object
    camera.name = "dolly_camera"
    camera.data.lens = 28.0
    constraint = camera.constraints.new("TRACK_TO")
    constraint.target = target
    constraint.track_axis = "TRACK_NEGATIVE_Z"
    constraint.up_axis = "UP_Y"
    scene.camera = camera

    key_frames = shot_frames(frame_count)
    for frame, shape, position in zip(key_frames, SHOT_ORDER, CAMERA_WAYPOINTS):
        camera.location = position
        camera.keyframe_insert("location", frame=frame)
        target.location = SCREENS[shape]["center"]
        target.keyframe_insert("location", frame=frame)
    return key_frames


def shot_frames(frame_count):
    last = len(SHOT_ORDER) - 1
    return [1 + round(i * (frame_count - 1) / last) for i in range(len(SHOT_ORDER))]


def configure_render(args, frame_count, frames_dir):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = args.samples
    if hasattr(scene.eevee, "use_raytracing"):
        scene.eevee.use_raytracing = True
    scene.render.resolution_x, scene.render.resolution_y = args.width, args.height
    scene.render.resolution_percentage = 100
    scene.render.fps = args.fps
    scene.frame_start, scene.frame_end = 1, frame_count
    scene.view_settings.view_transform = "AgX"
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(frames_dir / "####")


def encode_mp4(frames_dir, fps, out_path):
    out_path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps), "-i", str(frames_dir / "%04d.png"),
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-an", str(out_path)],
        check=True,
    )


def export_stills(frames_dir, key_frames, stills_dir):
    stills_dir.mkdir(parents=True, exist_ok=True)
    for frame, shape in zip(key_frames, SHOT_ORDER):
        shutil.copyfile(frames_dir / f"{frame:04d}.png", stills_dir / f"shot_{shape}.png")


def main():
    args = parse_args()
    frame_count = max(2, round(args.seconds * args.fps))
    frames_dir = CACHE_DIR / "frames"
    if frames_dir.exists():
        shutil.rmtree(frames_dir)
    frames_dir.mkdir(parents=True)

    reset_scene()
    mats = {
        "floor": principled("floor", (0.22, 0.22, 0.23), 0.15),
        "ceiling": principled("ceiling", (0.06, 0.06, 0.07), 0.7),
        "wall": principled("wall", (0.30, 0.30, 0.29), 0.6),
        "column": principled("column", (0.55, 0.55, 0.54), 0.4),
        "pillar": principled("pillar", (0.08, 0.08, 0.09), 0.35, metallic=0.6),
        "bezel": principled("bezel", (0.02, 0.02, 0.02), 0.3),
        "light_strip": emissive("light_strip", (1.0, 0.97, 0.92), 8.0),
    }
    build_architecture(mats)
    build_lights()
    sources = build_screens(mats, frame_count)
    build_world()
    key_frames = build_camera(frame_count)
    configure_render(args, frame_count, frames_dir)

    if args.save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=str(CACHE_DIR / "scene.blend"))

    started = time.perf_counter()
    bpy.ops.render.render(animation=True)
    elapsed = time.perf_counter() - started

    encode_mp4(frames_dir, args.fps, Path(args.out).resolve())
    export_stills(frames_dir, key_frames, Path(args.stills_dir).resolve())
    for shape, source in sources.items():
        width, height = SCREENS[shape]["size"]
        print(f"SCREEN {shape} {width:.3f}m x {height:.3f}m source={source.name}")
    print(f"RENDER_STATS frames={frame_count} res={args.width}x{args.height} samples={args.samples} "
          f"total_s={elapsed:.1f} per_frame_s={elapsed / frame_count:.2f}")


main()
