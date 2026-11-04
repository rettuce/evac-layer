import type { Shape } from '../../types'
import { cellRange, fbm, paper, sceneUnit, tint } from '../field.ts'
import type { AmbientFrame, AmbientScene } from '../types'

const PAPER = 'rgb(242 239 232)'
const COOL = tint(220, 42, 70, 0.55)
const WARM = tint(10, 62, 74, 0.55)
const CELL = 12
const FIELD_SCALE = 1 / 520
const COOL_FROM = 0.46
const WARM_FROM = 0.6
const RAMP = 0.07
// After wgl bloom-field: the dense and the paper-rich areas move to new places every 24 s, cross-fading in
// 3.2 s, while the whole field flows slowly all the time.
const CYCLE_MS = 24_000
const CYCLE_BLEND_MS = 3_200
const DRIFT_MS = 90_000
const CYCLE_SEED_STRIDE = 1013

function radius(value: number, from: number, cell: number): number {
  return (cell / 2) * Math.min(1, Math.max(0, (value - from) / RAMP)) * 1.1
}

function smoothstep(x: number): number {
  const u = Math.min(1, Math.max(0, x))
  return u * u * (3 - 2 * u)
}

function render(ctx: CanvasRenderingContext2D, t: number, seed: number, shape: Shape, frame: AmbientFrame): void {
  const unit = sceneUnit(frame, shape)
  const cell = CELL * unit
  const drift = t / DRIFT_MS
  const cycle = Math.floor(t / CYCLE_MS)
  const blend = smoothstep((t - cycle * CYCLE_MS) / CYCLE_BLEND_MS)
  const seedA = seed + (cycle - 1) * CYCLE_SEED_STRIDE
  const seedB = seed + cycle * CYCLE_SEED_STRIDE
  const { i0, i1, j0, j1 } = cellRange(frame.view, cell)
  paper(ctx, frame, PAPER)
  const cool = new Path2D()
  const warm = new Path2D()
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const x = i * CELL * FIELD_SCALE + drift
      const y = j * CELL * FIELD_SCALE + drift * 0.7
      const value = blend >= 1 ? fbm(seedB, x, y, 3) : fbm(seedA, x, y, 3) * (1 - blend) + fbm(seedB, x, y, 3) * blend
      if (value < COOL_FROM) continue
      const cx = (i + 0.5) * cell
      const cy = (j + 0.5) * cell
      const path = value >= WARM_FROM ? warm : cool
      const r = value >= WARM_FROM ? radius(value, WARM_FROM, cell) : radius(value, COOL_FROM, cell)
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
