import type { Shape } from '../../types'
import { cellRandom, cellRange, fbm, paper, sceneUnit } from '../field.ts'
import type { AmbientFrame, AmbientScene } from '../types'

const PAPER = 'rgb(241 240 236)'
const INK = 'rgb(62 68 80 / 0.42)'
const CELL = 30
const FIELD_SCALE = 1 / 700
const DRIFT_MS = 360_000
const SIZE = { min: 0.08, max: 0.86 }
const LINE = 2.2
const GLYPHS = ['dot', 'square', 'plus', 'slash', 'ring', 'bar'] as const

function render(ctx: CanvasRenderingContext2D, t: number, seed: number, shape: Shape, frame: AmbientFrame): void {
  const unit = sceneUnit(frame, shape)
  const cell = CELL * unit
  const drift = t / DRIFT_MS
  const { i0, i1, j0, j1 } = cellRange(frame.view, cell)
  paper(ctx, frame, PAPER)
  const filled = new Path2D()
  const stroked = new Path2D()
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const value = fbm(seed, i * CELL * FIELD_SCALE - drift, j * CELL * FIELD_SCALE + drift * 0.4, 3)
      const shaped = Math.min(1, Math.max(0, (value - 0.3) / 0.45))
      const h = (cell * (SIZE.min + (SIZE.max - SIZE.min) * shaped)) / 2
      if (h < 0.6) continue
      const cx = (i + 0.5) * cell
      const cy = (j + 0.5) * cell
      const glyph = GLYPHS[Math.floor(cellRandom(seed, i, j) * GLYPHS.length)]!
      if (glyph === 'dot') {
        filled.moveTo(cx + h, cy)
        filled.arc(cx, cy, h, 0, Math.PI * 2)
      } else if (glyph === 'square') filled.rect(cx - h * 0.8, cy - h * 0.8, h * 1.6, h * 1.6)
      else if (glyph === 'bar') filled.rect(cx - h, cy - h * 0.25, h * 2, h * 0.5)
      else if (glyph === 'plus') {
        stroked.moveTo(cx - h, cy)
        stroked.lineTo(cx + h, cy)
        stroked.moveTo(cx, cy - h)
        stroked.lineTo(cx, cy + h)
      } else if (glyph === 'slash') {
        stroked.moveTo(cx - h, cy + h)
        stroked.lineTo(cx + h, cy - h)
      } else {
        stroked.moveTo(cx + h * 0.8, cy)
        stroked.arc(cx, cy, h * 0.8, 0, Math.PI * 2)
      }
    }
  }
  ctx.fillStyle = INK
  ctx.fill(filled)
  ctx.strokeStyle = INK
  ctx.lineWidth = LINE * unit
  ctx.stroke(stroked)
}

export const glyphHalftone: AmbientScene = { id: 'glyph-halftone', name: '記号の網点', ink: 'dark', render }
