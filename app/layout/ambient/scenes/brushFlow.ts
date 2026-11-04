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
// After wgl painterly-flow: a growth front fills the paper in 12 s (ease 1 − (1 − p)^1.5), holds 2 s, then the
// next palette paints over the finished picture without wiping it.
const GROW_MS = 12_000
const HOLD_MS = 2_000
const CYCLE_MS = GROW_MS + HOLD_MS
const GROW_EASE_POW = 1.5
const STROKE_WINDOW = 0.1
const CYCLE_SEED_STRIDE = 1013

function cycleProgress(t: number): number {
  const u = ((t % CYCLE_MS) + CYCLE_MS) % CYCLE_MS
  const p = Math.min(1, u / GROW_MS)
  return 1 - (1 - p) ** GROW_EASE_POW
}

function stroke(ctx: CanvasRenderingContext2D, points: number[], lift: number, count: number): void {
  ctx.beginPath()
  ctx.moveTo(points[0]!, points[1]! - lift)
  for (let k = 2; k < count * 2; k += 2) ctx.lineTo(points[k]!, points[k + 1]! - lift)
  ctx.stroke()
}

function paintCycle(ctx: CanvasRenderingContext2D, cycle: number, progress: number, unit: number, frame: AmbientFrame, baseSeed: number): void {
  const seed = baseSeed + cycle * CYCLE_SEED_STRIDE
  const size = SPACING * unit
  const { i0, i1, j0, j1 } = cellRange(frame.view, size, (STEPS * STEP + BRUSH.max) * unit)
  const points: number[] = []
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const start = cellRandom(seed, i, j, 6) * (1 - STROKE_WINDOW)
      const share = Math.min(1, Math.max(0, (progress - start) / STROKE_WINDOW))
      if (share <= 0) continue
      let x = (i + cellRandom(seed, i, j)) * size
      let y = (j + cellRandom(seed, i, j, 1)) * size
      points.length = 0
      points.push(x, y)
      for (let k = 0; k < STEPS; k++) {
        const angle = fbm(seed, (x / unit) * FIELD_SCALE, (y / unit) * FIELD_SCALE, 2) * Math.PI * 2 * TURNS
        x += Math.cos(angle) * STEP * unit
        y += Math.sin(angle) * STEP * unit
        points.push(x, y)
      }
      const paint = PAINTS[(Math.floor(cellRandom(seed, i, j, 2) * PAINTS.length) + cycle) % PAINTS.length]!
      const width = (BRUSH.min + cellRandom(seed, i, j, 3) * (BRUSH.max - BRUSH.min)) * unit
      const count = Math.max(2, Math.round(share * (STEPS + 1)))
      ctx.strokeStyle = paint.body
      ctx.lineWidth = width
      stroke(ctx, points, 0, count)
      ctx.strokeStyle = paint.crest
      ctx.lineWidth = width * CREST_WIDTH
      stroke(ctx, points, width * CREST_LIFT, count)
    }
  }
}

function render(ctx: CanvasRenderingContext2D, t: number, seed: number, shape: Shape, frame: AmbientFrame): void {
  const unit = sceneUnit(frame, shape)
  const cycle = Math.floor(t / CYCLE_MS)
  paper(ctx, frame, PAPER)
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'round'
  if (cycle > 0) paintCycle(ctx, cycle - 1, 1, unit, frame, seed)
  paintCycle(ctx, cycle, cycleProgress(t), unit, frame, seed)
}

export const brushFlow: AmbientScene = { id: 'brush-flow', name: '筆の流れ', ink: 'dark', render }
