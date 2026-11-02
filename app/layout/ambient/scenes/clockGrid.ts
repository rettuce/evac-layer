import { PILLAR } from '../../shapes.ts'
import type { Shape } from '../../types'
import { D21_BASE_SHORT_SIDE_PX, D21_GUTTER, D21_MARGIN, D21_PITCH, D21_TRACK } from '../overlay.ts'
import { mulberry32 } from '../rng.ts'
import type { AmbientScene } from '../types'

const GROUND = 'rgb(21 24 28)'
const PAPER = '220 223 216'
const TRACK_EDGE_ALPHA = 0.22
const SUBDIVISION_ALPHA = 0.09
const CELL_ALPHA = { low: 0.04, high: 0.11 }
const BREATH_PERIOD_MS = 60_000

// Design numbers: how finely each 192-wide track is divided and how tall a module row is (in pitches).
const DESIGNS = [
  { subdivisions: 1, rowPitches: 1 },
  { subdivisions: 2, rowPitches: 1 },
  { subdivisions: 1, rowPitches: 0.5 },
  { subdivisions: 3, rowPitches: 2 },
] as const
const EMPHASIS_CELLS = { min: 3, max: 7 }

function d21ScaleFor(width: number, height: number, shape: Shape): number {
  const faceWidth = shape === 'pillar' ? PILLAR.faceWidth : width
  return Math.min(faceWidth, height) / D21_BASE_SHORT_SIDE_PX
}

function render(ctx: CanvasRenderingContext2D, t: number, seed: number, shape: Shape): void {
  const { width, height } = ctx.canvas
  const random = mulberry32(seed)
  const design = DESIGNS[Math.floor(random() * DESIGNS.length)]!
  const scale = d21ScaleFor(width, height, shape)
  const margin = D21_MARGIN * scale
  const pitch = D21_PITCH * scale
  const track = D21_TRACK * scale
  const rowPitch = pitch * design.rowPitches
  const columns = Math.max(1, Math.floor((width - 2 * margin + D21_GUTTER * scale) / pitch))
  const rows = Math.max(1, Math.floor((height - 2 * margin) / rowPitch))

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = GROUND
  ctx.fillRect(0, 0, width, height)

  const breath = (1 - Math.cos((2 * Math.PI * (t % BREATH_PERIOD_MS)) / BREATH_PERIOD_MS)) / 2
  const cellAlpha = CELL_ALPHA.low + (CELL_ALPHA.high - CELL_ALPHA.low) * breath
  const emphasized = Math.round(EMPHASIS_CELLS.min + random() * (EMPHASIS_CELLS.max - EMPHASIS_CELLS.min))
  ctx.fillStyle = `rgb(${PAPER} / ${cellAlpha.toFixed(4)})`
  for (let i = 0; i < emphasized; i++) {
    const column = Math.floor(random() * columns)
    const row = Math.floor(random() * rows)
    ctx.fillRect(Math.round(margin + column * pitch), Math.round(margin + row * rowPitch), Math.round(track), Math.round(rowPitch - D21_GUTTER * scale))
  }

  for (let column = 0; column < columns; column++) {
    const left = margin + column * pitch
    ctx.fillStyle = `rgb(${PAPER} / ${TRACK_EDGE_ALPHA})`
    ctx.fillRect(Math.round(left), Math.round(margin), 1, Math.round(height - 2 * margin))
    ctx.fillRect(Math.round(left + track), Math.round(margin), 1, Math.round(height - 2 * margin))
    ctx.fillStyle = `rgb(${PAPER} / ${SUBDIVISION_ALPHA})`
    for (let k = 1; k < design.subdivisions; k++) {
      ctx.fillRect(Math.round(left + (track * k) / design.subdivisions), Math.round(margin), 1, Math.round(height - 2 * margin))
    }
  }
  ctx.fillStyle = `rgb(${PAPER} / ${SUBDIVISION_ALPHA})`
  for (let row = 0; row <= rows; row++) {
    ctx.fillRect(Math.round(margin), Math.round(margin + row * rowPitch), Math.round(width - 2 * margin), 1)
  }
}

export const clockGrid: AmbientScene = { id: 'clock-grid', name: '時計と幾何', ink: 'light', drawsGrid: true, render }
