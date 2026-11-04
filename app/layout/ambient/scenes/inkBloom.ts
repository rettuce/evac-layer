import type { Shape } from '../../types'
import { cellRange, fbm, paper, sceneUnit, tint, wave } from '../field.ts'
import type { AmbientFrame, AmbientScene } from '../types'

const PAPER = 'rgb(242 239 232)'
const COOL = tint(220, 42, 70, 0.55)
const WARM = tint(10, 62, 74, 0.55)
const CELL = 12
const FIELD_SCALE = 1 / 520
const DRIFT_MS = 12_000
const COOL_FROM = 0.46
const WARM_FROM = 0.6
const RAMP = 0.07
const SWELL = 0.05
const SWELL_MS = 6_000

function radius(value: number, from: number, cell: number): number {
  return (cell / 2) * Math.min(1, Math.max(0, (value - from) / RAMP)) * 1.1
}

function render(ctx: CanvasRenderingContext2D, t: number, seed: number, shape: Shape, frame: AmbientFrame): void {
  const unit = sceneUnit(frame, shape)
  const cell = CELL * unit
  const drift = t / DRIFT_MS
  const swell = SWELL * wave(t, SWELL_MS)
  const coolFrom = COOL_FROM - swell
  const warmFrom = WARM_FROM - swell
  const { i0, i1, j0, j1 } = cellRange(frame.view, cell)
  paper(ctx, frame, PAPER)
  const cool = new Path2D()
  const warm = new Path2D()
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const value = fbm(seed, i * CELL * FIELD_SCALE + drift, j * CELL * FIELD_SCALE + drift * 0.7, 3)
      if (value < coolFrom) continue
      const cx = (i + 0.5) * cell
      const cy = (j + 0.5) * cell
      const path = value >= warmFrom ? warm : cool
      const r = value >= warmFrom ? radius(value, warmFrom, cell) : radius(value, coolFrom, cell)
      if (r < 0.3) continue
      path.moveTo(cx + r, cy)
      path.arc(cx, cy, r, 0, Math.PI * 2)
    }
  }
  ctx.fillStyle = COOL
  ctx.fill(cool)
  ctx.fillStyle = WARM
  ctx.fill(warm)
}

export const inkBloom: AmbientScene = { id: 'ink-bloom', name: '滲みの網点', ink: 'dark', render }
