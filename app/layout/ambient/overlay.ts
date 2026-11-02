export const D21_BASE_SHORT_SIDE_PX = 720
export const D21_MARGIN = 48
export const D21_TRACK = 192
export const D21_GUTTER = 24
export const D21_PITCH = D21_TRACK + D21_GUTTER
export const D21_BLOCK_TRACKS = 2
export const D21_BLOCK_WIDTH = D21_BLOCK_TRACKS * D21_TRACK + (D21_BLOCK_TRACKS - 1) * D21_GUTTER
export const D21_TYPE = {
  label: { size: 24, line: 32 },
  time: { size: 144, line: 144 },
} as const
export const CLOCK_SWEEP_PERIOD_MS = 60_000
export const CLOCK_SWEEP_LENGTH = 48

export const OVERLAY_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const
export type OverlayCorner = (typeof OVERLAY_CORNERS)[number]

export function d21Scale(width: number, height: number): number {
  return Math.min(width, height) / D21_BASE_SHORT_SIDE_PX
}

export interface OverlayGeometry {
  scale: number
  block: { left: number; top?: number; bottom?: number; width: number }
  rules: number[]
}

export function overlayGeometry(width: number, height: number, corner: OverlayCorner): OverlayGeometry {
  const scale = d21Scale(width, height)
  if (!(scale > 0)) return { scale: 0, block: { left: 0, top: 0, width: 0 }, rules: [] }
  const margin = D21_MARGIN * scale
  const blockWidth = D21_BLOCK_WIDTH * scale
  const fromRight = corner.endsWith('right')
  const left = fromRight ? width - margin - blockWidth : margin
  const vertical = corner.startsWith('top') ? { top: margin } : { bottom: margin }
  const rules: number[] = []
  for (let x = margin; x + D21_TRACK * scale <= width - margin + 0.5; x += D21_PITCH * scale) {
    rules.push(x, x + D21_TRACK * scale)
  }
  const mirrored = fromRight ? rules.map((x) => width - x).reverse() : rules
  return { scale, block: { left, ...vertical, width: blockWidth }, rules: mirrored }
}

export function clockSweep(epochMs: number): number {
  return (((epochMs % CLOCK_SWEEP_PERIOD_MS) + CLOCK_SWEEP_PERIOD_MS) % CLOCK_SWEEP_PERIOD_MS) / CLOCK_SWEEP_PERIOD_MS
}

const JST_OFFSET_MS = 9 * 3600 * 1000

export function formatClockJst(epochMs: number): string {
  const jst = new Date(epochMs + JST_OFFSET_MS)
  return `${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`
}
