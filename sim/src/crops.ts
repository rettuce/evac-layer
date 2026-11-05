export type Content = 'calm' | 'evac'
export type AmbientScene = (typeof SCENES)[number]
export const SCENES = ['brush-flow', 'etched-streams', 'ink-bloom', 'painterly-flow', 'quad-subdivision'] as const

export interface DisplayExtras {
  screen: string
  shape: '9x16' | '32x9' | 'pillar'
  face: number
  canvas: [number, number]
  crop: [number, number, number, number]
  face_px: [number, number]
  size: [number, number]
  center: [number, number, number]
  normal: [number, number, number]
}

// build_scene.py --crops-json: the room canvas, each window's crop, shape and (pillars) which corner the seam is at.
export interface CropsFile {
  canvas: [number, number]
  crops: Record<string, [number, number, number, number]>
  shapes: Record<string, DisplayExtras['shape']>
  seam: Record<string, string>
  faces?: Record<string, Record<string, [number, number, number, number]>>
}

// build_scene.py COLUMN_FACE_NAMES, in the order of the glb's face index (0 faces the hero camera, then counter-clockwise).
const FACE_NAMES = ['front', 'right', 'back', 'left'] as const

// The calm content draws each pillar face as its own page over that face's window of the room canvas
// (D-8 `faces`); the alert layout stays one pillar page clipped per face, because it is laid out per column.
export function faceWindow(extras: DisplayExtras, content: Content, crops?: CropsFile): [number, number, number, number] | undefined {
  if (content !== 'calm' || extras.shape !== 'pillar') return undefined
  return crops?.faces?.[extras.screen]?.[FACE_NAMES[extras.face]!]
}

export async function loadCrops(url: string): Promise<CropsFile | undefined> {
  const response = await fetch(url)
  return response.ok ? ((await response.json()) as CropsFile) : undefined
}
