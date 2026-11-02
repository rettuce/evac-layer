import math

import bpy


def principled(name, color, roughness, metallic=0.0):
    mat = bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def glass(name, roughness=0.02, alpha=0.12):
    # Alpha instead of transmission: Eevee renders transmission without raytraced refraction as opaque grey.
    mat = principled(name, (0.9, 0.95, 0.95), roughness)
    mat.node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = alpha
    mat.surface_render_method = "BLENDED"
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


def box(name, center, dims, material, yaw=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=center, rotation=(0.0, 0.0, yaw))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = dims
    obj.data.materials.append(material)
    return obj


def vertical_plane(name, center, width, height, yaw, material):
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=center, rotation=(math.pi / 2, 0.0, yaw))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (width, height, 1.0)
    obj.data.materials.append(material)
    return obj


def area_light(name, location, size, energy, color, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.object.light_add(type="AREA", location=location, rotation=rotation)
    light = bpy.context.active_object
    light.name = name
    light.data.shape = "RECTANGLE"
    light.data.size, light.data.size_y = size
    light.data.energy = energy
    light.data.color = color
    return light


def spot_light(name, location, energy, color, spot_deg, blend):
    bpy.ops.object.light_add(type="SPOT", location=location)
    light = bpy.context.active_object
    light.name = name
    light.data.energy = energy
    light.data.color = color
    light.data.spot_size = math.radians(spot_deg)
    light.data.spot_blend = blend
    light.data.shadow_soft_size = 0.05
    return light
