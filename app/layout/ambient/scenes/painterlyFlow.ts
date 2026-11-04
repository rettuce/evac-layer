import type { Shape } from '../../types'
import { vnoise12 } from '../field.ts'
import { hashString, mulberry32 } from '../rng.ts'
import type { AmbientFrame, AmbientRect, AmbientScene } from '../types'

// Port of wgl lab/painterly-flow (2026-10-08 brush-up): broad strokes laid along a domain-warped simplex flow
// field in three layers (block-in, middle, fine), each cycle painting over the last without wiping. The wgl
// sketch accumulates into one canvas frame by frame; here the picture at time t is rebuilt from the same
// order of strokes (two finished cycles, then the current one up to its eased progress), so it depends on t
// alone, and every view keeps its own accumulation buffer so a room drawn in tiles matches one drawn whole.

interface HSL {
  h: number
  s: number
  l: number
}
interface Palette {
  colors: HSL[]
  weights: number[]
  accent: HSL
}

const PALETTES: Palette[] = [
  { colors: [{ h: 180, s: 45, l: 38 }, { h: 168, s: 40, l: 48 }, { h: 12, s: 72, l: 60 }, { h: 42, s: 68, l: 62 }, { h: 200, s: 40, l: 26 }], weights: [3, 2, 2, 1.5, 2], accent: { h: 352, s: 75, l: 55 } },
  { colors: [{ h: 218, s: 55, l: 32 }, { h: 208, s: 60, l: 46 }, { h: 196, s: 40, l: 66 }, { h: 14, s: 68, l: 52 }, { h: 38, s: 72, l: 58 }], weights: [4, 3, 2, 2.2, 1], accent: { h: 346, s: 70, l: 52 } },
  { colors: [{ h: 26, s: 70, l: 46 }, { h: 34, s: 62, l: 58 }, { h: 74, s: 30, l: 40 }, { h: 20, s: 45, l: 28 }, { h: 96, s: 18, l: 52 }], weights: [3, 2.5, 2, 2, 1.2], accent: { h: 190, s: 55, l: 40 } },
  { colors: [{ h: 330, s: 55, l: 30 }, { h: 342, s: 60, l: 46 }, { h: 28, s: 80, l: 56 }, { h: 356, s: 55, l: 60 }, { h: 348, s: 50, l: 24 }], weights: [3, 2, 1.8, 2, 1.5], accent: { h: 186, s: 60, l: 38 } },
  { colors: [{ h: 176, s: 55, l: 28 }, { h: 168, s: 45, l: 44 }, { h: 150, s: 35, l: 66 }, { h: 16, s: 55, l: 60 }, { h: 8, s: 50, l: 72 }], weights: [3, 2.5, 2, 2, 1.5], accent: { h: 40, s: 80, l: 55 } },
  { colors: [{ h: 245, s: 40, l: 34 }, { h: 218, s: 45, l: 46 }, { h: 205, s: 25, l: 58 }, { h: 40, s: 78, l: 56 }, { h: 16, s: 62, l: 48 }], weights: [3.5, 3, 2, 1.5, 1.5], accent: { h: 338, s: 62, l: 56 } },
]

const GROW_MS = 12_000
const HOLD_MS = 2_000
const CYCLE_MS = GROW_MS + HOLD_MS
const GROW_EASE_POW = 1.5
const FINISHED_CYCLES_UNDER = 2

const LAYERS = 3
const LAYER_WIDTH_SCALE = [1.7, 1.15, 0.7]
const LAYER_SPACING_SCALE = [1.25, 1.0, 0.82]
const LAYER_LEN_SCALE = [1.15, 1.0, 0.88]
const LAYER_ALPHA = [0.99, 0.92, 0.85]
const LAYER_STRIATE = [false, true, true]

const FIELD_SCALE_MIN = 0.7
const FIELD_SCALE_MAX = 1.2
const FIELD_TURB_MIN = 0.9
const FIELD_TURB_MAX = 1.4
const STEP_LEN = 0.006
const MAX_STEPS = 120
const LEN_MIN = 0.08
const LEN_MAX = 0.7
const LEN_SHORT_BIAS = 2
const W_MIN = 0.01
const W_MAX = 0.06
const TAPER_START_MIN = 0.15
const TAPER_START_MAX = 0.55

const SEED_SPACING = 0.052
const SEED_MARGIN = 0.09

const REGION_SCALE = 0.85
const ACCENT_PROB = 0.035
const HUE_JITTER = 5
const SAT_JITTER = 7
const LIT_JITTER = 9

const GROUND_WHITE = '#ffffff'

const STRI_FRACS = [-0.72, -0.43, -0.16, 0.16, 0.43, 0.72]
const STRI_ALPHA = 0.22
const STRI_EDGE_ALPHA = 0.32
const STRI_EDGE_FRAC = 0.72
const STRI_SHADE = 14
const STRI_W_FRAC = 0.3

const DRY_BRUSH_START = 0.7
const DRY_BRUSH_OFFSETS = [-0.75, -0.25, 0.25, 0.75]
const DRY_BRUSH_HALF = 0.18
const DRY_BRUSH_ALPHA = 0.75
const DRY_BRUSH_ALPHA_AT = 0.35

const WEAVE_PERIOD_PX = 3
const WEAVE_AMP = 0.03
const THREAD_CELL_PX = 2
const THREAD_AMP = 0.02

const AA_MARGIN_PX = 2
const MAX_CACHED_CYCLES = 4
const MAX_CACHED_VIEWS = 160

interface Stroke {
  xs: Float32Array
  ys: Float32Array
  nx: Float32Array
  ny: Float32Array
  hw: Float32Array
  col: HSL
  alpha: number
  striate: boolean
  box: AmbientRect
}

// 2D simplex noise (Gustavson) on a permutation shuffled by the scene seed; the wgl sketch uses simplex-noise
// seeded by alea, which this replaces without a dependency.
function createNoise2D(random: () => number): (x: number, y: number) => number {
  const perm = new Uint8Array(512)
  const p = new Uint8Array(256)
  for (let i = 0; i < 256; i++) p[i] = i
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[p[i], p[j]] = [p[j]!, p[i]!]
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]!
  const GX = [1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0]
  const GY = [1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1]
  const F2 = 0.5 * (Math.sqrt(3) - 1)
  const G2 = (3 - Math.sqrt(3)) / 6
  return (x, y) => {
    const s = (x + y) * F2
    const i = Math.floor(x + s)
    const j = Math.floor(y + s)
    const t = (i + j) * G2
    const x0 = x - (i - t)
    const y0 = y - (j - t)
    const i1 = x0 > y0 ? 1 : 0
    const j1 = x0 > y0 ? 0 : 1
    const x1 = x0 - i1 + G2
    const y1 = y0 - j1 + G2
    const x2 = x0 - 1 + 2 * G2
    const y2 = y0 - 1 + 2 * G2
    const ii = i & 255
    const jj = j & 255
    let n = 0
    let t0 = 0.5 - x0 * x0 - y0 * y0
    if (t0 > 0) {
      const g = perm[ii + perm[jj]!]! % 12
      t0 *= t0
      n += t0 * t0 * (GX[g]! * x0 + GY[g]! * y0)
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1
    if (t1 > 0) {
      const g = perm[ii + i1 + perm[jj + j1]!]! % 12
      t1 *= t1
      n += t1 * t1 * (GX[g]! * x1 + GY[g]! * y1)
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2
    if (t2 > 0) {
      const g = perm[ii + 1 + perm[jj + 1]!]! % 12
      t2 *= t2
      n += t2 * t2 * (GX[g]! * x2 + GY[g]! * y2)
    }
    return 70 * n
  }
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}
function hslStr(c: HSL, a: number): string {
  const h = ((c.h % 360) + 360) % 360
  return `hsla(${h.toFixed(1)},${c.s.toFixed(1)}%,${c.l.toFixed(1)}%,${a.toFixed(3)})`
}

function paletteIndex(seed: number, cycle: number): number {
  const pick = (k: number) => Math.floor(mulberry32(hashString(`${seed}:${k}:palette`))() * PALETTES.length)
  const idx = pick(cycle)
  return idx === pick(cycle - 1) ? (idx + 1) % PALETTES.length : idx
}

// One cycle's strokes in painting order (layer by layer, each sorted along the growth direction).
function buildCycle(seed: number, cycle: number, width: number, height: number): Stroke[] {
  const random = mulberry32(hashString(`${seed}:${cycle}:painterly`))
  const noise2D = createNoise2D(mulberry32(hashString(`${seed}:painterly-noise`)))
  const short = Math.min(width, height)
  const pal = PALETTES[paletteIndex(seed, cycle)]!
  const fSeedX = random() * 1000 - 500
  const fSeedY = random() * 1000 - 500
  const rSeedX = random() * 1000 - 500
  const rSeedY = random() * 1000 - 500
  const fieldScale = FIELD_SCALE_MIN + random() * (FIELD_SCALE_MAX - FIELD_SCALE_MIN)
  const fieldTurb = FIELD_TURB_MIN + random() * (FIELD_TURB_MAX - FIELD_TURB_MIN)
  const fAngleBias = random() * Math.PI * 2
  const ga = random() * Math.PI * 2
  const gdx = Math.cos(ga)
  const gdy = Math.sin(ga)

  const fbm2 = (x: number, y: number) => noise2D(x, y) * 0.6 + noise2D(x * 2.03 + 5.2, y * 2.03 - 3.1) * 0.3 + noise2D(x * 4.1 - 9.0, y * 4.1 + 7.5) * 0.1
  const angleAt = (px: number, py: number) => {
    const nx = (px / short) * fieldScale + fSeedX
    const ny = (py / short) * fieldScale + fSeedY
    const w = fbm2(nx * 0.5, ny * 0.5)
    return fbm2(nx + w * 0.8, ny + w * 0.8) * Math.PI * 2 * fieldTurb + fAngleBias
  }
  const jitterHSL = (c: HSL): HSL => ({
    h: c.h + (random() - 0.5) * 2 * HUE_JITTER,
    s: clamp(c.s + (random() - 0.5) * 2 * SAT_JITTER, 0, 100),
    l: clamp(c.l + (random() - 0.5) * 2 * LIT_JITTER, 0, 100),
  })
  const regionColor = (px: number, py: number): HSL => {
    if (random() < ACCENT_PROB) return jitterHSL(pal.accent)
    const nx = (px / short) * REGION_SCALE + rSeedX
    const ny = (py / short) * REGION_SCALE + rSeedY
    const v = (noise2D(nx, ny) * 0.7 + noise2D(nx * 2.1 + 4.0, ny * 2.1 - 2.0) * 0.3 + 1) * 0.5
    const total = pal.weights.reduce((sum, w) => sum + w, 0)
    let acc = 0
    let pick = pal.colors.length - 1
    for (let k = 0; k < pal.colors.length; k++) {
      acc += pal.weights[k]!
      if (v * total <= acc) {
        pick = k
        break
      }
    }
    return jitterHSL(pal.colors[pick]!)
  }

  const margin = SEED_MARGIN * short
  const queue: { x: number; y: number; layer: number }[] = []
  for (let layer = 0; layer < LAYERS; layer++) {
    const sp = SEED_SPACING * LAYER_SPACING_SCALE[layer]! * short
    const seeds: { x: number; y: number; key: number }[] = []
    for (let y = -margin; y <= height + margin; y += sp) {
      for (let x = -margin; x <= width + margin; x += sp) {
        const jx = x + (random() - 0.5) * sp
        const jy = y + (random() - 0.5) * sp
        const key = (jx * gdx + jy * gdy) / short + noise2D((jx / short) * 2.0, (jy / short) * 2.0) * 0.18
        seeds.push({ x: jx, y: jy, key })
      }
    }
    seeds.sort((a, b) => a.key - b.key)
    for (const s of seeds) queue.push({ x: s.x, y: s.y, layer })
  }

  const strokes: Stroke[] = []
  const stepPx = STEP_LEN * short
  const bound = SEED_MARGIN * short * 1.5
  for (const item of queue) {
    const layer = item.layer
    const length = (LEN_MIN + Math.pow(random(), LEN_SHORT_BIAS) * (LEN_MAX - LEN_MIN)) * LAYER_LEN_SCALE[layer]! * short
    const taperStart = TAPER_START_MIN + random() * (TAPER_START_MAX - TAPER_START_MIN)
    const steps = Math.min(MAX_STEPS, Math.max(4, Math.round(length / stepPx)))
    const baseHalf = (W_MIN + random() * (W_MAX - W_MIN)) * LAYER_WIDTH_SCALE[layer]! * short * 0.5
    const xsList: number[] = []
    const ysList: number[] = []
    let x = item.x
    let y = item.y
    for (let i = 0; i < steps; i++) {
      xsList.push(x)
      ysList.push(y)
      const a = angleAt(x, y)
      x += Math.cos(a) * stepPx
      y += Math.sin(a) * stepPx
      if (x < -bound || x > width + bound || y < -bound || y > height + bound) break
    }
    const n = xsList.length
    const col = regionColor(item.x, item.y)
    if (n < 2) continue
    const xs = Float32Array.from(xsList)
    const ys = Float32Array.from(ysList)
    const nx = new Float32Array(n)
    const ny = new Float32Array(n)
    const hw = new Float32Array(n)
    let maxHw = 0
    for (let i = 0; i < n; i++) {
      const ia = Math.max(0, i - 1)
      const ib = Math.min(n - 1, i + 1)
      let dx = xs[ib]! - xs[ia]!
      let dy = ys[ib]! - ys[ia]!
      const len = Math.hypot(dx, dy) || 1
      dx /= len
      dy /= len
      nx[i] = -dy
      ny[i] = dx
      const t = i / (n - 1)
      const taper = (taperStart + (1 - taperStart) * smoothstep(0, 0.25, t)) * smoothstep(1.0, 0.7, t)
      const wob = 1 + 0.22 * noise2D((xs[i]! / short) * 3.0 + 50, t * 4.0)
      hw[i] = baseHalf * taper * wob
      maxHw = Math.max(maxHw, hw[i]!)
    }
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (let i = 0; i < n; i++) {
      x0 = Math.min(x0, xs[i]!)
      y0 = Math.min(y0, ys[i]!)
      x1 = Math.max(x1, xs[i]!)
      y1 = Math.max(y1, ys[i]!)
    }
    const pad = maxHw + AA_MARGIN_PX
    strokes.push({ xs, ys, nx, ny, hw, col, alpha: LAYER_ALPHA[layer]!, striate: LAYER_STRIATE[layer]!, box: { x: x0 - pad, y: y0 - pad, width: x1 - x0 + 2 * pad, height: y1 - y0 + 2 * pad } })
  }
  return strokes
}

const cycleCache = new Map<string, Stroke[]>()
function cycleStrokes(seed: number, cycle: number, width: number, height: number): Stroke[] {
  const key = `${seed}:${cycle}:${width}x${height}`
  let strokes = cycleCache.get(key)
  if (!strokes) {
    strokes = buildCycle(seed, cycle, width, height)
    cycleCache.set(key, strokes)
    if (cycleCache.size > MAX_CACHED_CYCLES) cycleCache.delete(cycleCache.keys().next().value!)
  }
  return strokes
}

function traceRibbon(ctx: CanvasRenderingContext2D, st: Stroke, from: number, to: number, offset: number, half: number): void {
  ctx.beginPath()
  for (let i = from; i <= to; i++) {
    const k = (offset + half) * st.hw[i]!
    if (i === from) ctx.moveTo(st.xs[i]! + st.nx[i]! * k, st.ys[i]! + st.ny[i]! * k)
    else ctx.lineTo(st.xs[i]! + st.nx[i]! * k, st.ys[i]! + st.ny[i]! * k)
  }
  for (let i = to; i >= from; i--) {
    const k = (offset - half) * st.hw[i]!
    ctx.lineTo(st.xs[i]! + st.nx[i]! * k, st.ys[i]! + st.ny[i]! * k)
  }
  ctx.closePath()
}

function paintDryBrush(ctx: CanvasRenderingContext2D, st: Stroke, from: number): void {
  const last = st.xs.length - 1
  const a0 = st.alpha * DRY_BRUSH_ALPHA
  const dx = st.xs[last]! - st.xs[from]!
  const dy = st.ys[last]! - st.ys[from]!
  if (dx * dx + dy * dy < 1) {
    ctx.fillStyle = hslStr(st.col, a0)
  } else {
    const g = ctx.createLinearGradient(st.xs[from]!, st.ys[from]!, st.xs[last]!, st.ys[last]!)
    g.addColorStop(0, hslStr(st.col, st.alpha))
    g.addColorStop(DRY_BRUSH_ALPHA_AT, hslStr(st.col, a0))
    g.addColorStop(1, hslStr(st.col, 0))
    ctx.fillStyle = g
  }
  for (const off of DRY_BRUSH_OFFSETS) {
    traceRibbon(ctx, st, from, last, off, DRY_BRUSH_HALF)
    ctx.fill()
  }
}

function paintStroke(ctx: CanvasRenderingContext2D, st: Stroke): void {
  const n = st.xs.length
  const bodyEnd = st.striate ? Math.max(1, Math.round(DRY_BRUSH_START * (n - 1))) : n - 1
  traceRibbon(ctx, st, 0, bodyEnd, 0, 1)
  ctx.fillStyle = hslStr(st.col, st.alpha)
  ctx.fill()
  if (!st.striate) return
  if (bodyEnd < n - 1) paintDryBrush(ctx, st, bodyEnd)
  let avgHw = 0
  for (let i = 0; i < n; i++) avgHw += st.hw[i]!
  avgHw /= n
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(1.0, avgHw * STRI_W_FRAC)
  for (const fr of STRI_FRACS) {
    ctx.beginPath()
    for (let i = 0; i <= bodyEnd; i++) {
      const x = st.xs[i]! + st.nx[i]! * fr * st.hw[i]!
      const y = st.ys[i]! + st.ny[i]! * fr * st.hw[i]!
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = hslStr({ h: st.col.h, s: st.col.s, l: clamp(st.col.l + fr * STRI_SHADE, 0, 100) }, Math.abs(fr) >= STRI_EDGE_FRAC ? STRI_EDGE_ALPHA : STRI_ALPHA)
    ctx.stroke()
  }
}

const touches = (a: AmbientRect, b: AmbientRect): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

function paintRange(ctx: CanvasRenderingContext2D, strokes: Stroke[], from: number, to: number, view: AmbientRect): void {
  for (let i = from; i < to; i++) {
    const st = strokes[i]!
    if (touches(st.box, view)) paintStroke(ctx, st)
  }
}

// The paint of one view: an off-screen canvas in canvas coordinates holding everything laid down so far.
interface Buffer {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  cycle: number
  drawn: number
}
const buffers = new Map<string, Buffer>()

function bufferFor(key: string, view: AmbientRect): Buffer {
  let buffer = buffers.get(key)
  if (!buffer) {
    const canvas = document.createElement('canvas')
    canvas.width = view.width
    canvas.height = view.height
    const ctx = canvas.getContext('2d')!
    ctx.translate(-view.x, -view.y)
    buffer = { canvas, ctx, cycle: Number.NaN, drawn: 0 }
    buffers.set(key, buffer)
    if (buffers.size > MAX_CACHED_VIEWS) buffers.delete(buffers.keys().next().value!)
  }
  return buffer
}

function strokesDue(count: number, local: number): number {
  const prog = Math.min(local / GROW_MS, 1)
  return Math.floor((1 - Math.pow(1 - prog, GROW_EASE_POW)) * count)
}

function paint(t: number, seed: number, frame: AmbientFrame): HTMLCanvasElement {
  const { view } = frame
  const cycle = Math.floor(t / CYCLE_MS)
  const local = t - cycle * CYCLE_MS
  const buffer = bufferFor(`${seed}:${frame.width}x${frame.height}:${view.x},${view.y},${view.width},${view.height}`, view)
  const current = cycleStrokes(seed, cycle, frame.width, frame.height)
  const due = strokesDue(current.length, local)
  if (buffer.cycle !== cycle || due < buffer.drawn) {
    buffer.ctx.fillStyle = GROUND_WHITE
    buffer.ctx.fillRect(view.x, view.y, view.width, view.height)
    for (let k = cycle - FINISHED_CYCLES_UNDER; k < cycle; k++) {
      const done = cycleStrokes(seed, k, frame.width, frame.height)
      paintRange(buffer.ctx, done, 0, done.length, view)
    }
    buffer.cycle = cycle
    buffer.drawn = 0
  }
  paintRange(buffer.ctx, current, buffer.drawn, due, view)
  buffer.drawn = due
  return buffer.canvas
}

// The linen of the display shader: a 3 px sine weave and 2 px thread noise multiplied over the paint, in
// canvas pixels so neighbouring views line up.
function weave(ctx: CanvasRenderingContext2D, view: AmbientRect): void {
  const m = ctx.getTransform()
  const dx = Math.round(m.e + view.x * m.a)
  const dy = Math.round(m.f + view.y * m.d)
  const image = ctx.getImageData(dx, dy, view.width, view.height)
  const data = image.data
  const k = (2 * Math.PI) / WEAVE_PERIOD_PX
  const sinX = new Float32Array(view.width)
  for (let x = 0; x < view.width; x++) sinX[x] = Math.sin((view.x + x + 0.5) * k)
  let o = 0
  for (let y = 0; y < view.height; y++) {
    const fy = view.y + y + 0.5
    const sinY = Math.sin(fy * k)
    for (let x = 0; x < view.width; x++) {
      const fx = view.x + x + 0.5
      const f = (1 - WEAVE_AMP * sinX[x]! * sinY) * (1 + THREAD_AMP * 2 * (vnoise12(fx / THREAD_CELL_PX, fy / THREAD_CELL_PX) - 0.5))
      data[o] = data[o]! * f
      data[o + 1] = data[o + 1]! * f
      data[o + 2] = data[o + 2]! * f
      o += 4
    }
  }
  ctx.putImageData(image, dx, dy)
}

function render(ctx: CanvasRenderingContext2D, t: number, seed: number, _shape: Shape, frame: AmbientFrame): void {
  const { view } = frame
  ctx.drawImage(paint(t, seed, frame), view.x, view.y)
  weave(ctx, view)
}

export const painterlyFlow: AmbientScene = { id: 'painterly-flow', name: '厚塗りの流れ', ink: 'dark', render }
