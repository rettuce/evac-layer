import type { PanelShape, Shape, ShapeClass } from './types'

export const BASE_SHORT_SIDE_PX = 1080
export const OUTER_MARGIN_PX = 48
export const UNIT_PX = 8
export const GUTTER_PX = 24

export const SHAPES: Record<Shape, { cls: ShapeClass; width: number; height: number }> = {
  '16x9': { cls: 'landscape', width: 1920, height: 1080 },
  '9x16': { cls: 'portrait', width: 1080, height: 1920 },
  '32x9': { cls: 'ribbon', width: 3840, height: 1080 },
  '1x1': { cls: 'square', width: 1080, height: 1080 },
  pillar: { cls: 'pillar', width: 6616, height: 5834 },
}

const RIBBON_MIN_ASPECT = 2.6
const LANDSCAPE_MIN_ASPECT = 1.25
const PORTRAIT_MAX_ASPECT = 0.8

export function isShape(value: unknown): value is Shape {
  return typeof value === 'string' && value in SHAPES
}

export function shapeForViewport(width: number, height: number): Shape {
  const aspect = width / height
  if (aspect >= RIBBON_MIN_ASPECT) return '32x9'
  if (aspect >= LANDSCAPE_MIN_ASPECT) return '16x9'
  if (aspect <= PORTRAIT_MAX_ASPECT) return '9x16'
  return '1x1'
}

export function designScale(width: number, height: number): number {
  return Math.min(width, height) / BASE_SHORT_SIDE_PX
}

export const PANEL_SHAPES: readonly PanelShape[] = ['16x9', '9x16', '32x9', '1x1']

// A 1.062 m square column wrapped in LED from 1.3 m to 5.0 m, at the pixel pitch of a 55" portrait
// panel (1577 px/m): four faces of 1654 px side by side, the outer 37 px of each on the rounded corner.
export const PILLAR = {
  faces: 4,
  faceWidth: 1654,
  height: 5834,
  cornerPx: 37,
  faceShape: '9x16' as PanelShape,
  faceScale: 1,
  outputScale: 0.5,
} as const

export function isPanelShape(value: unknown): value is PanelShape {
  return typeof value === 'string' && (PANEL_SHAPES as readonly string[]).includes(value)
}
