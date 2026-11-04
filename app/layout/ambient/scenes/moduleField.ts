import type { Shape } from '../../types'
import { cubicBezier, hash12, paper } from '../field.ts'
import { mulberry32 } from '../rng.ts'
import type { AmbientFrame, AmbientRect, AmbientScene } from '../types'

// Port of wgl.ie3.jp lab/module-field (origin/main 2026-11-05): fifteen geometric modules on paper white
// with registration crosses, one red cell and a 2×2 hero of breathing dots whose mask changes every 30 s;
// single cells draw off and on again (every fourth event a whole row or column in a chain, three in ten
// a zoom to a corner or a 2×2 quad), and every 15 s every cell is redrawn with a random delay. The
// original schedules its events with a running random stream and keeps a static buffer; here the events
// of each 15 s period and every rule come from hashes of the period and the cell, so a frame depends on
// t alone, and the paper grain is left out.
const CELLS_ACROSS = 6.2
const CELL_MIN = 72
const CELL_MAX = 150
const GUTTER_RATIO = 0.12
const CROSS_ARM_RATIO = 0.028
const CROSS_LINE_WIDTH = 1
const CELL_PAD_RATIO = 0.015
const INNER_MARGIN_RATIO = 0.4
const RED_MIN_MANHATTAN = 2.5
const HERO_COL_RATIO = 0.62
const HERO_ROW_RATIO = 0.45
const HERO_DOTS = 21
const HERO_PERIOD_SEC = 30
const HERO_FADE_SEC = 2.6
const HERO_DOT_RATIO = 0.42
const HERO_BREATH_SPEED = 0.6
const HERO_BREATH_PHASE = 4.5
const HERO_VARIANT_STEPS = 5
const HERO_VARIANT_COUNT = 6
const HERO_RING_INNER = 0.52
const HERO_CROSS_HALF_WIDTH = 0.22
const OFF_DUR_SEC = 0.85
const ON_DUR_SEC = 1.35
const FIRST_EVENT_SEC = 1.2
const EVENT_GAP_BASE_SEC = 1.0
const EVENT_GAP_JITTER_SEC = 1.2
const CHAIN_EVERY = 4
const CHAIN_STAGGER_SEC = 0.09
const SWEEP_PERIOD_SEC = 15
const SWEEP_DELAY_MAX_SEC = 0.5
const SWEEP_OFF_SEC = 0.28
const SWEEP_ON_SEC = 0.5
const ZOOM_EVENT_P = 0.3
const ZOOM_DUR_SEC = 0.9
const MODULE_LINE_WIDTH = 0.07
const HALFTONE_DOT_RATIO = 0.42
const WIPE_EDGE = 0.06
const STAGGER_SPAN = 0.5
const PITCH_MIN = 0.07
const PITCH_SPAN = 0.04
const INVERT_PROBABILITY = 0.3
const MIRROR_PROBABILITY = 0.5
const TR_HATCH_WIDTH = 0.075
const ZOOM_IN_CORNER_SHIFT = 0.5
const ZOOM_OUT_SPREAD = 0.25
const ZOOM_OUT_SHRINK = 0.5
const PIVOT_SIGNS: readonly [number, number][] = [[-1, -1], [1, -1], [-1, 1], [1, 1]]
const PI = Math.PI
const TYPES = ['QT', 'HS', 'TR', 'CK', 'RG', 'DG', 'DM', 'AR', 'BR', 'DQ', 'SW', 'PL', 'HD', 'KN', 'LF'] as const
const FILLS = ['solid', 'solid', 'solid', 'solid', 'solid', 'half', 'line'] as const
const PALETTE_CHOICES = {
  paper: ['#f2efe8', '#f4f1ea', '#efece3', '#f5f3ee'],
  ink: ['#121212', '#161514', '#0f1113'],
  red: ['#e2321f', '#d92b1c', '#e8401f'],
} as const
const EASE = cubicBezier(0.72, 0, 0.14, 1)

type ModuleType = (typeof TYPES)[number]
type FillMode = 'solid' | 'half' | 'line'
type Zoom = 1 | 2 | 0.5
type Pivot = 0 | 1 | 2 | 3
type Rand = () => number
type Ctx = CanvasRenderingContext2D
type Build = (c: Ctx) => void

interface Rule {
  type: ModuleType
  rot: number
  mir: boolean
  fill: FillMode
  red: boolean
  inv: boolean
  n: number
  bits: number
  pitch: number
  zoom: Zoom
  pivot: Pivot
}

interface Palette {
  paper: string
  ink: string
  red: string
}

interface Style {
  fg: string
  ko: string
  rule: Rule
  lw: number
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const randInt = (r: Rand, n: number): number => (r() * n) | 0
const pickOf = <T>(r: Rand, a: readonly T[]): T => a[randInt(r, a.length)] as T

function newRule(r: Rand): Rule {
  return {
    type: pickOf(r, TYPES),
    rot: randInt(r, 4),
    mir: r() < MIRROR_PROBABILITY,
    fill: pickOf(r, FILLS),
    red: false,
    inv: r() < INVERT_PROBABILITY,
    n: 3 + randInt(r, 3),
    bits: randInt(r, 256),
    pitch: PITCH_MIN + r() * PITCH_SPAN,
    zoom: 1,
    pivot: 0,
  }
}

function makeRed(rule: Rule): Rule {
  return { ...rule, red: true, inv: false, fill: 'solid' }
}

function paint(c: Ctx, st: Style, build: Build, mode: FillMode = st.rule.fill): void {
  c.beginPath()
  build(c)
  if (mode === 'line') {
    c.lineWidth = MODULE_LINE_WIDTH * st.lw
    c.strokeStyle = st.fg
    c.stroke()
    return
  }
  c.fillStyle = st.fg
  if (mode !== 'half') {
    c.fill()
    return
  }
  c.save()
  c.clip()
  c.beginPath()
  const p = st.rule.pitch
  const r = p * HALFTONE_DOT_RATIO
  for (let y = -0.5 + p / 2; y < 0.5; y += p) {
    for (let x = -0.5 + p / 2; x < 0.5; x += p) {
      c.moveTo(x + r, y)
      c.arc(x, y, r, 0, 2 * PI)
    }
  }
  c.fill()
  c.restore()
}

function knockOut(c: Ctx, st: Style, build: Build): void {
  c.beginPath()
  build(c)
  c.fillStyle = st.ko
  c.fill()
}

const circ = (x: number, y: number, r: number): Build => (c) => {
  c.moveTo(x + r, y)
  c.arc(x, y, r, 0, 2 * PI)
}
const rect = (x: number, y: number, w: number, h: number): Build => (c) => c.rect(x, y, w, h)

function parts(st: Style): Build[] {
  const rl = st.rule
  const n = rl.n
  const b = rl.bits
  const P: Build[] = []
  const fm: FillMode = rl.fill === 'line' ? 'solid' : rl.fill
  const add = (build: Build, mode?: FillMode): void => {
    P.push((c) => paint(c, st, build, mode))
  }
  switch (rl.type) {
    case 'QT':
      for (let q = 0; q < 4; q++) {
        const k = (b >> (q * 2)) & 3
        const cx = -0.5 + (q & 1) * 0.5 + (k & 1) * 0.5
        const cy = -0.5 + (q >> 1) * 0.5 + (k >> 1) * 0.5
        const a0 = [0, 0.5 * PI, 1.5 * PI, PI][k] as number
        add((c) => {
          c.moveTo(cx, cy)
          c.arc(cx, cy, 0.5, a0, a0 + PI / 2)
          c.closePath()
        }, q === 3 ? 'solid' : fm)
      }
      break
    case 'HS':
      add((c) => {
        c.arc(0, 0, 0.5, PI, 2 * PI)
        c.closePath()
      }, fm)
      for (let i = 0; i < n; i++) {
        const pt = 0.5 / n
        add(rect(-0.5, i * pt + pt * 0.25, 1, pt * 0.6), 'solid')
      }
      break
    case 'TR':
      add((c) => {
        c.moveTo(-0.5, -0.5)
        c.lineTo(0.5, -0.5)
        c.lineTo(-0.5, 0.5)
        c.closePath()
      }, fm)
      P.push((c) => {
        c.beginPath()
        c.moveTo(0.5, -0.5)
        c.lineTo(0.5, 0.5)
        c.lineTo(-0.5, 0.5)
        c.closePath()
        c.clip()
        c.beginPath()
        const m = n + 2
        for (let i = 0; i < m; i++) {
          const k = (i + 0.5) / m
          c.moveTo(k + 1, -1)
          c.lineTo(k - 1, 1)
        }
        c.lineWidth = TR_HATCH_WIDTH * st.lw
        c.strokeStyle = st.fg
        c.stroke()
      })
      break
    case 'CK': {
      const k = n + 1
      for (let r = 0; r < k; r++) {
        add((c) => {
          for (let j = 0; j < k; j++) if ((r + j) % 2 === 0) c.rect(-0.5 + j / k, -0.5 + r / k, 1 / k, 1 / k)
        }, 'solid')
      }
      break
    }
    case 'RG':
      for (let i = 0; i < n; i++) {
        const r = 0.5 - (i * 0.46) / n
        if (i % 2 === 0) add(circ(0, 0, r), 'solid')
        else P.push((c) => knockOut(c, st, circ(0, 0, r)))
      }
      break
    case 'DG': {
      const k = n + 1
      for (let r = 0; r < k; r++) {
        add((c) => {
          for (let j = 0; j < k; j++) circ(-0.5 + (j + 0.5) / k, -0.5 + (r + 0.5) / k, 0.4 / k)(c)
        }, 'solid')
      }
      break
    }
    case 'DM': {
      const cs: [number, number][] = [[-0.25, -0.25], [0.25, -0.25], [0.25, 0.25], [-0.25, 0.25]]
      if (b & 1) cs.push([0, 0])
      for (const [x, y] of cs) {
        add((c) => {
          c.moveTo(x, y - 0.25)
          c.lineTo(x + 0.25, y)
          c.lineTo(x, y + 0.25)
          c.lineTo(x - 0.25, y)
          c.closePath()
        }, fm)
      }
      break
    }
    case 'AR':
      add((c) => {
        c.moveTo(-0.5, 0.5)
        c.lineTo(-0.5, 0)
        c.arc(0, 0, 0.5, PI, 2 * PI)
        c.lineTo(0.5, 0.5)
        c.closePath()
      })
      P.push((c) => knockOut(c, st, circ(0, 0.18, 0.17)))
      break
    case 'BR': {
      const m = n + 3
      add(rect(-0.5, 0.4, 1, 0.1), 'solid')
      for (let i = 0; i < m; i++) {
        const hh = 0.5 + 0.4 * ((b >> i) & 1)
        add(rect(-0.5 + (i * 0.9) / (m - 1), 0.4 - hh, 0.1, hh), 'solid')
      }
      break
    }
    case 'DQ':
      add(circ(0, 0, 0.5))
      P.push((c) => knockOut(c, st, rect(0, -0.5, 0.5, 0.5)))
      add(rect(0.1, -0.4, 0.3, 0.3), 'solid')
      break
    case 'SW':
      for (let r = 0; r < 3; r++) {
        add((c) => {
          const k = n + 1
          const y0 = -0.5 + r / 3
          const h = 1 / 3
          for (let j = 0; j < k; j++) {
            const x = -0.5 + j / k
            c.moveTo(x, y0)
            c.lineTo(x + 1 / k, y0 + h / 2)
            c.lineTo(x, y0 + h)
            c.closePath()
          }
        }, fm)
      }
      break
    case 'PL':
      add(rect(-0.5, -0.19, 1, 0.38), fm)
      add(rect(-0.19, -0.5, 0.38, 1), 'solid')
      break
    case 'HD':
      add(circ(0, 0, 0.5), 'half')
      add(circ(0, 0, 0.47), 'line')
      if (b & 1) add(circ(0, 0, 0.16), 'solid')
      break
    case 'KN':
      add(circ(-0.25, -0.25, 0.23), 'half')
      add(circ(0.25, -0.25, 0.23), 'solid')
      P.push((c) => {
        c.save()
        c.translate(0.25, -0.25)
        c.rotate(-PI / 4)
        knockOut(c, st, rect(-0.23, -0.035, 0.46, 0.07))
        c.restore()
      })
      add(circ(0.25, 0.25, 0.22), 'solid')
      add(circ(-0.25, 0.25, 0.14), fm)
      break
    case 'LF':
      add((c) => {
        c.moveTo(0.5, -0.5)
        c.arc(-0.5, -0.5, 1, 0, PI / 2)
        c.arc(0.5, 0.5, 1, PI, 1.5 * PI)
        c.closePath()
      })
      add(circ(0.32, 0.32, 0.13), 'solid')
      add(circ(-0.32, -0.32, 0.13), 'solid')
      break
  }
  return P
}

// p: 0..1 drawing progress; dir > 0 wipes in from the left, dir < 0 wipes out to the right; parts stagger.
function drawModule(c: Ctx, pal: Palette, cx: number, cy: number, size: number, rule: Rule, p = 1, dir = 1, zk = 1): void {
  if (p <= 0) return
  const quad = rule.zoom === 0.5
  const quadScale = quad ? 1 - ZOOM_OUT_SHRINK * zk : 1
  const st: Style = {
    rule,
    fg: rule.red ? pal.red : rule.inv ? pal.paper : pal.ink,
    ko: rule.inv ? pal.ink : pal.paper,
    lw: 1 / quadScale,
  }
  c.save()
  c.translate(cx, cy)
  c.scale(size, size)
  c.beginPath()
  c.rect(-0.5, -0.5, 1, 1)
  c.clip()
  const list = parts(st)
  if (rule.inv) {
    list.unshift((cc) => {
      cc.fillStyle = pal.ink
      cc.fillRect(-0.5, -0.5, 1, 1)
    })
  }
  const n = list.length
  const st0 = n > 1 ? STAGGER_SPAN / (n - 1) : 0
  const dur = n > 1 ? STAGGER_SPAN : 1
  const full = 1 + 2 * WIPE_EDGE
  const drawParts = (): void => {
    c.rotate((rule.rot * PI) / 2)
    if (rule.mir) c.scale(-1, 1)
    list.forEach((fn, i) => {
      const lt = EASE(clamp01((p - i * st0) / dur))
      if (lt <= 0) return
      c.save()
      if (lt < 1) {
        c.beginPath()
        c.rect(dir > 0 ? -0.5 - WIPE_EDGE : 0.5 + WIPE_EDGE - full * lt, -0.5 - WIPE_EDGE, full * lt, full)
        c.clip()
      }
      fn(c)
      c.restore()
    })
  }
  if (quad) {
    for (const [sx, sy] of PIVOT_SIGNS) {
      c.save()
      c.translate(sx * ZOOM_OUT_SPREAD * zk, sy * ZOOM_OUT_SPREAD * zk)
      c.scale(quadScale, quadScale)
      drawParts()
      c.restore()
    }
  } else {
    if (rule.zoom === 2) {
      const [sx, sy] = PIVOT_SIGNS[rule.pivot] as [number, number]
      c.translate(sx * ZOOM_IN_CORNER_SHIFT * zk, sy * ZOOM_IN_CORNER_SHIFT * zk)
      c.scale(1 + zk, 1 + zk)
    }
    drawParts()
  }
  c.restore()
}

function heroMask(v: number, x: number, y: number, d: number): number {
  const disc = clamp01((0.94 - d) * 9)
  if (v === 0) return disc * (1 - 0.3 * d)
  if (v === 1) return disc * clamp01((d - 0.48) * 9)
  if (v === 2) return disc * clamp01((0.06 - y) * 9)
  if (v === 4) return clamp01((d - HERO_RING_INNER) * 9) * clamp01((0.94 - d) * 9)
  if (v === 5) return Math.min(Math.abs(x), Math.abs(y)) < HERO_CROSS_HALF_WIDTH ? disc : 0
  return clamp01((0.94 - Math.abs(x) - Math.abs(y)) * 9) * (0.6 + 0.4 * d)
}

interface Layout {
  S: number
  gutter: number
  cols: number
  rows: number
  gx0: number
  gy0: number
  heroC: number
  heroR: number
  redC: number
  redR: number
  pal: Palette
}

function rng(seed: number, ...keys: number[]): Rand {
  let h = seed >>> 0
  for (const key of keys) h = (Math.imul(h ^ (key | 0), 0x9e3779b1) ^ (h >>> 13)) >>> 0
  return mulberry32(h)
}

function layoutFor(frame: AmbientFrame, seed: number): Layout {
  const { width, height } = frame
  const r = rng(seed, 1)
  const pal: Palette = { paper: pickOf(r, PALETTE_CHOICES.paper), ink: pickOf(r, PALETTE_CHOICES.ink), red: pickOf(r, PALETTE_CHOICES.red) }
  const S = Math.max(CELL_MIN, Math.min(CELL_MAX, Math.min(width, height) / CELLS_ACROSS))
  const cols = Math.ceil(width / S) + 1
  const rows = Math.ceil(height / S) + 1
  const gx0 = (width - cols * S) / 2
  const gy0 = (height - rows * S) / 2
  const vis = (v0: number, i: number, lim: number): boolean => v0 + i * S >= -0.5 && v0 + (i + 1) * S <= lim + 0.5
  let c0 = 0
  let c1 = cols - 1
  let r0 = 0
  let r1 = rows - 1
  while (c0 < c1 && !vis(gx0, c0, width)) c0++
  while (c1 > c0 && !vis(gx0, c1, width)) c1--
  while (r0 < r1 && !vis(gy0, r0, height)) r0++
  while (r1 > r0 && !vis(gy0, r1, height)) r1--
  const heroC = Math.min(c1 - 1, c0 + Math.floor((c1 - c0 - 1) * HERO_COL_RATIO))
  const heroR = Math.max(r0 + 1, Math.min(r1 - 2, r0 + Math.floor((r1 - r0 - 1) * HERO_ROW_RATIO)))
  const inner = (c: number, rr: number): boolean => {
    const x = gx0 + (c + 0.5) * S
    const y = gy0 + (rr + 0.5) * S
    return x > S * INNER_MARGIN_RATIO && x < width - S * INNER_MARGIN_RATIO && y > S * INNER_MARGIN_RATIO && y < height - S * INNER_MARGIN_RATIO
  }
  const pool: [number, number][] = []
  for (let rr = 0; rr < rows; rr++) {
    for (let c = 0; c < cols; c++) {
      const hero = c >= heroC && c <= heroC + 1 && rr >= heroR && rr <= heroR + 1
      if (!hero && inner(c, rr) && Math.abs(c - heroC - 0.5) + Math.abs(rr - heroR - 0.5) > RED_MIN_MANHATTAN) pool.push([c, rr])
    }
  }
  const [redC, redR] = pool.length ? pickOf(rng(seed, 2), pool) : [0, 0]
  return { S, gutter: S * GUTTER_RATIO, cols, rows, gx0, gy0, heroC, heroR, redC, redR, pal }
}

function isHero(L: Layout, c: number, r: number): boolean {
  return c >= L.heroC && c <= L.heroC + 1 && r >= L.heroR && r <= L.heroR + 1
}

function isInner(L: Layout, frame: AmbientFrame, c: number, r: number): boolean {
  const x = L.gx0 + (c + 0.5) * L.S
  const y = L.gy0 + (r + 0.5) * L.S
  return x > L.S * INNER_MARGIN_RATIO && x < frame.width - L.S * INNER_MARGIN_RATIO && y > L.S * INNER_MARGIN_RATIO && y < frame.height - L.S * INNER_MARGIN_RATIO
}

interface Event {
  c: number
  r: number
  t0: number
  kind: 'swap' | 'zoom' | 'chain'
  ruleSeed: number
}

// The single-cell, zoom and chain events of one 15 s period, as the original's scheduler would draw
// them but from the period's own random stream.
function periodEvents(L: Layout, frame: AmbientFrame, seed: number, period: number): Event[] {
  const r = rng(seed, 3, period)
  const events: Event[] = []
  let at = FIRST_EVENT_SEC
  let count = 0
  let last: [number, number] | null = null
  const pick = (): [number, number] => {
    for (let tries = 0; tries < 40; tries++) {
      const c = randInt(r, L.cols)
      const rr = randInt(r, L.rows)
      if (isHero(L, c, rr)) continue
      if (!isInner(L, frame, c, rr)) continue
      if (last && last[0] === c && last[1] === rr) continue
      return [c, rr]
    }
    return [0, 0]
  }
  while (at < SWEEP_PERIOD_SEC - 1) {
    const [c, rr] = pick()
    last = [c, rr]
    const chain = (count + 1) % CHAIN_EVERY === 0
    let busy = 0
    if (chain) {
      const horizontal = r() < 0.5
      let maxDelay = 0
      for (let k = 0; k < (horizontal ? L.cols : L.rows); k++) {
        const cc = horizontal ? k : c
        const cr = horizontal ? rr : k
        if (isHero(L, cc, cr)) continue
        const delay = Math.abs(horizontal ? cc - c : cr - rr) * CHAIN_STAGGER_SEC
        maxDelay = Math.max(maxDelay, delay)
        events.push({ c: cc, r: cr, t0: at + delay, kind: 'chain', ruleSeed: (r() * 1e9) | 0 })
      }
      busy = maxDelay + OFF_DUR_SEC + ON_DUR_SEC
    } else {
      events.push({ c, r: rr, t0: at, kind: r() < ZOOM_EVENT_P ? 'zoom' : 'swap', ruleSeed: (r() * 1e9) | 0 })
    }
    count++
    at += busy + EVENT_GAP_BASE_SEC + r() * EVENT_GAP_JITTER_SEC
  }
  return events
}

function baseRule(L: Layout, seed: number, c: number, r: number, period: number): Rule {
  const rule = newRule(rng(seed, 4, period, c * 1024 + r))
  return c === L.redC && r === L.redR ? makeRed(rule) : rule
}

function zoomOf(rule: Rule, ruleSeed: number): Rule {
  const r = rng(ruleSeed, 5)
  return rule.zoom === 1 ? { ...rule, zoom: r() < 0.5 ? 2 : 0.5, pivot: randInt(r, 4) as Pivot } : { ...rule, zoom: 1 }
}

function swapOf(rule: Rule, ruleSeed: number): Rule {
  const next = newRule(rng(ruleSeed, 6))
  return rule.red ? makeRed(next) : next
}

interface CellState {
  rule: Rule
  p: number
  dir: number
  zk: number
  zoomTo?: Rule
}

// The rule a cell shows at `local` seconds into the period, after the events that already hit it.
function cellState(L: Layout, seed: number, c: number, r: number, period: number, local: number, events: Event[]): CellState {
  let rule = baseRule(L, seed, c, r, period)
  const state: CellState = { rule, p: 1, dir: 1, zk: 1 }
  for (const ev of events) {
    if (ev.c !== c || ev.r !== r) continue
    const u = local - ev.t0
    if (u < 0) continue
    if (ev.kind === 'zoom') {
      const next = zoomOf(rule, ev.ruleSeed)
      if (u >= ZOOM_DUR_SEC) {
        rule = next
        continue
      }
      const e = EASE(u / ZOOM_DUR_SEC)
      if (next.zoom === 1) return { rule, p: 1, dir: 1, zk: 1 - e }
      return { rule: next, p: 1, dir: 1, zk: e }
    }
    if (u < OFF_DUR_SEC) return { rule, p: 1 - u / OFF_DUR_SEC, dir: -1, zk: 1 }
    rule = swapOf(rule, ev.ruleSeed)
    if (u < OFF_DUR_SEC + ON_DUR_SEC) return { rule, p: Math.min(1, (u - OFF_DUR_SEC) / ON_DUR_SEC), dir: 1, zk: 1 }
  }
  state.rule = rule
  return state
}

function finalRule(L: Layout, frame: AmbientFrame, seed: number, c: number, r: number, period: number): Rule {
  return cellState(L, seed, c, r, period, SWEEP_PERIOD_SEC + 10, periodEvents(L, frame, seed, period)).rule
}

function drawCell(ctx: Ctx, L: Layout, c: number, r: number, state: CellState): void {
  const x = L.gx0 + c * L.S + L.S / 2
  const y = L.gy0 + r * L.S + L.S / 2
  const h = (L.S - L.gutter) / 2 + L.S * CELL_PAD_RATIO
  ctx.fillStyle = L.pal.paper
  ctx.fillRect(x - h, y - h, 2 * h, 2 * h)
  drawModule(ctx, L.pal, x, y, L.S - L.gutter, state.rule, state.p, state.dir, state.zk)
}

function drawHero(ctx: Ctx, L: Layout, seed: number, time: number): void {
  const S = L.S
  const x = L.gx0 + L.heroC * S + L.gutter / 2
  const y = L.gy0 + L.heroR * S + L.gutter / 2
  const sz = 2 * S - L.gutter
  const N = HERO_DOTS
  const p = sz / N
  const seq = Math.floor(time / HERO_PERIOD_SEC)
  const variant = (k: number): number => {
    let v = 0
    for (let i = 1; i <= k % 97; i++) v = (v + 1 + randInt(rng(seed, 7, i), HERO_VARIANT_STEPS)) % HERO_VARIANT_COUNT
    return v
  }
  const cur = variant(seq)
  const prev = variant(seq - 1)
  const e = EASE(clamp01((time - seq * HERO_PERIOD_SEC) / HERO_FADE_SEC))
  ctx.fillStyle = L.pal.ink
  ctx.fillRect(x, y, sz, sz)
  ctx.beginPath()
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const nx = ((i + 0.5) / N) * 2 - 1
      const ny = ((j + 0.5) / N) * 2 - 1
      const d = Math.hypot(nx, ny)
      const m = heroMask(prev, nx, ny, d) * (1 - e) + heroMask(cur, nx, ny, d) * e
      if (m < 0.02) continue
      const r = Math.min(p * 0.5, p * HERO_DOT_RATIO * m * (0.78 + 0.22 * Math.sin(time * HERO_BREATH_SPEED - d * HERO_BREATH_PHASE)))
      const px = x + (i + 0.5) * p
      const py = y + (j + 0.5) * p
      ctx.moveTo(px + r, py)
      ctx.arc(px, py, r, 0, 2 * Math.PI)
    }
  }
  ctx.fillStyle = L.pal.paper
  ctx.fill()
}

// Modules stroke past their cell, so every cell in the loop range (the view plus one cell) is drawn, and the
// hero is drawn while it is within a cell of the view.
function overlaps(x: number, y: number, w: number, h: number, view: AmbientRect): boolean {
  return x < view.x + view.width && x + w > view.x && y < view.y + view.height && y + h > view.y
}

function render(ctx: CanvasRenderingContext2D, t: number, seed: number, _shape: Shape, frame: AmbientFrame): void {
  const time = t / 1000
  const L = layoutFor(frame, seed)
  const period = Math.floor(time / SWEEP_PERIOD_SEC)
  const local = time - period * SWEEP_PERIOD_SEC
  const events = periodEvents(L, frame, seed, period)
  const sweeping = local < SWEEP_DELAY_MAX_SEC + SWEEP_OFF_SEC + SWEEP_ON_SEC
  paper(ctx, frame, L.pal.paper)
  const { view } = frame
  const c0 = Math.max(0, Math.floor((view.x - L.gx0) / L.S) - 1)
  const c1 = Math.min(L.cols - 1, Math.ceil((view.x + view.width - L.gx0) / L.S) + 1)
  const r0 = Math.max(0, Math.floor((view.y - L.gy0) / L.S) - 1)
  const r1 = Math.min(L.rows - 1, Math.ceil((view.y + view.height - L.gy0) / L.S) + 1)
  const arm = L.S * CROSS_ARM_RATIO
  ctx.beginPath()
  for (let r = r0; r <= r1 + 1; r++) {
    for (let c = c0; c <= c1 + 1; c++) {
      if (c === L.heroC + 1 && r === L.heroR + 1) continue
      const x = L.gx0 + c * L.S
      const y = L.gy0 + r * L.S
      ctx.moveTo(x - arm, y)
      ctx.lineTo(x + arm, y)
      ctx.moveTo(x, y - arm)
      ctx.lineTo(x, y + arm)
    }
  }
  ctx.lineWidth = CROSS_LINE_WIDTH
  ctx.strokeStyle = L.pal.ink
  ctx.stroke()
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (isHero(L, c, r)) continue
      let state: CellState
      if (sweeping) {
        const delay = rng(seed, 8, period, c * 1024 + r)() * SWEEP_DELAY_MAX_SEC
        const u = local - delay
        if (u < 0) state = { rule: finalRule(L, frame, seed, c, r, period - 1), p: 1, dir: 1, zk: 1 }
        else if (u < SWEEP_OFF_SEC) state = { rule: finalRule(L, frame, seed, c, r, period - 1), p: 1 - u / SWEEP_OFF_SEC, dir: -1, zk: 1 }
        else state = { rule: baseRule(L, seed, c, r, period), p: Math.min(1, (u - SWEEP_OFF_SEC) / SWEEP_ON_SEC), dir: 1, zk: 1 }
      } else {
        state = cellState(L, seed, c, r, period, local, events)
      }
      drawCell(ctx, L, c, r, state)
    }
  }
  if (overlaps(L.gx0 + (L.heroC - 1) * L.S, L.gy0 + (L.heroR - 1) * L.S, 4 * L.S, 4 * L.S, view)) drawHero(ctx, L, seed, time)
}

export const moduleField: AmbientScene = { id: 'module-field', name: 'モジュール場', ink: 'dark', render }
