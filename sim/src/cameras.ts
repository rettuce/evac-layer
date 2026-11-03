import { animate, type JSAnimation } from 'animejs'
import 'animejs/adapters/three'
import { PerspectiveCamera, Vector3 } from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'

export interface CameraPreset {
  name: string
  position: Vector3
  target: Vector3
  lensMm: number
}

export const FILM_GAUGE_MM = 36
const TRANSITION_MS = 1200
const EASE = 'inOutCubic'

export function presetsFromGltf(cameras: PerspectiveCamera[]): CameraPreset[] {
  return cameras
    .map((camera) => ({
      name: String(camera.userData.preset ?? camera.name.replace(/^cam_/, '')),
      position: camera.getWorldPosition(new Vector3()),
      target: new Vector3(...(camera.userData.target as [number, number, number])),
      lensMm: Number(camera.userData.lens_mm),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export class CameraRig {
  private running: JSAnimation[] = []

  constructor(readonly camera: PerspectiveCamera, readonly controls: OrbitControls) {
    camera.filmGauge = FILM_GAUGE_MM
    controls.addEventListener('start', () => this.cancel())
  }

  jumpTo(preset: CameraPreset): void {
    this.cancel()
    this.camera.position.copy(preset.position)
    this.controls.target.copy(preset.target)
    this.camera.setFocalLength(preset.lensMm)
    this.controls.update()
  }

  flyTo(preset: CameraPreset): void {
    this.cancel()
    const { camera, controls } = this
    const common = { duration: TRANSITION_MS, ease: EASE }
    this.running = [
      animate(camera, { x: preset.position.x, y: preset.position.y, z: preset.position.z, focalLength: preset.lensMm, ...common,
        onUpdate: () => controls.update() }),
      animate(controls.target, { x: preset.target.x, y: preset.target.y, z: preset.target.z, ...common }),
    ]
  }

  cancel(): void {
    for (const animation of this.running) animation.pause()
    this.running = []
  }
}
