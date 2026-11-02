import { GUTTER_PX } from './shapes.ts'
import type { ShapeClass, ShapeLayout } from './types'

export type LadderMode = 'h' | 'v'

export const LADDER_H_PX: Record<ShapeClass, number> = { landscape: 120, portrait: 112, square: 112, ribbon: 120, pillar: 112 }
export const LADDER_V_PX: Record<ShapeClass, number> = { landscape: 144, portrait: 120, square: 120, ribbon: 144, pillar: 120 }
export const LADDER_CURRENT_GROWTH = 1.2
// 1:1 has the least room once the ladder takes its column: the action pictogram gives way first, then the gutters.
export const SQUARE_ACTION_PICTOGRAM_STEP = 0.85
export const SQUARE_GUTTER_STEP_PX = 8

// The current rung only has room for 警戒レベル beside its numeral on wide screens and in the vertical ladder.
export function ladderHasCaption(mode: LadderMode, cls: ShapeClass): boolean {
  return mode === 'v' || cls === 'landscape' || cls === 'ribbon'
}

export function ladderSizePx(mode: LadderMode, cls: ShapeClass): number {
  return mode === 'h' ? LADDER_H_PX[cls] : LADDER_V_PX[cls]
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
  const narrowed = { ...layout, columns: [size, ...layout.columns], areas: layout.areas.map((row) => `ladder ${row}`) }
  if (cls !== 'square') return narrowed
  const action = layout.pictogramPx.action
  return {
    ...narrowed,
    rows: narrowed.rows.map((track) => (track === GUTTER_PX ? GUTTER_PX - SQUARE_GUTTER_STEP_PX : track)),
    pictogramPx: action ? { ...layout.pictogramPx, action: Math.round(action * SQUARE_ACTION_PICTOGRAM_STEP) } : layout.pictogramPx,
  }
}
