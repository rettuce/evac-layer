export const AMBIENT_PERIOD_MS = 60000
export const AMBIENT_BAND_COUNT = 3
export const AMBIENT_SATURATION = 18
export const AMBIENT_LIGHTNESS = 84
export const AMBIENT_HUE_SPREAD = 70

function xmur3(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return (h ^= h >>> 16) >>> 0
  }
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface AmbientPalette {
  colors: string[]
  phase: number
}

export function ambientPalette(seed: string): AmbientPalette {
  const random = mulberry32(xmur3(seed)())
  const baseHue = random() * 360
  const colors = Array.from({ length: AMBIENT_BAND_COUNT }, (_, i) => {
    const hue = (baseHue + (i - 1) * AMBIENT_HUE_SPREAD * (0.6 + random() * 0.4) + 360) % 360
    return `hsl(${hue.toFixed(1)} ${AMBIENT_SATURATION}% ${AMBIENT_LIGHTNESS}%)`
  })
  return { colors, phase: random() }
}

export function ambientOffset(palette: AmbientPalette, elapsedMs: number): number {
  return (palette.phase + elapsedMs / AMBIENT_PERIOD_MS) % 1
}

export function formatClockJst(epochMs: number): string {
  const jst = new Date(epochMs + 9 * 3600 * 1000)
  return `${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`
}
