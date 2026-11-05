import { BASE_SHORT_SIDE_PX, SHAPES } from './shapes'
import type { Shape } from './types'
import { TYPE_PX } from './typography'

export const SHELTER_STEP_RATIO = 0.92
export const SHELTER_MAX_EXTRA_STEPS = 6

// Mirrors the Verifier (agents/src/verifier: requiredPx('shelter', …, 'primary') at the shape's type scale, the
// pillar's faces read unscaled); test/shelter-fit.test.ts fails when the two drift apart.
export function shelterFloorPx(shape: Shape): number {
  const scale = shape === 'pillar' ? 1 : Math.min(SHAPES[shape].width, SHAPES[shape].height) / BASE_SHORT_SIDE_PX
  return TYPE_PX.guide * scale
}

// The artboard's narrow size, then 0.92 × at a time down to the floor; a narrow size already under the floor stays alone.
export function shelterSizes(narrowPx: number, floorPx: number): number[] {
  const sizes = [narrowPx]
  for (let step = 0; step < SHELTER_MAX_EXTRA_STEPS; step++) {
    const last = sizes[sizes.length - 1]!
    if (last <= floorPx) break
    sizes.push(Math.max(floorPx, Math.floor(last * SHELTER_STEP_RATIO)))
  }
  return sizes
}
