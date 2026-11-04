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
const BREATH_MS = { min: 2_000, max: 5_000 }
const DOT_RATIO = 0.22
const DRIFT_MS = 10_000
const TINT_SHARE = 0.3

interface Leaf {
  x: number
  y: number
  size: number
  key: number
}

function overlaps(x: number, y: number, size: number, view: AmbientRect): boolean {
  return x < view.x + view.width && x + size > view.x && y < view.y + view.height && y + size > view.y
}

// Cells split where the field is high, so fine and coarse areas drift together across the canvas.
function collect(seed: number, unit: number, view: AmbientRect, drift: number, i: number, j: number, depth: number, size: number, leaves: Leaf[]): void {
  const x = i * size
  const y = j * size
  if (!overlaps(x, y, size, view)) return
  const field = fbm(seed, ((x + size / 2) / unit) * FIELD_SCALE + drift, ((y + size / 2) / unit) * FIELD_SCALE - drift * 0.6, 2)
  const split = depth < MAX_DEPTH && cellRandom(seed, i, j, depth) < field * 1.35 - depth * 0.12
  if (!split) {
    leaves.push({ x, y, size, key: cellRandom(seed, i, j, depth + 10) })
    return
  }
  for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) collect(seed, unit, view, drift, i * 2 + di, j * 2 + dj, depth + 1, size / 2, leaves)
}

function render(ctx: CanvasRenderingContext2D, t: number, seed: number, shape: Shape, frame: AmbientFrame): void {
  const unit = sceneUnit(frame, shape)
  const root = ROOT * unit
  const { i0, i1, j0, j1 } = cellRange(frame.view, root)
  const drift = t / DRIFT_MS
  const leaves: Leaf[] = []
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) collect(seed, unit, frame.view, drift, i, j, 0, root, leaves)
  paper(ctx, frame, PAPER)
  const tints = new Path2D()
  const rules = new Path2D()
  const dots = new Path2D()
  for (const leaf of leaves) {
    const period = BREATH_MS.min + leaf.key * (BREATH_MS.max - BREATH_MS.min)
    const breath = 0.5 + 0.5 * wave(t, period, leaf.key)
    if (leaf.key < TINT_SHARE) {
      const inset = leaf.size * 0.5 * (1 - breath)
      tints.rect(leaf.x + inset, leaf.y + inset, leaf.size - 2 * inset, leaf.size - 2 * inset)
    }
    rules.rect(leaf.x + 0.5, leaf.y + 0.5, leaf.size, leaf.size)
    const r = leaf.size * DOT_RATIO * (0.2 + 0.8 * breath)
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
