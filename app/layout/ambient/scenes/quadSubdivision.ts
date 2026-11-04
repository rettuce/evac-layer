import type { Shape } from '../../types'
import { cellRandom, cellRange, fbm, paper, sceneUnit, wave, tint } from '../field.ts'
import type { AmbientFrame, AmbientRect, AmbientScene } from '../types'

const PAPER = 'rgb(239 240 238)'
const RULE = 'rgb(52 60 72 / 0.2)'
const DOT = 'rgb(52 60 72 / 0.38)'
const TINT = tint(206, 26, 82, 0.5)
const ROOT = 432
const MAX_DEPTH = 4
const FIELD_SCALE = 1 / 800
const DOT_RATIO = 0.09
const TINT_SHARE = 0.12
// After wgl recursive-subdivision: every 5.4 s the cells split (0.9 s), merge back past rest (0.85 s) and
// settle (0.75 s) with an ease-out; every 8th cycle the whole picture unfolds into large cells, holds and
// returns; the field drifts all the time and the dots pulse a little.
const CYCLE_MS = 5_400
const SPLIT_MS = 900
const MERGE_MS = 850
const SETTLE_MS = 750
const ACT_REST = 0.5
const ACT_HI = 0.88
const ACT_LO = 0.22
const CHIME_EVERY = 8
const ACT_LO_CHIME = -0.3
const CHIME_MERGE_MS = 900
const CHIME_HOLD_MS = 1_500
const CHIME_RETURN_MS = 1_300
const ACTIVITY_GAIN = 0.6
const DRIFT_MS = 30_000
const DOT_PULSE_MS = 3_000
const DOT_PULSE = 0.15

interface Leaf {
  x: number
  y: number
  size: number
  key: number
}

function easeOut(x: number): number {
  const u = Math.min(1, Math.max(0, x))
  return 1 - (1 - u) ** 3
}

function ramp(from: number, to: number, u: number, durationMs: number): number {
  return from + (to - from) * easeOut(u / durationMs)
}

function activity(t: number): number {
  const cycle = Math.floor(t / CYCLE_MS)
  const u = t - cycle * CYCLE_MS
  if (cycle % CHIME_EVERY === CHIME_EVERY - 1) {
    if (u < CHIME_MERGE_MS) return ramp(ACT_REST, ACT_LO_CHIME, u, CHIME_MERGE_MS)
    if (u < CHIME_MERGE_MS + CHIME_HOLD_MS) return ACT_LO_CHIME
    return ramp(ACT_LO_CHIME, ACT_REST, u - CHIME_MERGE_MS - CHIME_HOLD_MS, CHIME_RETURN_MS)
  }
  if (u < SPLIT_MS) return ramp(ACT_REST, ACT_HI, u, SPLIT_MS)
  if (u < SPLIT_MS + MERGE_MS) return ramp(ACT_HI, ACT_LO, u - SPLIT_MS, MERGE_MS)
  if (u < SPLIT_MS + MERGE_MS + SETTLE_MS) return ramp(ACT_LO, ACT_REST, u - SPLIT_MS - MERGE_MS, SETTLE_MS)
  return ACT_REST
}

function overlaps(x: number, y: number, size: number, view: AmbientRect): boolean {
  return x < view.x + view.width && x + size > view.x && y < view.y + view.height && y + size > view.y
}

// Cells split where the field is high, so fine and coarse areas drift together across the canvas.
function collect(seed: number, unit: number, view: AmbientRect, drift: number, bias: number, i: number, j: number, depth: number, size: number, leaves: Leaf[]): void {
  const x = i * size
  const y = j * size
  if (!overlaps(x, y, size, view)) return
  const field = fbm(seed, ((x + size / 2) / unit) * FIELD_SCALE + drift, ((y + size / 2) / unit) * FIELD_SCALE - drift * 0.6, 2)
  const split = depth < MAX_DEPTH && cellRandom(seed, i, j, depth) < field * 1.35 - depth * 0.12 + bias
  if (!split) {
    leaves.push({ x, y, size, key: cellRandom(seed, i, j, depth + 10) })
    return
  }
  for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) collect(seed, unit, view, drift, bias, i * 2 + di, j * 2 + dj, depth + 1, size / 2, leaves)
}

function render(ctx: CanvasRenderingContext2D, t: number, seed: number, shape: Shape, frame: AmbientFrame): void {
  const unit = sceneUnit(frame, shape)
  const root = ROOT * unit
  const { i0, i1, j0, j1 } = cellRange(frame.view, root)
  const drift = t / DRIFT_MS
  const bias = (activity(t) - ACT_REST) * ACTIVITY_GAIN
  const pulse = 1 - DOT_PULSE / 2 + (DOT_PULSE / 2) * wave(t, DOT_PULSE_MS)
  const leaves: Leaf[] = []
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) collect(seed, unit, frame.view, drift, bias, i, j, 0, root, leaves)
  paper(ctx, frame, PAPER)
  const tints = new Path2D()
  const rules = new Path2D()
  const dots = new Path2D()
  for (const leaf of leaves) {
    if (leaf.key < TINT_SHARE) tints.rect(leaf.x, leaf.y, leaf.size, leaf.size)
    rules.rect(leaf.x + 0.5, leaf.y + 0.5, leaf.size, leaf.size)
    const r = leaf.size * DOT_RATIO * pulse
    const cx = leaf.x + leaf.size / 2
    const cy = leaf.y + leaf.size / 2
    dots.moveTo(cx + r, cy)
    dots.arc(cx, cy, r, 0, Math.PI * 2)
  }
  ctx.fillStyle = TINT
  ctx.fill(tints)
  ctx.strokeStyle = RULE
  ctx.lineWidth = 1
  ctx.stroke(rules)
  ctx.fillStyle = DOT
  ctx.fill(dots)
}

export const quadSubdivision: AmbientScene = { id: 'quad-subdivision', name: '分割', ink: 'dark', render }
