import type { Shape } from '../types'

export type AmbientInk = 'dark' | 'light'

export interface AmbientScene {
  readonly id: string
  readonly name: string
  readonly ink: AmbientInk
  readonly drawsGrid?: boolean
  render(ctx: CanvasRenderingContext2D, t: number, seed: number, shape: Shape): void
}
