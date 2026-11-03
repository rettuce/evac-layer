import type { Shape } from '../../types'
import { cellRandom, cellRange, fbm, paper, sceneUnit } from '../field.ts'
import type { AmbientFrame, AmbientScene } from '../types'

const PAPER = 'rgb(240 239 234)'
const INK = 'rgb(44 56 74 / 0.26)'
const RING = 'hsl(8 62% 62% / 0.7)'
const SPACING = 30
const STEPS = 40
const STEP = 7
const LINE = 1.3
const FIELD_SCALE = 1 / 640
const VORTEX_RADIUS = 320
const VORTEX_STRENGTH = 0.9
const DRIFT_MS = 480_000
const ORBIT_MS = 900_000
const EPS = 1

interface Vortex {
  x: number
  y: number
  sign: number
}

function vortices(seed: number, frame: AmbientFrame, unit: number, t: number): Vortex[] {
  return [0, 1].map((k) => {
    const orbit = 2 * Math.PI * (t / ORBIT_MS + cellRandom(seed, -1, k, 2))
    return {
      x: (0.2 + 0.6 * cellRandom(seed, -1, k)) * frame.width + Math.cos(orbit) * 60 * unit,
      y: (0.2 + 0.6 * cellRandom(seed, -1, k, 1)) * frame.height + Math.sin(orbit) * 40 * unit,
      sign: k === 0 ? 1 : -1,
    }
  })
}

// A stream function: flow follows its level lines, so streamlines never cross.
function psi(seed: number, x: number, y: number, unit: number, drift: number, swirls: Vortex[]): number {
  let value = fbm(seed, (x / unit) * FIELD_SCALE + drift, (y / unit) * FIELD_SCALE, 2)
  for (const v of swirls) {
    const d2 = ((x - v.x) ** 2 + (y - v.y) ** 2) / (VORTEX_RADIUS * unit) ** 2
    value += v.sign * VORTEX_STRENGTH * Math.exp(-d2)
  }
  return value
}

function render(ctx: CanvasRenderingContext2D, t: number, seed: number, shape: Shape, frame: AmbientFrame): void {
  const unit = sceneUnit(frame, shape)
  const size = SPACING * unit
  const drift = t / DRIFT_MS
  const swirls = vortices(seed, frame, unit, t)
  const { i0, i1, j0, j1 } = cellRange(frame.view, size, STEPS * STEP * unit)
  paper(ctx, frame, PAPER)
  ctx.strokeStyle = INK
  ctx.lineWidth = LINE * unit
  ctx.lineCap = 'round'
  ctx.beginPath()
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      let x = (i + cellRandom(seed, i, j)) * size
      let y = (j + cellRandom(seed, i, j, 1)) * size
      ctx.moveTo(x, y)
      for (let s = 0; s < STEPS; s++) {
        const e = EPS * unit
        const vx = psi(seed, x, y + e, unit, drift, swirls) - psi(seed, x, y - e, unit, drift, swirls)
        const vy = psi(seed, x - e, y, unit, drift, swirls) - psi(seed, x + e, y, unit, drift, swirls)
        const speed = Math.hypot(vx, vy) || 1
        x += (vx / speed) * STEP * unit
        y += (vy / speed) * STEP * unit
        ctx.lineTo(x, y)
      }
    }
  }
  ctx.stroke()
  const v = swirls[0]!
  ctx.strokeStyle = RING
  ctx.lineWidth = 3 * unit
  ctx.beginPath()
  ctx.arc(v.x, v.y, 14 * unit, 0, Math.PI * 2)
  ctx.stroke()
}

export const etchedStreams: AmbientScene = { id: 'etched-streams', name: '細線の流れ', ink: 'dark', render }
