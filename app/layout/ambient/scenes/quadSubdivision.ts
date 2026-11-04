import type { Shape } from '../../types'
import { cubicBezier, hash12, paper, vnoise12 } from '../field.ts'
import type { AmbientFrame, AmbientRect, AmbientScene } from '../types'

// Port of wgl.ie3.jp lab/recursive-subdivision (2026-11-05): a quadtree whose cells split where a churning
// fbm is high, drawn as hairlines and a dot per cell on a near-black ground; two focus points wander and
// deepen the split, the field drifts with a curl, and every 5.4 s a cascade splits, merges and settles
// layer by layer (every 8th cycle the picture unfolds into large cells). The original descends the tree
// per fragment in GLSL and drives the cascade with anime.js; here the tree is walked once per cell and
// the cascade is a function of t, so a frame depends on t alone.
const MAX_DEPTH = 5
const GRID = 8
const FREQ = 0.34
const BASE_THR = 0.3
const DEPTH_STEP = 0.12
const FOCUS_R = 3.2
const FOCUS_STR = 0.11
const FOCUS2_R_RATIO = 0.8
const FOCUS2_STR_RATIO = 0.7
// The gallery video (2026-10-08) predates the 10-10 brush-up that sank deep lines to 0.07 and lifted deep dots to
// 1.0; the picture is matched to that gallery, so the lines stay 0.26 at every depth and the dots 0.85.
const LINE_LUMA_ROOT = 0.26
const LINE_LUMA_DEEP = 0.26
const BIRTH_LINE_GAIN = 0.33
const DOT_LUMA_SHALLOW = 0.85
const DOT_LUMA_DEEP = 0.85
const DREST = 0.5
const SPLIT_GAIN = 0.16
const MIN_CELL_PX = 13
// The fragment shader lights every pixel within 0.6 px of a border and fades to 1.3 px, on both sides of
// the shared edge; one stroke this wide carries the same ink.
const LINE_WIDTH_PX = 1.6
const AA_MARGIN_PX = 2
// The reference's pixel sizes (smallest cell, dot radius, line width) are read at a 540 px short side (2× at 1080p), the closest match to the gallery's cell sizes and weight
// capture; on a taller canvas they scale with the short side, so the picture keeps its weight (2026-11-05).
const REFERENCE_SHORT_SIDE = 540
const GROUND = 'rgb(8 8 8)'
const ACT_REST = 0.5
const ACT_HI = 0.88
const ACT_LO = 0.22
const STAGGER_MS = 150
const SPLIT_MS = 900
const MERGE_MS = 850
const SETTLE_MS = 750
const CYCLE_MS = 5400
const CHIME_EVERY_CYCLES = 8
const ACT_LO_CHIME = -0.3
const CHIME_MERGE_MS = 900
const CHIME_HOLD_MS = 1500
const CHIME_RETURN_MS = 1300
const BIRTH_SPRING_MS = 440
const BIRTH_FADE_MS = 1000
const FOCUS_SWING = 0.55
const FOCUS_WOBBLE = 3.0
const FOCUS2_PERIOD_RATIO = 1.3
const FOCUS2_PHASE = Math.PI
const FOCUS2_WOBBLE_OFFSET = 41.3
const EASE_EVENT = cubicBezier(0.16, 1, 0.3, 1)
const EASE_MERGE = cubicBezier(0.7, 0, 0.84, 0)

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function inOutSine(x: number): number {
  return -(Math.cos(Math.PI * clamp01(x)) - 1) / 2
}

function inOutQuad(x: number): number {
  const u = clamp01(x)
  return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2
}

function fbm0(x: number, y: number): number {
  return vnoise12(x, y) * 0.5 + vnoise12(x * 2.1, y * 2.1) * 0.25 + vnoise12(x * 4.41, y * 4.41) * 0.125
}

function fbmT(x: number, y: number, t: number): number {
  return vnoise12(x, y) * 0.5 + vnoise12(x * 2.1 + t * 0.3, y * 2.1 - t * 0.22) * 0.25 + vnoise12(x * 4.41 - t * 0.55, y * 4.41 + t * 0.4) * 0.125
}

// Depth activity of layer i at ms since the cycle started: the anime.js cascade as a function of time.
function depthActivity(i: number, u: number, chime: boolean): number {
  if (chime) {
    const d = u - (MAX_DEPTH - 1 - i) * STAGGER_MS
    if (d < 0) return ACT_REST
    if (d < CHIME_MERGE_MS) return ACT_REST + (ACT_LO_CHIME - ACT_REST) * EASE_EVENT(d / CHIME_MERGE_MS)
    if (d < CHIME_MERGE_MS + CHIME_HOLD_MS) return ACT_LO_CHIME
    return ACT_LO_CHIME + (ACT_REST - ACT_LO_CHIME) * inOutSine((d - CHIME_MERGE_MS - CHIME_HOLD_MS) / CHIME_RETURN_MS)
  }
  const d = u - i * STAGGER_MS
  if (d < 0) return ACT_REST
  if (d < SPLIT_MS) return ACT_REST + (ACT_HI - ACT_REST) * EASE_EVENT(d / SPLIT_MS)
  if (d < SPLIT_MS + MERGE_MS) return ACT_HI + (ACT_LO - ACT_HI) * EASE_MERGE((d - SPLIT_MS) / MERGE_MS)
  if (d < SPLIT_MS + MERGE_MS + SETTLE_MS) return ACT_LO + (ACT_REST - ACT_LO) * inOutSine((d - SPLIT_MS - MERGE_MS) / SETTLE_MS)
  return ACT_REST
}

// The dot's birth pop: a spring to 1 (bounce 0.5, 440 ms) then back to 0 over a second.
function birth(u: number, chime: boolean): number {
  const d = u - (chime ? CHIME_MERGE_MS + CHIME_HOLD_MS : 0)
  if (d < 0) return 0
  if (d < BIRTH_SPRING_MS) {
    const x = d / BIRTH_SPRING_MS
    return 1 - Math.exp(-5 * x) * Math.cos(Math.PI * 1.5 * x)
  }
  return 1 - inOutQuad((d - BIRTH_SPRING_MS) / BIRTH_FADE_MS)
}

function placeFocus(t: number, sd: number, gridW: number, gridH: number, phase: number, wobbleOffset: number): [number, number] {
  const wobX = (fbm0(t * 0.07 + sd + wobbleOffset, 2.0) - 0.5) * FOCUS_WOBBLE
  const wobY = (fbm0(5.0 + wobbleOffset, t * 0.06 + sd) - 0.5) * FOCUS_WOBBLE
  return [Math.cos(t * 0.083 + sd + phase) * (0.5 * gridW) * FOCUS_SWING + wobX, Math.sin(t * 0.067 + sd * 1.7 + phase) * (0.5 * gridH) * FOCUS_SWING + wobY]
}

interface Leaf {
  x: number
  y: number
  w: number
  h: number
  depth: number
}

interface Walk {
  t: number
  drift: [number, number]
  focusA: [number, number]
  focusB: [number, number]
  act: number[]
  S: number
  minCell: number
  view: AmbientRect
  margin: number
  halfW: number
  halfH: number
  leaves: Leaf[]
}

// A cell just outside the view still paints the half of its border stroke (and the anti-aliasing) that falls
// inside, so cells are kept within `margin` of the view; the room is drawn in tiles and needs both halves.
function overlaps(x: number, y: number, w: number, h: number, view: AmbientRect, margin: number): boolean {
  return x < view.x + view.width + margin && x + w > view.x - margin && y < view.y + view.height + margin && y + h > view.y - margin
}

// Splits the cell at (ox, oy) of size (sw, sh) in grid units exactly as the fragment shader descends.
function walk(k: Walk, ox: number, oy: number, sw: number, sh: number, depth: number): void {
  const px = k.halfW + ox * k.S
  const py = k.halfH + oy * k.S
  if (!overlaps(px, py, sw * k.S, sh * k.S, k.view, k.margin)) return
  if (depth < MAX_DEPTH && Math.min(sw, sh) * k.S >= k.minCell) {
    const cx = ox + 0.5 * sw
    const cy = oy + 0.5 * sh
    const n = fbmT(cx * FREQ + k.drift[0], cy * FREQ + k.drift[1], k.t)
    const infA = Math.max(0, 1 - Math.hypot(cx - k.focusA[0], cy - k.focusA[1]) / FOCUS_R)
    const infB = Math.max(0, 1 - Math.hypot(cx - k.focusB[0], cy - k.focusB[1]) / (FOCUS_R * FOCUS2_R_RATIO))
    const fInf = Math.max(infA * infA * FOCUS_STR, infB * infB * FOCUS_STR * FOCUS2_STR_RATIO)
    const thr = BASE_THR + depth * DEPTH_STEP - fInf - SPLIT_GAIN * (k.act[depth]! - DREST)
    if (n > thr) {
      const pat = hash12(ox * 0.13 + depth * 7.1, oy * 0.13 + depth * 11.3)
      let dx = 2
      let dy = 2
      if (pat >= 0.3 && pat < 0.6) dx = 3
      else if (pat >= 0.6) dy = 3
      if ((sw / dx) * k.S < k.minCell) dx = 2
      if ((sh / dy) * k.S < k.minCell) dy = 2
      const subW = sw / dx
      const subH = sh / dy
      for (let j = 0; j < dy; j++) for (let i = 0; i < dx; i++) walk(k, ox + i * subW, oy + j * subH, subW, subH, depth + 1)
      return
    }
  }
  k.leaves.push({ x: px, y: py, w: sw * k.S, h: sh * k.S, depth })
}

function render(ctx: CanvasRenderingContext2D, t: number, seed: number, _shape: Shape, frame: AmbientFrame): void {
  const time = t / 1000
  const sd = seed % 1000
  const px = Math.max(1, Math.min(frame.width, frame.height) / REFERENCE_SHORT_SIDE)
  const S = Math.min(frame.width, frame.height) / GRID
  const halfW = frame.width / 2
  const halfH = frame.height / 2
  const ED = 0.15
  const spx = 13.7 + sd
  const spy = time * 0.05
  const curlGain = 0.9 / (2 * ED)
  const drift: [number, number] = [
    (fbm0(spx, spy + ED) - fbm0(spx, spy - ED)) * curlGain + time * 0.018 + sd,
    -(fbm0(spx + ED, spy) - fbm0(spx - ED, spy)) * curlGain + time * 0.012 + sd,
  ]
  const gridW = frame.width / S
  const gridH = frame.height / S
  const cycle = Math.floor(t / CYCLE_MS)
  const u = t - cycle * CYCLE_MS
  const chime = cycle > 0 && cycle % CHIME_EVERY_CYCLES === 0
  const act = Array.from({ length: MAX_DEPTH }, (_, i) => depthActivity(i, u, chime))
  const pop = birth(u, chime)
  const k: Walk = {
    t: time,
    drift,
    focusA: placeFocus(time, sd, gridW, gridH, 0, 0),
    focusB: placeFocus(time / FOCUS2_PERIOD_RATIO, sd, gridW, gridH, FOCUS2_PHASE, FOCUS2_WOBBLE_OFFSET),
    act,
    S,
    minCell: MIN_CELL_PX * px,
    view: frame.view,
    margin: (LINE_WIDTH_PX * px) / 2 + AA_MARGIN_PX,
    halfW,
    halfH,
    leaves: [],
  }
  const i0 = Math.floor((frame.view.x - halfW) / S) - 1
  const i1 = Math.ceil((frame.view.x + frame.view.width - halfW) / S) + 1
  const j0 = Math.floor((frame.view.y - halfH) / S) - 1
  const j1 = Math.ceil((frame.view.y + frame.view.height - halfH) / S) + 1
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) walk(k, i, j, 1, 1, 0)
  paper(ctx, frame, GROUND)
  const reachable = Math.min(MAX_DEPTH, Math.max(1, Math.floor(Math.log2(S / k.minCell)) + 1))
  const byLuma = new Map<number, Path2D>()
  const dots = new Map<number, Path2D>()
  for (const leaf of k.leaves) {
    const depthT = clamp01(leaf.depth / reachable)
    const lineLuma = Math.round(255 * (LINE_LUMA_ROOT + (LINE_LUMA_DEEP - LINE_LUMA_ROOT) * depthT) * (1 + BIRTH_LINE_GAIN * pop))
    let rules = byLuma.get(lineLuma)
    if (!rules) byLuma.set(lineLuma, (rules = new Path2D()))
    rules.rect(leaf.x, leaf.y, leaf.w, leaf.h)
    const minDim = Math.min(leaf.w, leaf.h)
    const cx = leaf.x + leaf.w / 2
    const cy = leaf.y + leaf.h / 2
    const pulse = 1 + 0.1 * Math.sin(time * 0.8 + ((cx - halfW) / S) * 1.7 + ((cy - halfH) / S) * 2.1)
    const minDimRef = minDim / px
    const small = 1 - clamp01((minDimRef - 6) / 58)
    const r = Math.min(7, Math.max(1.45, 1.45 + minDimRef * 0.016)) * px * pulse * (1 + pop * (0.22 + 0.55 * small))
    const dotLuma = Math.round(255 * (DOT_LUMA_SHALLOW + (DOT_LUMA_DEEP - DOT_LUMA_SHALLOW) * depthT))
    let path = dots.get(dotLuma)
    if (!path) dots.set(dotLuma, (path = new Path2D()))
    path.moveTo(cx + r, cy)
    path.arc(cx, cy, r, 0, Math.PI * 2)
  }
  ctx.lineWidth = LINE_WIDTH_PX * px
  for (const [luma, path] of byLuma) {
    ctx.strokeStyle = `rgb(${luma} ${luma} ${luma})`
    ctx.stroke(path)
  }
  for (const [luma, path] of dots) {
    ctx.fillStyle = `rgb(${luma} ${luma} ${luma})`
    ctx.fill(path)
  }
}

export const quadSubdivision: AmbientScene = { id: 'quad-subdivision', name: '分割', ink: 'light', render }
