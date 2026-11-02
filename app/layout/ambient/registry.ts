import { OVERLAY_CORNERS, type OverlayCorner } from './overlay.ts'
import { hashString } from './rng.ts'
import { colorPlanes } from './scenes/colorPlanes.ts'
import type { AmbientScene } from './types'

export const AMBIENT_SCENES: readonly AmbientScene[] = [colorPlanes]
export const AMBIENT_SLOT_MS = 3_600_000

export interface AmbientPick {
  slot: number
  scene: AmbientScene
  corner: OverlayCorner
  seed: number
}

export function ambientSlot(epochMs: number): number {
  return Math.floor(epochMs / AMBIENT_SLOT_MS)
}

function baseSceneIndex(siteKey: string, slot: number): number {
  return hashString(`${siteKey}:${slot}:scene`) % AMBIENT_SCENES.length
}

// Same rule as the ss rotation: compare base indices of adjacent slots so the pick stays stateless.
function sceneIndex(siteKey: string, slot: number): number {
  const base = baseSceneIndex(siteKey, slot)
  if (AMBIENT_SCENES.length > 1 && base === baseSceneIndex(siteKey, slot - 1)) {
    return (base + 1) % AMBIENT_SCENES.length
  }
  return base
}

export function findAmbientScene(id: string | undefined): AmbientScene | undefined {
  return AMBIENT_SCENES.find((scene) => scene.id === id)
}

export function pickAmbient(siteKey: string, epochMs: number, pinnedSceneId?: string): AmbientPick {
  const slot = ambientSlot(epochMs)
  const scene = findAmbientScene(pinnedSceneId) ?? AMBIENT_SCENES[sceneIndex(siteKey, slot)]!
  const corner = OVERLAY_CORNERS[hashString(`${siteKey}:${slot}:corner`) % OVERLAY_CORNERS.length]!
  return { slot, scene, corner, seed: hashString(`${siteKey}:${slot}:${scene.id}`) }
}
