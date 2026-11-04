import type { Shape } from '../../types'
import { cellRandom, cellRange, fbm, paper, sceneUnit, tint } from '../field.ts'
import type { AmbientFrame, AmbientScene } from '../types'

const PAPER = 'rgb(17 19 23)'
const INK = 'rgb(226 231 240 / 0.42)'
const RING = tint(8, 62, 62, 0.9)
const SPACING = 38
const STEPS = 24
const STEP = 9
const LINE = 1.3
const FIELD_SCALE = 1 / 640
const VORTEX_RADIUS = 320
const VORTEX_STRENGTH = 0.9
const DRIFT_MS = 60_000
const ORBIT_MS = 90_000
const DASH_ON = 28
const DASH_OFF = 14
const DASH_SPEED_PX_S = 90

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

const LATTICE = 16

// The stream function is sampled once per frame on a lattice fixed to canvas coordinates and the flow
// is interpolated from it, so every screen cut from a room traces the same lines at a fraction of the cost.
function velocityField(seed: number, unit: number, drift: number, swirls: Vortex[], c0: number, r0: number, columns: number, rows: number) {
  const step = LATTICE * unit
  const values = new Float64Array((columns + 1) * (rows + 1))
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= columns; c++) values[r * (columns + 1) + c] = psi(seed, (c0 + c) * step, (r0 + r) * step, unit, drift, swirls)
  const at = (c: number, r: number) => values[Math.min(rows, Math.max(0, r - r0)) * (columns + 1) + Math.min(columns, Math.max(0, c - c0))]!
  return (x: number, y: number): [number, number] => {
    const fx = x / step
    const fy = y / step
    const c = Math.floor(fx)
    const r = Math.floor(fy)
    const u = fx - c
    const v = fy - r
    const dx0 = at(c + 1, r) - at(c, r)
    const dx1 = at(c + 1, r + 1) - at(c, r + 1)
    const dy0 = at(c, r + 1) - at(c, r)
    const dy1 = at(c + 1, r + 1) - at(c + 1, r)
    return [dy0 + (dy1 - dy0) * u, -(dx0 + (dx1 - dx0) * v)]
  }
}

function render(ctx: CanvasRenderingContext2D, t: number, seed: number, shape: Shape, frame: AmbientFrame): void {
  const unit = sceneUnit(frame, shape)
  const size = SPACING * unit
  const reach = STEPS * STEP * unit
  const drift = t / DRIFT_MS
  const swirls = vortices(seed, frame, unit, t)
  const lattice = LATTICE * unit
  const c0 = Math.floor((frame.view.x - reach - size) / lattice)
  const r0 = Math.floor((frame.view.y - reach - size) / lattice)
  const columns = Math.ceil((frame.view.x + frame.view.width + reach + size) / lattice) - c0
  const rows = Math.ceil((frame.view.y + frame.view.height + reach + size) / lattice) - r0
  const flow = velocityField(seed, unit, drift, swirls, c0, r0, columns, rows)
  const { i0, i1, j0, j1 } = cellRange(frame.view, size, reach)
  paper(ctx, frame, PAPER)
  ctx.strokeStyle = INK
  ctx.lineWidth = LINE * unit
  ctx.lineCap = 'round'
  ctx.setLineDash([DASH_ON * unit, DASH_OFF * unit])
  ctx.lineDashOffset = -((t / 1000) * DASH_SPEED_PX_S * unit) % ((DASH_ON + DASH_OFF) * unit)
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      let x = (i + cellRandom(seed, i, j)) * size
      let y = (j + cellRandom(seed, i, j, 1)) * size
      ctx.beginPath()
      ctx.moveTo(x, y)
      for (let s = 0; s < STEPS; s++) {
        const [vx, vy] = flow(x, y)
        const speed = Math.hypot(vx, vy) || 1
        x += (vx / speed) * STEP * unit
        y += (vy / speed) * STEP * unit
        ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }
  ctx.setLineDash([])
  const v = swirls[0]!
  ctx.strokeStyle = RING
  ctx.lineWidth = 3 * unit
  ctx.beginPath()
  ctx.arc(v.x, v.y, 14 * unit, 0, Math.PI * 2)
  ctx.stroke()
}

export const etchedStreams: AmbientScene = { id: 'etched-streams', name: '細線の流れ', ink: 'light', render }
