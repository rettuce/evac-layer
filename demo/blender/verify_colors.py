"""Compare flat colour areas of each flat screen in a rendered still with the same frame of its recording."""

import math
import subprocess

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

PALETTE = {
    "lv5_black": (12, 0, 12), "lv4_purple": (170, 0, 170), "lv3_red": (255, 40, 0),
    "lv2_yellow": (242, 231, 0), "white": (255, 255, 255),
}
PALETTE_RADIUS = 30
FLAT_STD = 1.5
GRID = 28
MIN_SCREEN_PX = 20


def image_array(path):
    image = bpy.data.images.load(str(path), check_existing=False)
    image.colorspace_settings.name = "Non-Color"
    width, height = image.size
    pixels = np.array(image.pixels[:], dtype=np.float32).reshape(height, width, image.channels)[:, :, :3] * 255
    bpy.data.images.remove(image)
    return pixels


def recording_frame(source, frame, cache_dir):
    if source.suffix != ".mp4":
        return source
    out = cache_dir / f"verify_{source.stem}_{frame:04d}.png"
    # record.mjs hands libx264 RGB through swscale's default BT.601 limited-range matrix; decode it the same way.
    scale = "scale=in_color_matrix=bt601:in_range=tv:out_range=pc,format=rgb24"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(source), "-vf", f"select=eq(n\\,{frame - 1}),{scale}",
                    "-frames:v", "1", str(out)], check=True)
    return out


def palette_class(rgb):
    name, ref = min(PALETTE.items(), key=lambda item: np.linalg.norm(rgb - np.array(item[1])))
    return name if np.linalg.norm(rgb - np.array(ref)) <= PALETTE_RADIUS else None


def mount_samples(scene, camera, depsgraph, render, source, size, mount, name, flush):
    height_px, width_px = render.shape[:2]
    src_h, src_w = source.shape[:2]
    center, yaw = mount
    tangent = Matrix.Rotation(yaw, 3, "Z") @ Vector((1.0, 0.0, 0.0))
    normal = Vector((math.sin(yaw), -math.cos(yaw), 0.0))

    def world(u, v):
        return center + normal * flush + tangent * ((u - 0.5) * size[0]) + Vector((0.0, 0.0, (v - 0.5) * size[1]))

    left, right = (world_to_camera_view(scene, camera, world(u, 0.5)) for u in (0.0, 1.0))
    screen_px = abs(right.x - left.x) * width_px
    if screen_px < MIN_SCREEN_PX:
        return []
    radius = math.ceil(1.5 * src_w / screen_px) + 2
    origin = camera.matrix_world.translation
    samples = []
    for u in np.linspace(0.06, 0.94, GRID):
        for v in np.linspace(0.06, 0.94, GRID):
            point = world(u, v)
            ndc = world_to_camera_view(scene, camera, point)
            if ndc.z <= 0 or not (0.01 < ndc.x < 0.99 and 0.01 < ndc.y < 0.99):
                continue
            ray = point - origin
            hit, _, _, _, obj, _ = scene.ray_cast(depsgraph, origin, ray.normalized(), distance=ray.length + 0.01)
            if not hit or obj.name != name:
                continue
            rx, ry = int(ndc.x * width_px), int(ndc.y * height_px)
            sx, sy = int(u * src_w), int(v * src_h)
            src_patch = source[max(sy - radius, 0):sy + radius + 1, max(sx - radius, 0):sx + radius + 1].reshape(-1, 3)
            out_patch = render[ry - 1:ry + 2, rx - 1:rx + 2].reshape(-1, 3)
            if src_patch.std(axis=0).max() > FLAT_STD or out_patch.std(axis=0).max() > FLAT_STD:
                continue
            samples.append((src_patch.mean(axis=0), out_patch.mean(axis=0)))
    return samples


def report_screen_colors(png, frame, sources, screens, flush, cache_dir):
    scene = bpy.context.scene
    camera = scene.camera
    depsgraph = bpy.context.evaluated_depsgraph_get()
    render = image_array(png)
    by_class = {}
    every = []
    for shape, spec in screens.items():
        source = image_array(recording_frame(sources[shape], frame, cache_dir))
        for i, mount in enumerate(spec["mounts"]):
            samples = mount_samples(scene, camera, depsgraph, render, source, spec["size"], mount, f"screen_{shape}_{i}", flush)
            if not samples:
                continue
            diffs = np.array([out - src for src, out in samples])
            print(f"COLOR screen={shape}_{i} n={len(samples)} mean_diff={np.round(diffs.mean(axis=0), 1).tolist()} "
                  f"max_abs={np.round(np.abs(diffs).max(axis=0), 1).tolist()}")
            every.extend(samples)
            for src, out in samples:
                name = palette_class(src)
                if name:
                    by_class.setdefault(name, []).append((src, out))
    for name, samples in sorted(by_class.items()):
        src = np.array([s for s, _ in samples]).mean(axis=0)
        out = np.array([o for _, o in samples]).mean(axis=0)
        worst = np.abs(np.array([o - s for s, o in samples])).max(axis=0)
        print(f"COLOR_CLASS {name} n={len(samples)} recording={np.round(src).astype(int).tolist()} "
              f"render={np.round(out).astype(int).tolist()} max_abs={np.round(worst, 1).tolist()}")
    if every:
        worst = np.abs(np.array([o - s for s, o in every])).max(axis=0)
        print(f"COLOR_ALL frame={frame} n={len(every)} max_abs={np.round(worst, 1).tolist()}")
    else:
        print(f"COLOR_ALL frame={frame} n=0 (no flat, visible screen area)")
