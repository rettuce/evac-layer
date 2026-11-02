import type { Motion } from './types'
import { LANGUAGE_ROTATION_MS } from './typography'

// WCAG 2.3.1 allows up to 3 flashes per second; the pulse stays at or below 1 Hz with a
// luminance swing small enough that it never counts as a flash at all.
export const PULSE_PERIOD_MS = 2000
export const PULSE_MIN_OPACITY = 0.72

export const SCALE_IN_MS = 480
export const SCALE_IN_FROM = 0.94
const SCALE_IN_EASE = [0.2, 0.7, 0.2, 1] as const

export interface MotionFrame {
  opacity: number
  scale: number
}

const RESTING: MotionFrame = { opacity: 1, scale: 1 }

function bezierComponent(t: number, a: number, b: number): number {
  const u = 1 - t
  return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t
}

const BEZIER_ITERATIONS = 24

function cubicBezierEase(x: number, [x1, y1, x2, y2]: readonly [number, number, number, number]): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < BEZIER_ITERATIONS; i++) {
    const mid = (lo + hi) / 2
    if (bezierComponent(mid, x1, x2) < x) lo = mid
    else hi = mid
  }
  return bezierComponent((lo + hi) / 2, y1, y2)
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function scaleInFrame(sinceAppearMs: number): MotionFrame {
  const progress = clamp01(sinceAppearMs / SCALE_IN_MS)
  const eased = cubicBezierEase(progress, SCALE_IN_EASE)
  return { opacity: eased, scale: SCALE_IN_FROM + (1 - SCALE_IN_FROM) * eased }
}

export function pulseOpacity(sincePulseStartMs: number): number {
  if (sincePulseStartMs <= 0) return 1
  const phase = (sincePulseStartMs % PULSE_PERIOD_MS) / PULSE_PERIOD_MS
  const depth = (1 - Math.cos(2 * Math.PI * phase)) / 2
  return 1 - (1 - PULSE_MIN_OPACITY) * depth
}

export function motionFrame(motion: Motion, sinceAppearMs: number, reduced: boolean): MotionFrame {
  if (reduced || motion === 'static') return RESTING
  const appear = scaleInFrame(sinceAppearMs)
  if (motion === 'scale-in') return appear
  return { ...appear, opacity: appear.opacity * pulseOpacity(sinceAppearMs - SCALE_IN_MS) }
}

export function languageStep(elapsedMs: number): { index: number; sinceAppearMs: number } {
  const index = Math.floor(Math.max(0, elapsedMs) / LANGUAGE_ROTATION_MS)
  return { index, sinceAppearMs: elapsedMs - index * LANGUAGE_ROTATION_MS }
}

const OPACITY_DECIMALS = 3
const SCALE_DECIMALS = 4

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

export function frameStyle(frame: MotionFrame): Record<string, string | number> {
  const scale = roundTo(frame.scale, SCALE_DECIMALS)
  // A settled element must drop its transform: Chrome otherwise keeps the raster from the last
  // intermediate scale, so a frame reached step by step differs from the same frame reached directly.
  return { opacity: roundTo(frame.opacity, OPACITY_DECIMALS), transform: scale === 1 ? 'none' : `scale(${scale})` }
}
