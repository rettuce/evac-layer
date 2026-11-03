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
const BREATH_MS = { min: 50_000, max: 110_000 }
const DOT_RATIO = 0.07

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
function collect(seed: number, unit: number, view: AmbientRect, i: number, j: number, depth: number, size: number, leaves: Leaf[]): void {
  const x = i * size
  const y = j * size
  if (!overlaps(x, y, size, view)) return
  const field = fbm(seed, ((x + size / 2) / unit) * FIELD_SCALE, ((y + size / 2) / unit) * FIELD_SCALE, 2)
  const split = depth < MAX_DEPTH && cellRandom(seed, i, j, depth) < field * 1.35 - depth * 0.12
  if (!split) {
    leaves.push({ x, y, size, key: cellRandom(seed, i, j, depth + 10) })
    return
  }
  for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) collect(seed, unit, view, i * 2 + di, j * 2 + dj, depth + 1, size / 2, leaves)
}

function render(ctx: CanvasRenderingContext2D, t: number, seed: number, shape: Shape, frame: AmbientFrame): void {
  const unit = sceneUnit(frame, shape)
  const root = ROOT * unit
  const { i0, i1, j0, j1 } = cellRange(frame.view, root)
  const leaves: Leaf[] = []
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) collect(seed, unit, frame.view, i, j, 0, root, leaves)
  paper(ctx, frame, PAPER)
  const tints = new Path2D()
  const rules = new Path2D()
  const dots = new Path2D()
  for (const leaf of leaves) {
    if (leaf.key < 0.12) tints.rect(leaf.x, leaf.y, leaf.size, leaf.size)
    rules.rect(leaf.x + 0.5, leaf.y + 0.5, leaf.size, leaf.size)
    const period = BREATH_MS.min + leaf.key * (BREATH_MS.max - BREATH_MS.min)
    const r = leaf.size * DOT_RATIO * (0.65 + 0.35 * wave(t, period, leaf.key))
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
