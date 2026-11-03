import type { Shape } from '../../types'
import { cellRandom, cellRange, fbm, paper, sceneUnit } from '../field.ts'
import type { AmbientFrame, AmbientScene } from '../types'

const PAPER = 'rgb(241 238 231)'
const INKS = ['hsl(214 34% 64% / 0.30)', 'hsl(224 26% 50% / 0.22)', 'hsl(40 58% 68% / 0.30)', 'hsl(352 38% 72% / 0.26)', 'hsl(204 22% 80% / 0.38)']
const SPACING = 34
const STEPS = 14
const STEP = 9
const BRUSH = { min: 4, max: 10 }
const FIELD_SCALE = 1 / 460
const TURNS = 2
const DRIFT_MS = 300_000

function render(ctx: CanvasRenderingContext2D, t: number, seed: number, shape: Shape, frame: AmbientFrame): void {
  const unit = sceneUnit(frame, shape)
  const size = SPACING * unit
  const drift = t / DRIFT_MS
  const { i0, i1, j0, j1 } = cellRange(frame.view, size, STEPS * STEP * unit)
  paper(ctx, frame, PAPER)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      let x = (i + cellRandom(seed, i, j)) * size
      let y = (j + cellRandom(seed, i, j, 1)) * size
      ctx.strokeStyle = INKS[Math.floor(cellRandom(seed, i, j, 2) * INKS.length)]!
      ctx.lineWidth = (BRUSH.min + cellRandom(seed, i, j, 3) * (BRUSH.max - BRUSH.min)) * unit
      ctx.beginPath()
      ctx.moveTo(x, y)
      for (let s = 0; s < STEPS; s++) {
        const angle = fbm(seed, (x / unit) * FIELD_SCALE + drift, (y / unit) * FIELD_SCALE - drift * 0.5, 2) * Math.PI * 2 * TURNS
        x += Math.cos(angle) * STEP * unit
        y += Math.sin(angle) * STEP * unit
        ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }
}

export const brushFlow: AmbientScene = { id: 'brush-flow', name: '筆の流れ', ink: 'dark', render }
