import { OVERLAY_CORNERS, type OverlayCorner } from './overlay.ts'
import { hashString, mulberry32 } from './rng.ts'
import { brushFlow } from './scenes/brushFlow.ts'
import { etchedStreams } from './scenes/etchedStreams.ts'
import { inkBloom } from './scenes/inkBloom.ts'
import { moduleField } from './scenes/moduleField.ts'
import { quadSubdivision } from './scenes/quadSubdivision.ts'
import type { AmbientScene } from './types'

export const AMBIENT_SCENES: readonly AmbientScene[] = [
  brushFlow,
  inkBloom,
  etchedStreams,
  quadSubdivision,
  moduleField,
]
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

function shuffledRound(siteKey: string, round: number): number[] {
  const order = AMBIENT_SCENES.map((_, i) => i)
  const random = mulberry32(hashString(`${siteKey}:${round}:scenes`))
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }
  return order
}

// Every scene appears once per round of N hours, in a per-site shuffled order, so a scene never runs
// two hours in a row without keeping state. With two scenes they simply alternate; with three or more
// a round that would start with the previous round's last scene swaps its first two, which leaves its
// own last scene (and so the next round's check) unchanged.
function sceneIndex(siteKey: string, slot: number): number {
  const count = AMBIENT_SCENES.length
  if (count === 1) return 0
  if (count === 2) return (slot + hashString(`${siteKey}:scenes`)) % 2
  const round = Math.floor(slot / count)
  const order = shuffledRound(siteKey, round)
  if (order[0] === shuffledRound(siteKey, round - 1)[count - 1]) [order[0], order[1]] = [order[1]!, order[0]!]
  return order[slot - round * count]!
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
