import type { Shape } from '../../types'
import { hash12, paper, vnoise12 } from '../field.ts'
import type { AmbientFrame, AmbientScene } from '../types'

// Port of wgl.ie3.jp lab/bloom-field (2026-11-05): a domain-warped fbm field printed as a two-colour
// risograph (blue halftone and plate, red plate always a little misregistered, purple where they meet)
// with three contour lines. The field is sampled on a coarse grid as in the original; the classification
// runs per pixel at a third of the resolution instead of in a fragment shader, and the frame-to-frame
// blend and the paper grain are left out so a frame depends on t alone.
const FIELD_DIVISOR = 9
const COLS_MIN = 90
const COLS_MAX = 160
const ROWS_MIN = 60
const ROWS_MAX = 100
const FIELD_SCALE_X = 6.0
const WARP_AMOUNT_BASE = 1.55
const CYCLE_PERIOD = 24
const CYCLE_TRANSITION = 3.2
const MISREG_SHIFT_X_FACTOR = 0.004
const MISREG_SHIFT_Y_FACTOR = -0.003
const MISREG_PULSE_DURATION = 1.2
const MISREG_BASE_FACTOR = 0.0022
const DENSITY_BIAS_AMP = 0.2
const DENSITY_BIAS_FREQ = 1.3
const DENSITY_BIAS_DRIFT = 0.012
const INK = [30, 26, 20] as const
const PAPER_COLOR = [236, 231, 216] as const
const BLUE_COLOR = [39, 75, 154] as const
const RED_COLOR = [214, 58, 42] as const
const PURPLE_COLOR = [58, 31, 63] as const
const PAPER_T = 0.28
const HALFTONE_T = 0.44
const PLATE_T = 0.62
const PURPLE_T = 0.84
const HALFTONE_COVERAGE_MIN = 0.15
const HALFTONE_COVERAGE_MAX = 0.6
const HALFTONE_PITCH_FACTOR = 0.006
const BLUE_SCREEN_ANGLE = 0.78539816
const RED_SCREEN_ANGLE = 0.26179939
const RED_HALFTONE_BAND = 0.08
const RED_HALFTONE_COVERAGE_MIN = 0.2
const RED_HALFTONE_COVERAGE_MAX = 0.65
const SHADE = 3

const CTABLE: number[][][] = [
  [], [[3, 0]], [[0, 1]], [[3, 1]], [[1, 2]], [[3, 0], [1, 2]], [[0, 2]], [[3, 2]],
  [[2, 3]], [[2, 0]], [[0, 1], [2, 3]], [[2, 1]], [[1, 3]], [[1, 0]], [[0, 3]], [],
]

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function easeOut(x: number): number {
  if (x >= 1) return 1
  if (x <= 0) return 0
  return 1 - Math.pow(2, -10 * x)
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const u = fade(x - xi)
  const v = fade(y - yi)
  const n00 = hash12(xi, yi)
  const n10 = hash12(xi + 1, yi)
  const n01 = hash12(xi, yi + 1)
  const n11 = hash12(xi + 1, yi + 1)
  const nx0 = n00 + (n10 - n00) * u
  const nx1 = n01 + (n11 - n01) * u
  return nx0 + (nx1 - nx0) * v
}

function fbm(x: number, y: number, octaves: number): number {
  let amp = 0.5
  let freq = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq) * amp
    norm += amp
    amp *= 0.5
    freq *= 2.07
  }
  return sum / norm
}

function hashRand(seed: number): number {
  return hash12(seed * 12.9898, seed * 78.233)
}

function densityBias(bu: number, bv: number, t: number, seed: number): number {
  return DENSITY_BIAS_AMP * (valueNoise(bu + seed, bv + seed + t * DENSITY_BIAS_DRIFT) - 0.5)
}

function warpedField(x: number, y: number, t: number, warpAmt: number, bias: number): number {
  const wx = x + (valueNoise(x * 0.5 + t * 0.05, y * 0.5 - t * 0.03) - 0.5) * warpAmt
  const wy = y + (valueNoise(x * 0.5 - t * 0.04 + 31.4, y * 0.5 + t * 0.02 + 7.7) - 0.5) * warpAmt
  return fbm(wx * 1.15 + t * 0.09, wy * 1.15 - t * 0.07, 2) + bias
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

function cycleParams(k: number, seedX: number): { warpPulse: number; misregAngle: number; biasSeed: number } {
  const b = hashRand(k * 7.73 + 5.3)
  return {
    warpPulse: 0.3 + b * 1.9,
    misregAngle: hashRand(k * 3.17 + 11.9) * Math.PI * 2,
    biasSeed: hashRand(k * 5.41 + 2.7) * 400 + seedX * 0.37,
  }
}

interface Field {
  cols: number
  rows: number
  cellW: number
  cellH: number
  i0: number
  j0: number
  ni: number
  nj: number
  values: Float32Array
}

// The field on the coarse grid, only the nodes that cover the view (plus a margin for the red plate).
function sampleField(frame: AmbientFrame, time: number, seedX: number, seedY: number, marginPx: number): Field {
  const { width, height, view } = frame
  const cols = clamp(Math.round(width / FIELD_DIVISOR), COLS_MIN, COLS_MAX)
  const rows = clamp(Math.round(height / FIELD_DIVISOR), ROWS_MIN, ROWS_MAX)
  const cellW = width / (cols - 1)
  const cellH = height / (rows - 1)
  const i0 = clamp(Math.floor((view.x - marginPx) / cellW), 0, cols - 1)
  const j0 = clamp(Math.floor((view.y - marginPx) / cellH), 0, rows - 1)
  const i1 = clamp(Math.ceil((view.x + view.width + marginPx) / cellW) + 1, 0, cols - 1)
  const j1 = clamp(Math.ceil((view.y + view.height + marginPx) / cellH) + 1, 0, rows - 1)
  const ni = i1 - i0 + 1
  const nj = j1 - j0 + 1
  const k = Math.floor(time / CYCLE_PERIOD)
  const localT = time - k * CYCLE_PERIOD
  const cur = cycleParams(k, seedX)
  const prev = cycleParams(k - 1, seedX)
  let tt = localT < CYCLE_TRANSITION ? localT / CYCLE_TRANSITION : 1
  tt = 1 - Math.pow(1 - tt, 3)
  const warpPulse = prev.warpPulse + (cur.warpPulse - prev.warpPulse) * tt
  const wobble = Math.sin(time * 0.15) * 0.15
  const warpAmt = WARP_AMOUNT_BASE + warpPulse * 0.6 + wobble
  const fieldScaleY = FIELD_SCALE_X * (height / width)
  const S = Math.min(width, height)
  const sx = (DENSITY_BIAS_FREQ * width) / S
  const sy = (DENSITY_BIAS_FREQ * height) / S
  const values = new Float32Array(ni * nj)
  const biases = new Float32Array(ni * nj)
  let sum = 0
  let n = 0
  for (let j = 0; j < nj; j++) {
    const v = (j0 + j) / rows
    for (let i = 0; i < ni; i++) {
      const u = (i0 + i) / cols
      let bias = densityBias(u * sx, v * sy, time, cur.biasSeed)
      if (tt < 1) {
        const before = densityBias(u * sx, v * sy, time, prev.biasSeed)
        bias = before + (bias - before) * tt
      }
      biases[n++] = bias
      sum += bias
    }
  }
  const mean = sum / n
  n = 0
  for (let j = 0; j < nj; j++) {
    const v = (j0 + j) / rows
    for (let i = 0; i < ni; i++) {
      const u = (i0 + i) / cols
      values[n] = warpedField(u * FIELD_SCALE_X + seedX, v * fieldScaleY + seedY, time, warpAmt, biases[n]! - mean)
      n++
    }
  }
  return { cols, rows, cellW, cellH, i0, j0, ni, nj, values }
}

function fieldAt(f: Field, x: number, y: number): number {
  const gx = clamp(x / f.cellW - f.i0, 0, f.ni - 1.001)
  const gy = clamp(y / f.cellH - f.j0, 0, f.nj - 1.001)
  const i = Math.floor(gx)
  const j = Math.floor(gy)
  const u = gx - i
  const v = gy - j
  const a = f.values[j * f.ni + i]!
  const b = f.values[j * f.ni + i + 1]!
  const c = f.values[(j + 1) * f.ni + i]!
  const d = f.values[(j + 1) * f.ni + i + 1]!
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

function halftoneDot(px: number, py: number, pitch: number, coverage: number, angle: number): number {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const rx = px * c - py * s
  const ry = px * s + py * c
  const cx = ((rx % pitch) + pitch) % pitch - pitch * 0.5
  const cy = ((ry % pitch) + pitch) % pitch - pitch * 0.5
  const d = Math.sqrt(cx * cx + cy * cy)
  const r = pitch * Math.sqrt(clamp01(coverage) / Math.PI)
  return 1 - clamp01((d - (r - 1)) / 2)
}

function misregShift(time: number, S: number, seedX: number): [number, number] {
  const k = Math.floor(time / CYCLE_PERIOD)
  const localT = time - k * CYCLE_PERIOD
  let tt = localT < CYCLE_TRANSITION ? localT / CYCLE_TRANSITION : 1
  tt = 1 - Math.pow(1 - tt, 3)
  const angle = lerpAngle(cycleParams(k - 1, seedX).misregAngle, cycleParams(k, seedX).misregAngle, tt)
  const half = MISREG_PULSE_DURATION / 2
  const pulse = localT < half ? easeOut(localT / half) : localT < MISREG_PULSE_DURATION ? easeOut(1 - (localT - half) / half) : 0
  const base = MISREG_BASE_FACTOR * S
  return [Math.cos(angle) * base + MISREG_SHIFT_X_FACTOR * S * pulse, Math.sin(angle) * base + MISREG_SHIFT_Y_FACTOR * S * pulse]
}

function paintPlates(ctx: CanvasRenderingContext2D, frame: AmbientFrame, field: Field, shift: [number, number]): void {
  const { view } = frame
  const S = Math.min(frame.width, frame.height)
  const pitch = (S * HALFTONE_PITCH_FACTOR) / SHADE
  const w = Math.ceil(view.width / SHADE)
  const h = Math.ceil(view.height / SHADE)
  const image = ctx.createImageData(w, h)
  const data = image.data
  const redBandStart = PLATE_T - RED_HALFTONE_BAND
  let o = 0
  for (let py = 0; py < h; py++) {
    const y = view.y + (py + 0.5) * SHADE
    for (let px = 0; px < w; px++) {
      const x = view.x + (px + 0.5) * SHADE
      const v = fieldAt(field, x, y)
      const vRed = fieldAt(field, x - shift[0], y - shift[1])
      let r: number
      let g: number
      let b: number
      if (v < PAPER_T || v >= PLATE_T) {
        ;[r, g, b] = PAPER_COLOR
      } else if (v < HALFTONE_T) {
        const cov = HALFTONE_COVERAGE_MIN + (HALFTONE_COVERAGE_MAX - HALFTONE_COVERAGE_MIN) * ((v - PAPER_T) / (HALFTONE_T - PAPER_T))
        const dot = halftoneDot(px, py, pitch, cov, BLUE_SCREEN_ANGLE)
        r = PAPER_COLOR[0] + (BLUE_COLOR[0] - PAPER_COLOR[0]) * dot
        g = PAPER_COLOR[1] + (BLUE_COLOR[1] - PAPER_COLOR[1]) * dot
        b = PAPER_COLOR[2] + (BLUE_COLOR[2] - PAPER_COLOR[2]) * dot
      } else {
        ;[r, g, b] = BLUE_COLOR
      }
      const blueInkHere = v >= PAPER_T && v < PLATE_T
      let redInk = 0
      if (vRed >= PLATE_T) redInk = 1
      else if (vRed >= redBandStart) {
        const cov = RED_HALFTONE_COVERAGE_MIN + (RED_HALFTONE_COVERAGE_MAX - RED_HALFTONE_COVERAGE_MIN) * ((vRed - redBandStart) / RED_HALFTONE_BAND)
        redInk = halftoneDot(px, py, pitch, cov, RED_SCREEN_ANGLE)
      }
      if (redInk > 0) {
        const red = blueInkHere || vRed >= PURPLE_T ? PURPLE_COLOR : RED_COLOR
        r += (red[0] - r) * redInk
        g += (red[1] - g) * redInk
        b += (red[2] - b) * redInk
      }
      data[o++] = r
      data[o++] = g
      data[o++] = b
      data[o++] = 255
    }
  }
  const plate = document.createElement('canvas')
  plate.width = w
  plate.height = h
  plate.getContext('2d')!.putImageData(image, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(plate, view.x, view.y, w * SHADE, h * SHADE)
}

function drawContours(ctx: CanvasRenderingContext2D, field: Field, time: number): void {
  const levels = [
    { v: 0.3 + 0.05 * Math.sin(time * 0.11), a: 0.16, w: 1 },
    { v: 0.48 + 0.06 * Math.sin(time * 0.09 + 2), a: 0.32, w: 1.3 },
    { v: 0.66 + 0.05 * Math.sin(time * 0.13 + 4), a: 0.16, w: 1 },
  ]
  ctx.lineJoin = 'round'
  for (const level of levels) {
    const L = level.v
    ctx.strokeStyle = `rgba(${INK[0]},${INK[1]},${INK[2]},${level.a})`
    ctx.lineWidth = level.w
    ctx.beginPath()
    for (let j = 0; j < field.nj - 1; j++) {
      const y0 = (field.j0 + j) * field.cellH
      for (let i = 0; i < field.ni - 1; i++) {
        const x0 = (field.i0 + i) * field.cellW
        const a = field.values[j * field.ni + i]!
        const b = field.values[j * field.ni + i + 1]!
        const c = field.values[(j + 1) * field.ni + i + 1]!
        const d = field.values[(j + 1) * field.ni + i]!
        let ci = 0
        if (a > L) ci |= 1
        if (b > L) ci |= 2
        if (c > L) ci |= 4
        if (d > L) ci |= 8
        for (const seg of CTABLE[ci]!) {
          const p0 = edgePoint(seg[0]!, L, x0, y0, field.cellW, field.cellH, a, b, c, d)
          const p1 = edgePoint(seg[1]!, L, x0, y0, field.cellW, field.cellH, a, b, c, d)
          ctx.moveTo(p0[0], p0[1])
          ctx.lineTo(p1[0], p1[1])
        }
      }
    }
    ctx.stroke()
  }
}

function edgePoint(e: number, L: number, x0: number, y0: number, cw: number, ch: number, a: number, b: number, c: number, d: number): [number, number] {
  if (e === 0) return [x0 + ((L - a) / ((b - a) || 1e-6)) * cw, y0]
  if (e === 1) return [x0 + cw, y0 + ((L - b) / ((c - b) || 1e-6)) * ch]
  if (e === 2) return [x0 + ((L - d) / ((c - d) || 1e-6)) * cw, y0 + ch]
  return [x0, y0 + ((L - a) / ((d - a) || 1e-6)) * ch]
}

function render(ctx: CanvasRenderingContext2D, t: number, seed: number, _shape: Shape, frame: AmbientFrame): void {
  const time = t / 1000
  const seedX = (seed % 1000) + 0.5
  const seedY = ((seed * 7) % 1000) + 0.5
  const S = Math.min(frame.width, frame.height)
  const shift = misregShift(time, S, seedX)
  const field = sampleField(frame, time, seedX, seedY, Math.abs(shift[0]) + Math.abs(shift[1]) + 2)
  paper(ctx, frame, `rgb(${PAPER_COLOR[0]} ${PAPER_COLOR[1]} ${PAPER_COLOR[2]})`)
  paintPlates(ctx, frame, field, shift)
  drawContours(ctx, field, time)
}

export const inkBloom: AmbientScene = { id: 'ink-bloom', name: '滲みの網点', ink: 'dark', render }
