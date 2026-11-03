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
export const D21_LABEL_GAP = 8
export const D21_TRACK_GAP = 24
const COORDS_TO_LABEL = 0.8
const COORDS_GAP = 4
export const COORD_GLYPHS = '0123456789.°NSEW, '
const RULE_ALPHA = 0.14
const TRACK_ALPHA = 0.4
const LABEL_ALPHA = 0.8
const LABEL_TRACKING_EM = 0.04
export const LABEL_FONT_FAMILY = '"Noto Sans JP", sans-serif'
export const TIME_FONT_FAMILY = '"Noto Sans", sans-serif'
export const OVERLAY_INK = { dark: [21, 24, 28], light: [244, 242, 236] } as const

export const OVERLAY_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const
export type OverlayCorner = (typeof OVERLAY_CORNERS)[number]

export function d21Scale(width: number, height: number): number {
  return Math.min(width, height) / D21_BASE_SHORT_SIDE_PX
}

export interface OverlayGeometry {
  scale: number
  areaWidth: number
  block: { left: number; top?: number; bottom?: number; width: number }
  rules: number[]
}

export function overlayGeometry(width: number, height: number, corner: OverlayCorner, scale = d21Scale(width, height)): OverlayGeometry {
  if (!(scale > 0)) return { scale: 0, areaWidth: width, block: { left: 0, top: 0, width: 0 }, rules: [] }
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
  return { scale, areaWidth: width, block: { left, ...vertical, width: blockWidth }, rules: mirrored }
}

export function clockSweep(epochMs: number): number {
  return (((epochMs % CLOCK_SWEEP_PERIOD_MS) + CLOCK_SWEEP_PERIOD_MS) % CLOCK_SWEEP_PERIOD_MS) / CLOCK_SWEEP_PERIOD_MS
}

const JST_OFFSET_MS = 9 * 3600 * 1000

export function formatClockJst(epochMs: number): string {
  const jst = new Date(epochMs + JST_OFFSET_MS)
  return `${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`
}

export function labelFont(scale: number): string {
  return `400 ${D21_TYPE.label.size * scale}px ${LABEL_FONT_FAMILY}`
}

export function timeFont(scale: number): string {
  return `400 ${D21_TYPE.time.size * scale}px ${TIME_FONT_FAMILY}`
}

export interface OverlayContent {
  siteName: string
  coords?: string
  time: string
  sweep: number
  ink: keyof typeof OVERLAY_INK
}

const BLOCK_HEIGHT = D21_TYPE.label.line + D21_LABEL_GAP + D21_TYPE.time.line + D21_TRACK_GAP
const COORDS_LINE = D21_TYPE.label.line * COORDS_TO_LABEL + COORDS_GAP

export function formatCoords(lat: number, lng: number): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lng).toFixed(4)}° ${lng < 0 ? 'W' : 'E'}`
}

export function coordsFont(scale: number): string {
  return `400 ${D21_TYPE.label.size * COORDS_TO_LABEL * scale}px ${LABEL_FONT_FAMILY}`
}

export function drawOverlay(ctx: CanvasRenderingContext2D, geometry: OverlayGeometry, content: OverlayContent): void {
  const { scale, block, rules } = geometry
  if (!(scale > 0)) return
  const { height } = ctx.canvas
  const [r, g, b] = OVERLAY_INK[content.ink]
  const margin = D21_MARGIN * scale
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = `rgb(${r} ${g} ${b})`

  ctx.globalAlpha = RULE_ALPHA
  for (const x of rules) ctx.fillRect(Math.round(x), Math.round(margin), 1, Math.round(height - 2 * margin))

  const alignRight = block.left > margin + 0.5
  const textX = alignRight ? block.left + block.width : block.left
  const coordsHeight = content.coords ? COORDS_LINE * scale : 0
  const top = block.top ?? height - (block.bottom ?? 0) - BLOCK_HEIGHT * scale - coordsHeight
  ctx.textAlign = alignRight ? 'right' : 'left'
  ctx.textBaseline = 'middle'

  ctx.globalAlpha = LABEL_ALPHA
  ctx.font = labelFont(scale)
  ctx.letterSpacing = `${D21_TYPE.label.size * scale * LABEL_TRACKING_EM}px`
  ctx.fillText(content.siteName, textX, top + (D21_TYPE.label.line * scale) / 2)
  if (content.coords) {
    ctx.font = coordsFont(scale)
    ctx.letterSpacing = '0px'
    ctx.fillText(content.coords, textX, top + (D21_TYPE.label.line + COORDS_GAP + (D21_TYPE.label.line * COORDS_TO_LABEL) / 2) * scale)
  }

  ctx.globalAlpha = 1
  ctx.font = timeFont(scale)
  ctx.letterSpacing = `${-0.01 * D21_TYPE.time.size * scale}px`
  const timeTop = top + coordsHeight + (D21_TYPE.label.line + D21_LABEL_GAP) * scale
  ctx.fillText(content.time, textX, timeTop + (D21_TYPE.time.line * scale) / 2)

  const trackY = Math.round(timeTop + (D21_TYPE.time.line + D21_TRACK_GAP) * scale)
  ctx.globalAlpha = TRACK_ALPHA
  ctx.fillRect(Math.round(block.left), trackY, Math.round(block.width), 1)
  ctx.globalAlpha = 1
  const sweepLength = CLOCK_SWEEP_LENGTH * scale
  ctx.fillRect(Math.round(block.left + content.sweep * block.width - sweepLength / 2), trackY - 1, Math.round(sweepLength), 3)
  ctx.restore()
}
