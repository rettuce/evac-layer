import type { ShapeClass, ShapeLayout } from './types'

export type LadderMode = 'h' | 'v'

export const LADDER_H_PX: Record<ShapeClass, number> = { landscape: 120, portrait: 112, square: 112, ribbon: 120, pillar: 112 }
export const LADDER_V_PX = 144
export const LADDER_CURRENT_GROWTH = 1.2

export function isLadderMode(value: unknown): value is LadderMode {
  return value === 'h' || value === 'v'
}

export function ladderSizePx(mode: LadderMode, cls: ShapeClass): number {
  return mode === 'h' ? LADDER_H_PX[cls] : LADDER_V_PX
}

// The horizontal ladder needs a full-width band on the first row to sit under; ribbon layouts
// put the band in a column, so they keep their layout.
export function withLadder(layout: ShapeLayout, mode: LadderMode, cls: ShapeClass): ShapeLayout {
  const size = ladderSizePx(mode, cls)
  if (mode === 'h') {
    if (cls === 'ribbon') return layout
    const span = Array.from({ length: layout.columns.length }, () => 'ladder').join(' ')
    return { ...layout, rows: [layout.rows[0]!, size, ...layout.rows.slice(1)], areas: [layout.areas[0]!, span, ...layout.areas.slice(1)] }
  }
  return { ...layout, columns: [size, ...layout.columns], areas: layout.areas.map((row) => `ladder ${row}`) }
}
