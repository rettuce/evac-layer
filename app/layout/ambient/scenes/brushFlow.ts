import type { Shape } from '../../types'
import { cellRandom, cellRange, fbm, paper, sceneUnit, tint } from '../field.ts'
import type { AmbientFrame, AmbientScene } from '../types'

const PAPER = 'rgb(236 230 219)'
const PAINTS = [
  { body: tint(214, 36, 56), crest: tint(214, 30, 68, 0.5) },
  { body: tint(224, 30, 42), crest: tint(224, 24, 56, 0.5) },
  { body: tint(40, 46, 60), crest: tint(44, 44, 74, 0.5) },
  { body: tint(352, 36, 62), crest: tint(352, 32, 74, 0.5) },
  { body: tint(204, 24, 76), crest: tint(204, 20, 86, 0.5) },
  { body: tint(36, 26, 86), crest: tint(36, 22, 93, 0.5) },
]
const SPACING = 56
const STEPS = 12
const STEP = 14
const BRUSH = { min: 24, max: 48 }
const CREST_WIDTH = 0.3
const CREST_LIFT = 0.2
const FIELD_SCALE = 1 / 520
const TURNS = 2
const DRIFT_MS = 40_000
const CYCLE_MS = { min: 4_000, max: 8_000 }
const HOLD = 0.35

function stroke(ctx: CanvasRenderingContext2D, points: number[], lift: number, count: number): void {
  ctx.beginPath()
  ctx.moveTo(points[0]!, points[1]! - lift)
  for (let k = 2; k < count * 2; k += 2) ctx.lineTo(points[k]!, points[k + 1]! - lift)
  ctx.stroke()
}

// 0 → 1 while the stroke draws on, 1 while it holds, then back to 0 as it lifts off.
function drawnShare(t: number, periodMs: number, phase: number): number {
  const u = (((t / periodMs + phase) % 1) + 1) % 1
  const edge = (1 - HOLD) / 2
  if (u < edge) return u / edge
  if (u > 1 - edge) return (1 - u) / edge
  return 1
}

function render(ctx: CanvasRenderingContext2D, t: number, seed: number, shape: Shape, frame: AmbientFrame): void {
  const unit = sceneUnit(frame, shape)
  const size = SPACING * unit
  const drift = t / DRIFT_MS
  const { i0, i1, j0, j1 } = cellRange(frame.view, size, (STEPS * STEP + BRUSH.max) * unit)
  paper(ctx, frame, PAPER)
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'round'
  const points: number[] = []
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      let x = (i + cellRandom(seed, i, j)) * size
      let y = (j + cellRandom(seed, i, j, 1)) * size
      points.length = 0
      points.push(x, y)
      for (let s = 0; s < STEPS; s++) {
        const angle = fbm(seed, (x / unit) * FIELD_SCALE + drift, (y / unit) * FIELD_SCALE - drift * 0.5, 2) * Math.PI * 2 * TURNS
        x += Math.cos(angle) * STEP * unit
        y += Math.sin(angle) * STEP * unit
        points.push(x, y)
      }
      const paint = PAINTS[Math.floor(cellRandom(seed, i, j, 2) * PAINTS.length)]!
      const width = (BRUSH.min + cellRandom(seed, i, j, 3) * (BRUSH.max - BRUSH.min)) * unit
      const period = CYCLE_MS.min + cellRandom(seed, i, j, 4) * (CYCLE_MS.max - CYCLE_MS.min)
      const count = Math.max(2, Math.round(drawnShare(t, period, cellRandom(seed, i, j, 5)) * (STEPS + 1)))
      ctx.strokeStyle = paint.body
      ctx.lineWidth = width
      stroke(ctx, points, 0, count)
      ctx.strokeStyle = paint.crest
      ctx.lineWidth = width * CREST_WIDTH
      stroke(ctx, points, width * CREST_LIFT, count)
    }
  }
}

export const brushFlow: AmbientScene = { id: 'brush-flow', name: '筆の流れ', ink: 'dark', render }
