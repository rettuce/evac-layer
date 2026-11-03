import type { Shape } from '../types'

export type AmbientInk = 'dark' | 'light'

export interface AmbientRect {
  x: number
  y: number
  width: number
  height: number
}

// The picture a scene draws: `width` × `height` is the whole canvas (one screen, or a whole room when
// screens are cut from it), `view` the part this screen shows, in the same backing pixels. The context
// is already translated so that drawing at canvas coordinates lands in the view; scenes transform
// relative to it (save / translate / restore) and may skip what lies outside `view`.
export interface AmbientFrame {
  width: number
  height: number
  view: AmbientRect
}

export interface AmbientScene {
  readonly id: string
  readonly name: string
  readonly ink: AmbientInk
  render(ctx: CanvasRenderingContext2D, t: number, seed: number, shape: Shape, frame: AmbientFrame): void
}
