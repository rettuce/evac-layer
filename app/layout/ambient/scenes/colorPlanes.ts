import type { Shape } from '../../types'
import { mulberry32 } from '../rng.ts'
import type { AmbientScene } from '../types'

const PLANES_BY_SHAPE: Record<Shape, number> = { '16x9': 4, '9x16': 4, '32x9': 7, '1x1': 3 }
const DRIFT_PERIOD_MS = { min: 90_000, max: 150_000 }
const DRIFT_AMPLITUDE_SHORT_SIDES = { min: 0.08, max: 0.16 }
const RADIUS_SHORT_SIDES = { min: 0.55, max: 0.95 }
const STRETCH = { min: 1.2, max: 1.8 }
const TILT_DEG = 18
const TILT_DRIFT_DEG = 6
const HUE_SPREAD_DEG = 80
const GROUND = { saturation: 6, lightness: 77 }
const PLANE_SATURATION = { min: 10, max: 22 }
const PLANE_LIGHTNESS = { min: 60, max: 84 }
const PLANE_ALPHA = 0.72

interface Plane {
  x: number
  y: number
  radius: number
  stretch: number
  tilt: number
  periodMs: number
  phase: number
  amplitude: number
  color: string
}

function between(random: () => number, range: { min: number; max: number }): number {
  return range.min + random() * (range.max - range.min)
}

function sceneFor(seed: number, shape: Shape): { ground: string; planes: Plane[] } {
  const random = mulberry32(seed)
  const baseHue = random() * 360
  const count = PLANES_BY_SHAPE[shape]
  const planes = Array.from({ length: count }, (_, i): Plane => {
    const hue = (baseHue + (random() - 0.5) * HUE_SPREAD_DEG + 360) % 360
    const saturation = between(random, PLANE_SATURATION)
    const lightness = between(random, PLANE_LIGHTNESS)
    return {
      x: (i + 0.2 + random() * 0.6) / count,
      y: 0.15 + random() * 0.7,
      radius: between(random, RADIUS_SHORT_SIDES),
      stretch: between(random, STRETCH),
      tilt: ((random() - 0.5) * 2 * TILT_DEG * Math.PI) / 180,
      periodMs: Math.round(between(random, DRIFT_PERIOD_MS)),
      phase: random(),
      amplitude: between(random, DRIFT_AMPLITUDE_SHORT_SIDES),
      color: `${hue.toFixed(1)} ${saturation.toFixed(1)}% ${lightness.toFixed(1)}%`,
    }
  })
  return { ground: `hsl(${baseHue.toFixed(1)} ${GROUND.saturation}% ${GROUND.lightness}%)`, planes }
}

function render(ctx: CanvasRenderingContext2D, t: number, seed: number, shape: Shape): void {
  const { width, height } = ctx.canvas
  const short = Math.min(width, height)
  const { ground, planes } = sceneFor(seed, shape)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = ground
  ctx.fillRect(0, 0, width, height)
  for (const plane of planes) {
    const angle = 2 * Math.PI * ((t % plane.periodMs) / plane.periodMs + plane.phase)
    const cx = plane.x * width + Math.sin(angle) * plane.amplitude * short
    const cy = plane.y * height + Math.cos(angle * 2) * plane.amplitude * 0.5 * short
    const radius = plane.radius * short
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius)
    gradient.addColorStop(0, `hsl(${plane.color} / ${PLANE_ALPHA})`)
    gradient.addColorStop(0.55, `hsl(${plane.color} / ${PLANE_ALPHA * 0.6})`)
    gradient.addColorStop(1, `hsl(${plane.color} / 0)`)
    ctx.setTransform(1, 0, 0, 1, cx, cy)
    ctx.rotate(plane.tilt + (Math.sin(angle) * TILT_DRIFT_DEG * Math.PI) / 180)
    ctx.scale(plane.stretch, 1)
    ctx.fillStyle = gradient
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2)
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

export const colorPlanes: AmbientScene = { id: 'color-planes', name: '色面', ink: 'dark', render }
