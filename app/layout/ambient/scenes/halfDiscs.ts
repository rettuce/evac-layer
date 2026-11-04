import type { Shape } from '../../types'
import { cellRandom, cellRange, paper, sceneUnit, tint } from '../field.ts'
import type { AmbientFrame, AmbientScene } from '../types'

const PAPER = 'rgb(243 239 232)'
const TINTS = [tint(12, 44, 80), tint(40, 56, 82), tint(8, 46, 89), tint(24, 30, 86), 'rgb(243 239 232)']
const FIGURES = [tint(12, 42, 64), tint(42, 58, 66), tint(220, 10, 60), tint(6, 40, 78), 'rgb(250 248 243)']
const TILE = 120
// After wgl semicircle-collage: a main event every 8 s turns every panel a quarter turn (0.6 s, ease-out,
// staggered up to 1.25 s); between events a few panels turn on their own (0.34 s); some panels change
// figure as they turn.
const MAIN_PERIOD_MS = 8_000
const TURN_MS = 600
const STAGGER_MS = 1_250
const SOLO_SHARE = 0.12
const SOLO_TURN_MS = 340
const SOLO_FROM_MS = 2_500
const SOLO_SPAN_MS = 4_000
const SWAP_SHARE = 0.55

type Figure = 'half' | 'quarter' | 'disc' | 'square'
const KINDS: Figure[] = ['half', 'half', 'quarter', 'quarter', 'disc', 'square']

function easeOut(x: number): number {
  const u = Math.min(1, Math.max(0, x))
  return 1 - (1 - u) ** 3
}

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
  const event = Math.floor(t / MAIN_PERIOD_MS)
  const sinceEvent = t - event * MAIN_PERIOD_MS
  paper(ctx, frame, PAPER)
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const pick = (k: number) => cellRandom(seed, i, j, k)
      ctx.fillStyle = TINTS[Math.floor(pick(0) * TINTS.length)]!
      ctx.fillRect(i * size, j * size, size + 0.5, size + 0.5)
      const direction = pick(2) < 0.5 ? -1 : 1
      const mainTurn = easeOut((sinceEvent - pick(6) * STAGGER_MS) / TURN_MS)
      const solo = pick(7) < SOLO_SHARE ? easeOut((sinceEvent - SOLO_FROM_MS - pick(8) * SOLO_SPAN_MS) / SOLO_TURN_MS) : 0
      const turns = event * (1 + (pick(7) < SOLO_SHARE ? 1 : 0)) + mainTurn + solo
      const angle = Math.floor(pick(3) * 4) * (Math.PI / 2) + direction * (Math.PI / 2) * turns
      const kindEvent = pick(9) < SWAP_SHARE ? (mainTurn >= 0.5 ? event : event - 1) : 0
      ctx.save()
      ctx.beginPath()
      ctx.rect(i * size, j * size, size, size)
      ctx.clip()
      ctx.translate((i + 0.5) * size, (j + 0.5) * size)
      ctx.rotate(angle % (Math.PI * 2))
      ctx.fillStyle = FIGURES[Math.floor(pick(4) * FIGURES.length)]!
      figure(ctx, KINDS[Math.floor(cellRandom(seed, i, j, 5 + kindEvent) * KINDS.length)]!, size)
      ctx.restore()
    }
  }
}

export const halfDiscs: AmbientScene = { id: 'half-discs', name: '半円の構成', ink: 'dark', render }
