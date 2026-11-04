export type Content = 'calm' | 'evac'
export type AmbientScene = (typeof SCENES)[number]
export const SCENES = ['brush-flow', 'etched-streams', 'half-discs', 'ink-bloom', 'module-field', 'quad-subdivision'] as const

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
}

export const SCREEN_ORIGIN = import.meta.env.VITE_SCREEN_ORIGIN ?? 'http://127.0.0.1:3153'

const MUNICIPALITY = '05210'
const SITE_ID = '05210-demo-honjo-station'
const ROOM_ID = 'concourse'
const SITE = { site_name: '羽後本荘駅', lat: '39.38633978', lng: '140.0563304' }
// A quiet day for the calm screen; the 2026-10-21 flood from just before the level-4 bulletin (18:15 JST)
// for EVAC LAYER, replayed at real speed so the level-4 screen holds until the level-5 bulletin at 19:45.
const WINDOWS: Record<Content, { from: string; to: string }> = {
  calm: { from: '2026-10-15T00:00+09:00', to: '2026-10-15T06:00+09:00' },
  evac: { from: '2026-10-21T18:10+09:00', to: '2026-10-21T19:40+09:00' },
}

export async function loadCrops(url: string): Promise<CropsFile | undefined> {
  const response = await fetch(url)
  return response.ok ? ((await response.json()) as CropsFile) : undefined
}

export function screenUrl(extras: DisplayExtras, content: Content, scene: AmbientScene, crops?: CropsFile): string {
  const canvas = crops?.canvas ?? extras.canvas
  const crop = crops?.crops[extras.screen] ?? extras.crop
  const params = new URLSearchParams({
    mode: 'live', municipality: MUNICIPALITY, site: SITE_ID, speed: '1', ...WINDOWS[content], scene,
    shape: crops?.shapes[extras.screen] ?? extras.shape, canvas: `${canvas[0]}x${canvas[1]}`, crop: crop.join(','), canvas_id: ROOM_ID,
    ...SITE,
  })
  const seam = crops?.seam[extras.screen]
  if (seam) params.set('seam', seam)
  if (extras.shape !== 'pillar') {
    params.set('w', String(extras.face_px[0]))
    params.set('h', String(extras.face_px[1]))
  }
  return `${SCREEN_ORIGIN}/screen?${params}`
}
