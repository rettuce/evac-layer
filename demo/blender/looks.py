import math

import bpy

from layout import (
    BACK_WALL_Y, CEILING_TRIM_M, CEILING_Z, COLUMN_SIZE, COLUMNS, FRONT_Y, LEFT_WALL_X, LIGHT_XS, LIGHT_YS,
    PILLAR_CENTER, PILLAR_SIZE, PILLAR_YAW, RIGHT_WALL_X, room_center, room_size,
)
from polyhaven import fetch_texture
from primitives import area_light, box, emissive, glass, principled, spot_light

NEUTRAL = (1.0, 0.98, 0.95)
WARM_3500K = (1.0, 0.86, 0.72)
WARM_3000K = (1.0, 0.80, 0.62)
FACING_UP = (math.pi, 0.0, 0.0)


def textured(name, asset_id, value=1.0, saturation=1.0, rough_scale=1.0, normal_strength=0.4):
    meta = fetch_texture(asset_id)
    mat = bpy.data.materials.new(name)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    geometry = nodes.new("ShaderNodeNewGeometry")
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = [1.0 / meta["size_m"][0]] * 3
    links.new(geometry.outputs["Position"], mapping.inputs["Vector"])

    def image(key, colorspace):
        node = nodes.new("ShaderNodeTexImage")
        node.image = bpy.data.images.load(str(meta["paths"][key]), check_existing=True)
        node.image.colorspace_settings.name = colorspace
        node.projection = "BOX"
        node.projection_blend = 0.2
        links.new(mapping.outputs["Vector"], node.inputs["Vector"])
        return node

    grade = nodes.new("ShaderNodeHueSaturation")
    grade.inputs["Saturation"].default_value = saturation
    grade.inputs["Value"].default_value = value
    links.new(image("diffuse", "sRGB").outputs["Color"], grade.inputs["Color"])
    links.new(grade.outputs["Color"], bsdf.inputs["Base Color"])

    rough = nodes.new("ShaderNodeMath")
    rough.operation = "MULTIPLY"
    rough.use_clamp = True
    rough.inputs[1].default_value = rough_scale
    links.new(image("rough", "Non-Color").outputs["Color"], rough.inputs[0])
    links.new(rough.outputs["Value"], bsdf.inputs["Roughness"])

    normal_map = nodes.new("ShaderNodeNormalMap")
    normal_map.inputs["Strength"].default_value = normal_strength
    links.new(image("normal", "Non-Color").outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def build_shell(mats):
    center = room_center()
    width, depth = room_size()
    mid_z = CEILING_Z / 2
    box("floor", (center.x, center.y, -0.05), (width, depth, 0.1), mats["floor"])
    box("ceiling", (center.x, center.y, CEILING_Z + 0.05), (width, depth, 0.1), mats["ceiling"])
    box("wall_back", (center.x, BACK_WALL_Y + 0.1, mid_z), (width, 0.2, CEILING_Z), mats["wall"])
    box("wall_front", (center.x, FRONT_Y - 0.1, mid_z), (width, 0.2, CEILING_Z), mats["wall"])
    box("wall_left", (LEFT_WALL_X - 0.1, center.y, mid_z), (0.2, depth, CEILING_Z), mats.get("wall_left", mats["wall"]))
    box("wall_right", (RIGHT_WALL_X + 0.1, center.y, mid_z), (0.2, depth, CEILING_Z), mats["wall"])
    for i, (x, y) in enumerate(COLUMNS):
        box(f"column_{i}", (x, y, mid_z), (COLUMN_SIZE, COLUMN_SIZE, CEILING_Z), mats["column"])
    box("guide_pillar", PILLAR_CENTER, PILLAR_SIZE, mats["pillar"], yaw=PILLAR_YAW)


def light_grid(color, energy, strip_material=None):
    for i, x in enumerate(LIGHT_XS):
        for j, y in enumerate(LIGHT_YS):
            area_light(f"area_{i}_{j}", (x, y, CEILING_Z - 0.05), (3.0, 0.25), energy, color)
            if strip_material:
                box(f"light_strip_{i}_{j}", (x, y, CEILING_Z - 0.01), (3.0, 0.25, 0.02), strip_material)


def look_base(_back_wall_clear):
    build_shell({
        "floor": principled("floor", (0.22, 0.22, 0.23), 0.15),
        "ceiling": principled("ceiling", (0.06, 0.06, 0.07), 0.7),
        "wall": principled("wall", (0.30, 0.30, 0.29), 0.6),
        "column": principled("column", (0.55, 0.55, 0.54), 0.4),
        "pillar": principled("pillar", (0.08, 0.08, 0.09), 0.35, metallic=0.6),
    })
    light_grid((1.0, 0.97, 0.92), 90.0, emissive("light_strip", (1.0, 0.97, 0.92), 8.0))
    return {"hdri_strength": 0.3}


def look_a(_back_wall_clear):
    """Contemporary station building: white, large reflective floor tiles, indirect light lines."""
    build_shell({
        "floor": textured("floor", "granite_tile", value=2.4, saturation=0.25, rough_scale=0.08),
        "ceiling": principled("ceiling", (0.70, 0.70, 0.69), 0.6),
        "wall": textured("wall", "long_white_tiles", value=1.05, saturation=0.4, rough_scale=0.6),
        "column": principled("column", (0.86, 0.86, 0.85), 0.22),
        "pillar": principled("pillar", (0.10, 0.10, 0.11), 0.3, metallic=0.5),
    })
    center = room_center()
    width, depth = room_size()
    line = emissive("light_line", NEUTRAL, 12.0)
    for i, x in enumerate(LIGHT_XS):
        box(f"light_line_{i}", (x, center.y, CEILING_Z - 0.01), (0.08, depth, 0.02), line)
        for j, y in enumerate(LIGHT_YS):
            area_light(f"line_light_{i}_{j}", (x, y, CEILING_Z - 0.05), (0.1, 4.5), 120.0, NEUTRAL)
    cove_z = CEILING_Z - 0.45
    area_light("cove_back", (center.x, BACK_WALL_Y - 0.3, cove_z), (width, 0.2), 450.0, NEUTRAL, FACING_UP)
    area_light("cove_left", (LEFT_WALL_X + 0.3, center.y, cove_z), (0.2, depth), 350.0, NEUTRAL, FACING_UP)
    return {"hdri_strength": 0.35}


def look_b(_back_wall_clear):
    """Underground concourse: exposed concrete, downlight pools, glass shopfront."""
    concrete_wall = textured("wall", "concrete_wall_008", value=1.0, rough_scale=1.0, normal_strength=0.6)
    build_shell({
        "floor": textured("floor", "concrete_floor_worn_001", value=0.75, rough_scale=0.45),
        "ceiling": principled("ceiling", (0.035, 0.035, 0.04), 0.8),
        "wall": concrete_wall,
        "wall_left": principled("shop_back", (0.75, 0.70, 0.62), 0.6),
        "column": textured("column", "concrete_wall_008", value=0.85, normal_strength=0.6),
        "pillar": principled("pillar", (0.06, 0.06, 0.07), 0.3, metallic=0.6),
    })
    disc = emissive("downlight", WARM_3500K, 40.0)
    for i, x in enumerate([-7.5, -4.5, -1.5, 1.5, 4.5, 7.5, 10.5]):
        for j, y in enumerate([-6.5, -3.0, 0.5, 4.0, 7.5]):
            spot_light(f"downlight_{i}_{j}", (x, y, CEILING_Z - 0.05), 700.0, WARM_3500K, 55.0, 0.35)
            box(f"downlight_disc_{i}_{j}", (x, y, CEILING_Z - 0.005), (0.16, 0.16, 0.01), disc)
    build_shopfront(concrete_wall)
    return {"hdri_strength": 0.2}


def build_shopfront(soffit_material):
    glass_x = LEFT_WALL_X + 1.2
    glass_top = 3.2
    center_y = room_center().y
    depth = room_size()[1]
    pane = glass("shop_glass")
    mullion = principled("mullion", (0.05, 0.05, 0.05), 0.3, metallic=0.8)
    box("shop_glass", (glass_x, center_y, glass_top / 2), (0.02, depth, glass_top), pane)
    for k in range(int(depth // 2.4) + 1):
        y = FRONT_Y + k * 2.4
        box(f"mullion_{k}", (glass_x, y, glass_top / 2), (0.06, 0.06, glass_top), mullion)
    box("shop_soffit", (glass_x, center_y, (glass_top + CEILING_Z) / 2), (0.3, depth, CEILING_Z - glass_top), soffit_material)
    shop_x = (LEFT_WALL_X + glass_x) / 2
    for k, y in enumerate([-6.0, -2.0, 2.0, 6.0]):
        area_light(f"shop_light_{k}", (shop_x, y, glass_top - 0.1), (1.0, 3.5), 260.0, WARM_3000K)


def look_c(back_wall_clear):
    """Commercial atrium: wood louvers on white, warm light."""
    wood = textured("wood", "ash_veneer", value=1.0, saturation=1.1, rough_scale=0.8, normal_strength=0.3)
    white = principled("white", (0.85, 0.85, 0.83), 0.6)
    build_shell({
        "floor": textured("floor", "marble_01", value=1.25, saturation=0.5, rough_scale=0.3),
        "ceiling": principled("ceiling", (0.08, 0.07, 0.06), 0.8),
        "wall": white,
        "column": principled("column", (0.88, 0.88, 0.86), 0.35),
        "pillar": textured("pillar", "ash_veneer", value=0.6, rough_scale=0.7),
    })
    build_louvers(wood, back_wall_clear)
    light_grid(WARM_3000K, 160.0)
    center = room_center()
    area_light("skylight", (center.x, center.y + 2.0, CEILING_Z - 0.3), (8.0, 6.0), 1800.0, (0.95, 0.97, 1.0))
    return {"hdri_strength": 0.4}


def build_louvers(material, back_wall_clear, pitch=0.15, slat_w=0.05, slat_d=0.06):
    width, depth = room_size()
    for k in range(int(width / pitch)):
        x = LEFT_WALL_X + (k + 0.5) * pitch
        if any(lo - slat_w < x < hi + slat_w for lo, hi in back_wall_clear):
            continue
        box(f"louver_back_{k}", (x, BACK_WALL_Y - slat_d / 2, CEILING_Z / 2), (slat_w, slat_d, CEILING_Z), material)
    for k in range(int(depth / pitch)):
        y = FRONT_Y + (k + 0.5) * pitch
        box(f"louver_left_{k}", (LEFT_WALL_X + slat_d / 2, y, CEILING_Z / 2), (slat_d, slat_w, CEILING_Z), material)
    ceiling_pitch = 0.3
    for k in range(int(width / ceiling_pitch)):
        x = LEFT_WALL_X + (k + 0.5) * ceiling_pitch
        box(f"louver_ceiling_{k}", (x, room_center().y, CEILING_Z - CEILING_TRIM_M / 2), (0.06, depth, CEILING_TRIM_M), material)


LOOKS = {"base": look_base, "A": look_a, "B": look_b, "C": look_c}


def build_look(name, back_wall_clear):
    return LOOKS[name](back_wall_clear)
