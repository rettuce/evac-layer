from mathutils import Vector

CEILING_Z = 5.2
BACK_WALL_Y = 9.0
LEFT_WALL_X = -10.0
RIGHT_WALL_X = 12.0
FRONT_Y = -9.0
EYE_Z = 1.6

COLUMN_SIZE = 0.9
COLUMNS = [(-5.5, 1.5), (5.5, 1.5), (-5.5, 6.5), (5.5, 6.5)]
COLUMN_CLAD_M = 0.08
COLUMN_CLAD_TOP_Z = CEILING_Z

CEILING_TRIM_M = 0.12
RIBBON_PANEL_W = 6.0
RIBBON_PANEL_H = RIBBON_PANEL_W * 9 / 32

HEADWALL_Y = 4.5
HEADWALL_DEPTH = 0.4
HEADWALL_BOTTOM_Z = CEILING_Z - CEILING_TRIM_M - RIBBON_PANEL_H

LIGHT_XS = [-6.0, 0.0, 6.0]
LIGHT_YS = [-4.0, 1.0, 6.0]


def room_center():
    return Vector(((LEFT_WALL_X + RIGHT_WALL_X) / 2, (FRONT_Y + BACK_WALL_Y) / 2, 0.0))


def room_size():
    return RIGHT_WALL_X - LEFT_WALL_X, BACK_WALL_Y - FRONT_Y


# The room's elevation as one logical canvas (width = room width, height = floor to ceiling, origin top-left),
# so one picture can be cut into every screen's window.
ELEVATION_PX_PER_M = 500


def elevation_canvas():
    return round((RIGHT_WALL_X - LEFT_WALL_X) * ELEVATION_PX_PER_M), round(CEILING_Z * ELEVATION_PX_PER_M)


def elevation_crop(center_x, center_z, width, height):
    """x, y, w, h in canvas pixels for a screen centred at (center_x, center_z) metres on the elevation."""
    px = ELEVATION_PX_PER_M
    return (round((center_x - width / 2 - LEFT_WALL_X) * px), round((CEILING_Z - center_z - height / 2) * px),
            round(width * px), round(height * px))
