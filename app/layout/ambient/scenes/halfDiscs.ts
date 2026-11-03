import type { Shape } from '../../types'
import { cellRandom, cellRange, paper, sceneUnit } from '../field.ts'
import type { AmbientFrame, AmbientScene } from '../types'

const PAPER = 'rgb(243 239 232)'
const TINTS = ['hsl(12 44% 80%)', 'hsl(40 56% 82%)', 'hsl(8 46% 89%)', 'hsl(24 30% 86%)', 'rgb(243 239 232)']
const FIGURES = ['hsl(12 42% 64%)', 'hsl(42 58% 66%)', 'hsl(220 10% 60%)', 'hsl(6 40% 78%)', 'rgb(250 248 243)']
const TILE = 120
const TURN_MS = { min: 240_000, max: 480_000 }

type Figure = 'half' | 'quarter' | 'disc' | 'square'
const KINDS: Figure[] = ['half', 'half', 'quarter', 'quarter', 'disc', 'square']

function figure(ctx: CanvasRenderingContext2D, kind: Figure, size: number): void {
  const r = size / 2
  ctx.beginPath()
  if (kind === 'half') ctx.arc(0, 0, r, 0, Math.PI)
  else if (kind === 'quarter') {
    ctx.moveTo(-r, -r)
    ctx.arc(-r, -r, size, 0, Math.PI / 2)
  } else if (kind === 'disc') ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2)
  else ctx.rect(-r * 0.36, -r * 0.36, r * 0.72, r * 0.72)
  ctx.closePath()
  ctx.fill()
}

function render(ctx: CanvasRenderingContext2D, t: number, seed: number, shape: Shape, frame: AmbientFrame): void {
  const unit = sceneUnit(frame, shape)
  const size = TILE * unit
  const { i0, i1, j0, j1 } = cellRange(frame.view, size)
  paper(ctx, frame, PAPER)
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const pick = (k: number) => cellRandom(seed, i, j, k)
      ctx.fillStyle = TINTS[Math.floor(pick(0) * TINTS.length)]!
      ctx.fillRect(i * size, j * size, size + 0.5, size + 0.5)
      const period = TURN_MS.min + pick(1) * (TURN_MS.max - TURN_MS.min)
      const direction = pick(2) < 0.5 ? -1 : 1
      const angle = Math.floor(pick(3) * 4) * (Math.PI / 2) + direction * 2 * Math.PI * (t / period)
      ctx.save()
      ctx.beginPath()
      ctx.rect(i * size, j * size, size, size)
      ctx.clip()
      ctx.translate((i + 0.5) * size, (j + 0.5) * size)
      ctx.rotate(angle)
      ctx.fillStyle = FIGURES[Math.floor(pick(4) * FIGURES.length)]!
      figure(ctx, KINDS[Math.floor(pick(5) * KINDS.length)]!, size)
      ctx.restore()
    }
  }
}

export const halfDiscs: AmbientScene = { id: 'half-discs', name: '半円の構成', ink: 'dark', render }
