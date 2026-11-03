import type { Shape } from '../../types'
import { cellRandom, cellRange, fbm, paper, sceneUnit } from '../field.ts'
import type { AmbientFrame, AmbientScene } from '../types'

const PAPER = 'rgb(240 241 243)'
const INKS = ['hsl(226 30% 62% / 0.75)', 'hsl(226 22% 74% / 0.75)', 'hsl(8 62% 72% / 0.8)', 'hsl(220 12% 46% / 0.55)']
const TILE = 72
const LINE = 15
const REGION_SCALE = 1 / 900
const FLOW_MS = 40_000
const DOT_SHARE = 0.08

function render(ctx: CanvasRenderingContext2D, t: number, seed: number, shape: Shape, frame: AmbientFrame): void {
  const unit = sceneUnit(frame, shape)
  const size = TILE * unit
  const r = size / 2
  const arc = (Math.PI / 2) * r
  const { i0, i1, j0, j1 } = cellRange(frame.view, size)
  paper(ctx, frame, PAPER)
  const paths = INKS.map(() => new Path2D())
  const dots = new Path2D()
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const x = i * size
      const y = j * size
      const region = fbm(seed, i * TILE * REGION_SCALE, j * TILE * REGION_SCALE, 2)
      const ink = Math.min(INKS.length - 1, Math.floor(region * region * INKS.length * 1.6))
      const path = paths[ink]!
      if (cellRandom(seed, i, j) < 0.5) {
        path.moveTo(x + r, y)
        path.arc(x, y, r, 0, Math.PI / 2)
        path.moveTo(x + r, y + size)
        path.arc(x + size, y + size, r, Math.PI, Math.PI * 1.5)
      } else {
        path.moveTo(x + size, y + r)
        path.arc(x + size, y, r, Math.PI / 2, Math.PI)
        path.moveTo(x, y + r)
        path.arc(x, y + size, r, Math.PI * 1.5, Math.PI * 2)
      }
      if (cellRandom(seed, i, j, 1) < DOT_SHARE) {
        dots.moveTo(x + size * 0.12, y)
        dots.arc(x, y, size * 0.12, 0, Math.PI * 2)
      }
    }
  }
  ctx.lineWidth = LINE * unit
  ctx.lineCap = 'butt'
  ctx.setLineDash([arc * 0.9, arc * 0.1])
  ctx.lineDashOffset = -arc * (t / FLOW_MS)
  for (const [k, path] of paths.entries()) {
    ctx.strokeStyle = INKS[k]!
    ctx.stroke(path)
  }
  ctx.setLineDash([])
  ctx.lineDashOffset = 0
  ctx.fillStyle = INKS[2]!
  ctx.fill(dots)
}

export const truchetPaths: AmbientScene = { id: 'truchet-paths', name: '管路', ink: 'dark', render }
