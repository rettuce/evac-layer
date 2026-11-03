import os

from mathutils import Vector

# Arrangements compared before the final renders: EVAC_LAYOUT=base|spread|near.
LAYOUTS = {
    "base": {"columns_x": 4.5, "back_columns_y": 6.5, "back_wall_y": 9.0},
    "spread": {"columns_x": 6.5, "back_columns_y": 6.5, "back_wall_y": 9.0},
    "near": {"columns_x": 4.5, "back_columns_y": 5.3, "back_wall_y": 7.0},
}
LAYOUT_NAME = os.environ.get("EVAC_LAYOUT", "base")
_LAYOUT = LAYOUTS[LAYOUT_NAME]

CEILING_Z = 5.2
BACK_WALL_Y = _LAYOUT["back_wall_y"]
LEFT_WALL_X = -10.0
RIGHT_WALL_X = 12.0
FRONT_Y = -9.0
EYE_Z = 1.6

COLUMN_SIZE = 0.9
COLUMNS = [(-_LAYOUT["columns_x"], 1.5), (_LAYOUT["columns_x"], 1.5),
           (-_LAYOUT["columns_x"], _LAYOUT["back_columns_y"]), (_LAYOUT["columns_x"], _LAYOUT["back_columns_y"])]
COLUMN_CLAD_M = 0.08
COLUMN_CLAD_TOP_Z = CEILING_Z

CEILING_TRIM_M = 0.12
RIBBON_PANEL_W = 6.0
RIBBON_PANEL_H = RIBBON_PANEL_W * 9 / 32

HEADWALL_Y = 4.5
HEADWALL_DEPTH = 0.4
HEADWALL_BOTTOM_Z = CEILING_Z - CEILING_TRIM_M - RIBBON_PANEL_H

PILLAR_CENTER = Vector((4.0, -1.0, 1.15))
PILLAR_SIZE = (1.1, 0.45, 2.3)
PILLAR_YAW = -0.3

LIGHT_XS = [-6.0, 0.0, 6.0]
LIGHT_YS = [-4.0, 1.0, 6.0]


def room_center():
    return Vector(((LEFT_WALL_X + RIGHT_WALL_X) / 2, (FRONT_Y + BACK_WALL_Y) / 2, 0.0))


def room_size():
    return RIGHT_WALL_X - LEFT_WALL_X, BACK_WALL_Y - FRONT_Y
