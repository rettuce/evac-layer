import math

import bpy

CORNER_STEPS = 6


def face_strip_points(half_side, radius):
    """Outline of one face, from the middle of its left corner arc to the middle of its right one.

    Local frame: the face looks toward -Y, so walking the points left to right as seen from the
    front keeps the texture upright and unmirrored.
    """
    inner = half_side - radius
    points = []
    for step in range(CORNER_STEPS + 1):
        theta = math.radians(225 + 45 * step / CORNER_STEPS)
        points.append((-inner + radius * math.cos(theta), -inner + radius * math.sin(theta)))
    for step in range(CORNER_STEPS + 1):
        theta = math.radians(270 + 45 * step / CORNER_STEPS)
        points.append((inner + radius * math.cos(theta), -inner + radius * math.sin(theta)))
    return points


def strip_lengths(points):
    lengths = [0.0]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        lengths.append(lengths[-1] + math.hypot(x1 - x0, y1 - y0))
    return lengths


def build_led_wrap(name, center, half_side, radius, z0, z1, material, source_aspect):
    """Four strips that meet mid-corner, so the LED skin wraps the column with no seam or bezel.

    Each strip shows the source cropped to cover it: full height, centred horizontal crop.
    """
    outline = face_strip_points(half_side, radius)
    lengths = strip_lengths(outline)
    strip_aspect = lengths[-1] / (z1 - z0)
    crop = min(1.0, strip_aspect / source_aspect)
    for face in range(4):
        angle = math.radians(90 * face)
        cos_a, sin_a = math.cos(angle), math.sin(angle)
        ring = [(center[0] + x * cos_a - y * sin_a, center[1] + x * sin_a + y * cos_a) for x, y in outline]
        verts = [(x, y, z0) for x, y in ring] + [(x, y, z1) for x, y in ring]
        n = len(ring)
        quads = [(i, i + 1, n + i + 1, n + i) for i in range(n - 1)]
        mesh = bpy.data.meshes.new(f"{name}_{face}")
        mesh.from_pydata(verts, [], quads)
        uv = mesh.uv_layers.new(name="UVMap")
        for poly in mesh.polygons:
            for loop_index in poly.loop_indices:
                vert = mesh.loops[loop_index].vertex_index
                along = lengths[vert % n] / lengths[-1]
                uv.data[loop_index].uv = (0.5 + (along - 0.5) * crop, 0.0 if vert < n else 1.0)
        for poly in mesh.polygons:
            poly.use_smooth = True
        mesh.materials.append(material)
        obj = bpy.data.objects.new(f"{name}_{face}", mesh)
        bpy.context.collection.objects.link(obj)
    return lengths[-1]
