"""Bake the look-C concourse of demo/blender/build_scene.py and export it for the web simulator.

blender -b -P sim/blender/export_glb.py [-- --size 2048 --floor-size 4096 --ao-samples 64]

Writes sim/public/room.glb (baked colour embedded, display faces and cameras with extras),
sim/public/tex/<group>_ao.jpg (ambient occlusion, referenced from each mesh's extras.ao) and
sim/public/crops.json (build_scene.py --crops-json: each window's canvas crop, shape and seam, which the
viewer reads in preference to the extras so a crop change needs no re-bake).
"""

import argparse
import json
import math
import runpy
import sys
import time
from pathlib import Path

import bpy
from mathutils import Vector

SIM_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = SIM_DIR.parent
BUILD_SCENE = REPO_DIR / "demo" / "blender" / "build_scene.py"
PUBLIC_DIR = SIM_DIR / "public"
TEX_DIR = PUBLIC_DIR / "tex"
SCRATCH_DIR = Path(bpy.app.tempdir or "/tmp") / "evac-sim-export"

LOOK = "C"
# The page each shape is drawn at (app/layout/shapes.ts SHAPES); a pillar page is four faces side by side.
FACE_PX = {"9x16": (1080, 1920), "32x9": (3840, 1080), "pillar": (6616, 5046)}
PILLAR_FACE_PX = 1654
BAKE_MARGIN_PX = 4
DIFFUSE_SAMPLES = 8
JPEG_QUALITY = 88


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--size", type=int, default=2048)
    parser.add_argument("--floor-size", type=int, default=4096)
    parser.add_argument("--ao-samples", type=int, default=64)
    parser.add_argument("--ao-distance", type=float, default=2.0)
    parser.add_argument("--out", default=str(PUBLIC_DIR / "room.glb"))
    return parser.parse_args(argv)


def load_build_scene():
    """Run build_scene.py with --crops-json so its main() returns before rendering; its globals are reused."""
    SCRATCH_DIR.mkdir(parents=True, exist_ok=True)
    crops_path = SCRATCH_DIR / "crops.json"
    saved_argv = sys.argv
    sys.argv = ["blender", "--", "--crops-json", str(crops_path)]
    try:
        ns = runpy.run_path(str(BUILD_SCENE), run_name="build_scene")
    finally:
        sys.argv = saved_argv
    ns["SCREENS_DIR"] = SCRATCH_DIR / "screens"
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    (PUBLIC_DIR / "crops.json").write_text(crops_path.read_text())
    return ns, json.loads(crops_path.read_text())


def to_gltf(v):
    """Blender Z-up to glTF Y-up (what the exporter does to every node)."""
    return [round(v.x, 5), round(v.z, 5), round(-v.y, 5)]


def facing(yaw):
    return Vector((math.sin(yaw), -math.cos(yaw), 0.0))


def screen_extras(ns, crops):
    """Per display mesh: which page it shows, its window on the room canvas, and its flat plane in metres."""
    canvas = crops["canvas"]
    extras = {}
    for shape in ("9x16", "32x9"):
        spec = ns["SCREENS"][shape]
        width, height = spec["size"]
        for i, (surface, yaw) in enumerate(spec["mounts"]):
            name = f"{shape}_{i}"
            normal = facing(yaw)
            extras[f"screen_{name}"] = {
                "screen": name, "shape": shape, "face": 0, "canvas": canvas, "crop": crops["crops"][name],
                "face_px": list(FACE_PX[shape]), "size": [round(width, 5), round(height, 5)],
                "center": to_gltf(surface + normal * ns["FLUSH_EPS_M"]), "normal": to_gltf(normal),
            }
    perimeter = ns["COLUMN_LED_PERIMETER"]
    half = ns["COLUMN_CLAD_HALF"] + ns["FLUSH_EPS_M"]
    height = ns["COLUMN_LED_TOP_Z"] - ns["COLUMN_LED_BOTTOM_Z"]
    for i, (x, y) in enumerate(ns["COLUMNS"]):
        name = f"pillar_{i}"
        for face in range(4):
            angle = math.radians(90 * face)
            normal = Vector((math.sin(angle), -math.cos(angle), 0.0))
            center = Vector((x, y, ns["COLUMN_LED_MID_Z"])) + normal * half
            extras[f"led_wrap_{i}_{face}"] = {
                "screen": name, "shape": "pillar", "face": face, "canvas": canvas, "crop": crops["crops"][name],
                "face_px": [PILLAR_FACE_PX, FACE_PX["pillar"][1]], "size": [round(perimeter / 4, 5), round(height, 5)],
                "center": to_gltf(center), "normal": to_gltf(normal),
            }
    return extras


def camera_target(ns, spec):
    if "focus" not in spec:
        return spec["target"]
    screen = ns["SCREENS"][spec["focus"]]
    tangent = Vector((math.cos(screen["yaw"]), math.sin(screen["yaw"]), 0.0))
    return spec.get("target", screen["center"] + tangent * spec.get("aim_shift", 0.0))


def add_cameras(ns):
    for name, spec in ns["STILL_CAMERAS"].items():
        target = camera_target(ns, spec)
        data = bpy.data.cameras.new(f"cam_{name}")
        data.lens = spec["lens"]
        data.sensor_fit = "HORIZONTAL"
        data.sensor_width = 36.0
        camera = bpy.data.objects.new(f"cam_{name}", data)
        camera.location = spec["location"]
        camera.rotation_euler = (target - spec["location"]).to_track_quat("-Z", "Y").to_euler()
        camera["target"] = to_gltf(target)
        camera["lens_mm"] = spec["lens"]
        camera["preset"] = name
        bpy.context.collection.objects.link(camera)


BAKE_GROUPS = {
    "floor": lambda n: n == "floor",
    "ceiling": lambda n: n == "ceiling",
    "wall_back": lambda n: n == "wall_back",
    "wall_front": lambda n: n == "wall_front",
    "wall_left": lambda n: n == "wall_left",
    "wall_right": lambda n: n == "wall_right",
    "columns": lambda n: n.startswith(("column_", "column_cladding_")),
    "louver_back": lambda n: n.startswith("louver_back_"),
    "louver_left": lambda n: n.startswith("louver_left_"),
    "louver_ceiling": lambda n: n.startswith("louver_ceiling_"),
    "fixtures": lambda n: n == "headwall" or n.startswith(("joint_", "light_strip_")),
}


def select_only(objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


def join_group(name, members):
    select_only(members)
    if len(members) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    obj.data.name = name
    return obj


def unwrap(obj):
    select_only([obj])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode="OBJECT")


def bake_image(obj, name, size, bake_type, samples, use_float=False):
    image = bpy.data.images.new(name, size, size, float_buffer=use_float)
    image.colorspace_settings.name = "sRGB" if bake_type == "DIFFUSE" else "Non-Color"
    nodes_added = []
    for slot in obj.material_slots:
        mat = slot.material
        mat.use_nodes = True
        node = mat.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = image
        node.select = True
        mat.node_tree.nodes.active = node
        nodes_added.append((mat, node))
    scene = bpy.context.scene
    scene.cycles.samples = samples
    scene.cycles.bake_type = bake_type
    bake = scene.render.bake
    bake.use_pass_direct = False
    bake.use_pass_indirect = False
    bake.use_pass_color = True
    bake.margin = BAKE_MARGIN_PX
    bake.use_clear = True
    select_only([obj])
    started = time.perf_counter()
    bpy.ops.object.bake(type=bake_type)
    elapsed = time.perf_counter() - started
    for mat, node in nodes_added:
        mat.node_tree.nodes.remove(node)
    print(f"BAKE {name} type={bake_type} size={size} samples={samples} s={elapsed:.1f}")
    return image


def save_image(image, path, file_format):
    scene = bpy.context.scene
    settings = scene.render.image_settings
    settings.file_format = file_format
    settings.color_mode = "RGB"
    settings.quality = JPEG_QUALITY
    settings.color_depth = "8"
    image.save_render(filepath=str(path), scene=scene)


def baked_material(name, color_path):
    mat = bpy.data.materials.new(f"baked_{name}")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Specular IOR Level"].default_value = 0.0
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(str(color_path))
    tex.image.colorspace_settings.name = "sRGB"
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def use_cycles(ao_distance):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for device in prefs.devices:
        device.use = True
    scene.cycles.device = "GPU"
    scene.cycles.use_denoising = False
    world = bpy.data.worlds.new("bake_world")
    scene.world = world
    world.light_settings.distance = ao_distance


def black_material():
    mat = bpy.data.materials.new("display_off")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    bsdf.inputs["Roughness"].default_value = 1.0
    return mat


def main():
    args = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ns, crops = load_build_scene()
    back_wall_clear = [(c.x - ns["SCREENS"][s]["size"][0] / 2 - ns["JOINT_M"], c.x + ns["SCREENS"][s]["size"][0] / 2 + ns["JOINT_M"])
                       for s in ns["BACK_WALL_SHAPES"] for c, _ in ns["SCREENS"][s]["mounts"]]
    ns["build_look"](LOOK, back_wall_clear)
    ns["build_screens"](2, "off")
    for obj in list(bpy.data.objects):
        if obj.type == "LIGHT":
            bpy.data.objects.remove(obj)

    extras = screen_extras(ns, crops)
    display = black_material()
    for name, data in extras.items():
        obj = bpy.data.objects[name]
        obj.data.materials.clear()
        obj.data.materials.append(display)
        for key, value in data.items():
            obj[key] = value

    use_cycles(args.ao_distance)
    TEX_DIR.mkdir(parents=True, exist_ok=True)
    mesh_names = [o.name for o in bpy.data.objects if o.type == "MESH" and o.name not in extras]
    for group, matches in BAKE_GROUPS.items():
        members = [bpy.data.objects[n] for n in mesh_names if matches(n) and n in bpy.data.objects]
        if not members:
            continue
        obj = join_group(group, members)
        unwrap(obj)
        size = args.floor_size if group == "floor" else args.size
        color = bake_image(obj, f"{group}_color", size, "DIFFUSE", DIFFUSE_SAMPLES)
        ao = bake_image(obj, f"{group}_ao", size, "AO", args.ao_samples)
        color_path = TEX_DIR / f"{group}_color.jpg"
        ao_path = TEX_DIR / f"{group}_ao.jpg"
        save_image(color, color_path, "JPEG")
        save_image(ao, ao_path, "JPEG")
        bpy.data.images.remove(color)
        bpy.data.images.remove(ao)
        obj.data.materials.clear()
        obj.data.materials.append(baked_material(group, color_path))
        obj["ao"] = ao_path.name
        obj["group"] = group

    add_cameras(ns)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out), export_format="GLB", export_cameras=True, export_extras=True, export_apply=True,
        export_lights=False, export_yup=True, export_materials="EXPORT", export_image_format="AUTO",
        export_jpeg_quality=JPEG_QUALITY, use_selection=False,
    )
    print(f"EXPORT {out} bytes={out.stat().st_size} cameras={len(ns['STILL_CAMERAS'])} displays={len(extras)}")


main()
