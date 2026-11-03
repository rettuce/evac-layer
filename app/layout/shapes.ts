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
  pillar: { cls: 'pillar', width: 6616, height: 5046 },
}

// Base shapes meet near the geometric mean of their native aspects, except that 16:9 reaches down to 5:4: the
// 1:1 base shape drops the shelter cell, and "how far, which way" must survive on 4:3 monitors. The fitted
// native canvas never drops below 0.70 of its size (16:9 at 5:4) and 1:1 never shrinks.
const RIBBON_MIN_ASPECT = 2.8
const LANDSCAPE_MIN_ASPECT = 1.25
const PORTRAIT_MAX_ASPECT = 0.75
const MAX_VIEWPORT_PX = 16384

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

// The base shape's native canvas is fitted inside the screen, so every track has at least its native room
// and a layout that fits at the native size fits at any aspect the base shape serves.
export function designScale(width: number, height: number, shape: Shape): number {
  return Math.min(width / SHAPES[shape].width, height / SHAPES[shape].height)
}

function positiveInt(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined
  const n = Number(value)
  return n > 0 && n <= MAX_VIEWPORT_PX ? n : undefined
}

export function viewportFromQuery(w: unknown, h: unknown, aspect: unknown): { width: number; height: number } | undefined {
  const width = positiveInt(w)
  const height = positiveInt(h)
  if (width && height) return { width, height }
  if (typeof aspect !== 'string') return undefined
  const parts = aspect.split(':')
  if (parts.length !== 2) return undefined
  const [aw, ah] = parts.map((part) => positiveInt(part))
  if (!aw || !ah) return undefined
  return aw >= ah
    ? { width: Math.round((BASE_SHORT_SIDE_PX * aw) / ah), height: BASE_SHORT_SIDE_PX }
    : { width: BASE_SHORT_SIDE_PX, height: Math.round((BASE_SHORT_SIDE_PX * ah) / aw) }
}

// A 1.062 m square column wrapped in LED from 0.40 m to 3.60 m above the floor, at the pixel pitch of a
// 55" portrait panel (1577 px/m): four faces of 1654 px side by side, the outer 37 px of each on the rounded corner.
// Faces are read from 2–5 m rather than a panel's 1–2 m, so their design pixels are drawn 1.6x.
export const PILLAR = {
  faces: 4,
  faceWidth: 1654,
  height: 5046,
  pxPerMetre: 1577,
  floorMetres: 0.4,
  cornerPx: 37,
  faceShape: '9x16' as PanelShape,
  faceScale: 1.6,
  outputScale: 0.5,
} as const

export function pillarYForHeight(metres: number): number {
  return PILLAR.height - (metres - PILLAR.floorMetres) * PILLAR.pxPerMetre
}
