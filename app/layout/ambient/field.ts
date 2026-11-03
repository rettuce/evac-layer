import { PILLAR } from '../shapes.ts'
import type { Shape } from '../types'
import type { AmbientFrame, AmbientRect } from './types'

const BASE_SHORT_SIDE_PX = 1080

// Scenes that cut a canvas into cells draw each cell from its own hash, never from a running random
// stream, so a screen that shows only part of the canvas draws its cells exactly as the whole would.
export function cellRandom(seed: number, i: number, j: number, k = 0): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i, 0xc2b2ae35) ^ Math.imul(j, 0x27d4eb2f) ^ Math.imul(k, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

function fade(x: number): number {
  return x * x * x * (x * (x * 6 - 15) + 10)
}

export function valueNoise(seed: number, x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const u = fade(x - xi)
  const v = fade(y - yi)
  const a = cellRandom(seed, xi, yi)
  const b = cellRandom(seed, xi + 1, yi)
  const c = cellRandom(seed, xi, yi + 1)
  const d = cellRandom(seed, xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

export function fbm(seed: number, x: number, y: number, octaves = 3): number {
  let sum = 0
  let amplitude = 0.5
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += amplitude * valueNoise(seed + o * 1013, x * 2 ** o, y * 2 ** o)
    norm += amplitude
    amplitude *= 0.5
  }
  return sum / norm
}

// One design pixel of a scene: the short side of a 1080 panel, or of one face round a pillar.
export function sceneUnit(frame: AmbientFrame, shape: Shape): number {
  const faceWidth = shape === 'pillar' ? frame.width / PILLAR.faces : frame.width
  return Math.min(faceWidth, frame.height) / BASE_SHORT_SIDE_PX
}

export function cellRange(view: AmbientRect, size: number, pad = 0): { i0: number; i1: number; j0: number; j1: number } {
  return {
    i0: Math.floor((view.x - pad) / size),
    i1: Math.ceil((view.x + view.width + pad) / size),
    j0: Math.floor((view.y - pad) / size),
    j1: Math.ceil((view.y + view.height + pad) / size),
  }
}

export function paper(ctx: CanvasRenderingContext2D, frame: AmbientFrame, color: string): void {
  ctx.fillStyle = color
  ctx.fillRect(frame.view.x, frame.view.y, frame.view.width, frame.view.height)
}

export const SATURATION_GAIN = 1.8

export function tint(hue: number, saturation: number, lightness: number, alpha?: number): string {
  const s = Math.min(100, Math.round(saturation * SATURATION_GAIN))
  return alpha === undefined ? `hsl(${hue} ${s}% ${lightness}%)` : `hsl(${hue} ${s}% ${lightness}% / ${alpha})`
}

export function wave(t: number, periodMs: number, phase = 0): number {
  return Math.sin(2 * Math.PI * (t / periodMs + phase))
}
