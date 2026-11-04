import type { Shape } from '../../types'
import { cellRandom, cellRange, paper, sceneUnit, tint } from '../field.ts'
import type { AmbientFrame, AmbientScene } from '../types'

const PAPER = 'rgb(243 241 236)'
const INKS = [tint(222, 34, 66), tint(44, 62, 72), tint(220, 8, 66), tint(222, 22, 80)]
const ACCENT = tint(8, 62, 70)
const CROSS = 'rgb(52 58 68 / 0.35)'
const CELL = 120
const GUTTER = 0.12
const ACCENT_SHARE = 0.03
// Provisional reference wgl glyph-lattice (2026-11-05, to be confirmed): every 10 s the tiles' kinds
// recombine, each new module easing in over 0.6 s; nothing turns or breathes in between.
const REFERENCE = { recombineMs: 10_000, easeInMs: 600, easeInFrom: 0.9 } as const
const KINDS = ['quarter', 'half', 'triangle', 'ring', 'bars', 'diamond', 'disc', 'check'] as const
type Kind = (typeof KINDS)[number]

function module(ctx: CanvasRenderingContext2D, kind: Kind, s: number): void {
  const h = s / 2
  ctx.beginPath()
  if (kind === 'quarter') {
    ctx.moveTo(-h, -h)
    ctx.arc(-h, -h, s, 0, Math.PI / 2)
  } else if (kind === 'half') ctx.arc(0, h, h, Math.PI, 0)
  else if (kind === 'triangle') {
    ctx.moveTo(-h, h)
    ctx.lineTo(h, h)
    ctx.lineTo(-h, -h)
  } else if (kind === 'ring') {
    ctx.arc(0, 0, h, 0, Math.PI * 2)
    ctx.arc(0, 0, h * 0.52, 0, Math.PI * 2, true)
  } else if (kind === 'bars') for (let k = 0; k < 3; k++) ctx.rect(-h, -h + (k * s) / 3, s, s / 6)
  else if (kind === 'diamond') {
    ctx.moveTo(0, -h)
    ctx.lineTo(h, 0)
    ctx.lineTo(0, h)
    ctx.lineTo(-h, 0)
  } else if (kind === 'disc') ctx.arc(0, 0, h * 0.72, 0, Math.PI * 2)
  else {
    ctx.rect(-h, -h, h, h)
    ctx.rect(0, 0, h, h)
  }
  ctx.closePath()
  ctx.fill('evenodd')
}

function easeOut(x: number): number {
  const u = Math.min(1, Math.max(0, x))
  return 1 - (1 - u) ** 3
}

function render(ctx: CanvasRenderingContext2D, t: number, seed: number, shape: Shape, frame: AmbientFrame): void {
  const unit = sceneUnit(frame, shape)
  const cell = CELL * unit
  const inner = cell * (1 - GUTTER)
  const epoch = Math.floor(t / REFERENCE.recombineMs)
  const settle = easeOut((t - epoch * REFERENCE.recombineMs) / REFERENCE.easeInMs)
  const { i0, i1, j0, j1 } = cellRange(frame.view, cell)
  paper(ctx, frame, PAPER)
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const pick = (k: number) => cellRandom(seed, i, j, k)
      const scale = REFERENCE.easeInFrom + (1 - REFERENCE.easeInFrom) * settle
      ctx.save()
      ctx.translate((i + 0.5) * cell, (j + 0.5) * cell)
      ctx.rotate(Math.floor(pick(1) * 4) * (Math.PI / 2))
      ctx.scale(scale, scale)
      ctx.fillStyle = pick(5) < ACCENT_SHARE ? ACCENT : INKS[Math.floor(pick(2) * INKS.length)]!
      module(ctx, KINDS[Math.floor(cellRandom(seed, i, j, 100 + epoch) * KINDS.length)]!, inner)
      ctx.restore()
    }
  }
  const arm = cell * 0.05
  const crosses = new Path2D()
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      crosses.moveTo(i * cell - arm, j * cell)
      crosses.lineTo(i * cell + arm, j * cell)
      crosses.moveTo(i * cell, j * cell - arm)
      crosses.lineTo(i * cell, j * cell + arm)
    }
  }
  ctx.strokeStyle = CROSS
  ctx.lineWidth = Math.max(1, unit)
  ctx.stroke(crosses)
}

export const moduleField: AmbientScene = { id: 'module-field', name: 'モジュール場', ink: 'dark', render }
