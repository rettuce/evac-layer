// Ink bounds of a pictogram (viewBox units), measured from the drawn pixels: strokes, caps, miters and
// rotations all count, which no bbox arithmetic gets right for a turned arrow. Cached per id and rotation.
const RASTER_PX = 512

export interface InkBounds {
  left: number
  top: number
  right: number
  bottom: number
}

const cache = new Map<string, Promise<InkBounds | undefined>>()
const pending = new Set<Promise<unknown>>()

function parseViewBox(markup: string): [number, number, number, number] | undefined {
  const vb = /viewBox="([^"]+)"/.exec(markup)?.[1]?.trim().split(/\s+/).map(Number)
  return vb && vb.length === 4 && vb.every(Number.isFinite) ? (vb as [number, number, number, number]) : undefined
}

async function rasterBounds(markup: string): Promise<InkBounds | undefined> {
  const vb = parseViewBox(markup)
  if (!vb) return undefined
  const sized = markup.replace(/^<svg/, `<svg width="${RASTER_PX}" height="${RASTER_PX}" color="#000"`)
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = RASTER_PX
  canvas.height = RASTER_PX
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, RASTER_PX, RASTER_PX)
  const { data } = ctx.getImageData(0, 0, RASTER_PX, RASTER_PX)
  let left = RASTER_PX
  let top = RASTER_PX
  let right = -1
  let bottom = -1
  for (let y = 0; y < RASTER_PX; y++) {
    for (let x = 0; x < RASTER_PX; x++) {
      if (data[(y * RASTER_PX + x) * 4 + 3]! < 128) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  if (right < 0) return undefined
  const [x0, y0, w, h] = vb
  return {
    left: x0 + (left / RASTER_PX) * w,
    top: y0 + (top / RASTER_PX) * h,
    right: x0 + ((right + 1) / RASTER_PX) * w,
    bottom: y0 + ((bottom + 1) / RASTER_PX) * h,
  }
}

export function pictogramInk(key: string, markup: string): Promise<InkBounds | undefined> {
  let promise = cache.get(key)
  if (!promise) {
    promise = rasterBounds(markup)
    cache.set(key, promise)
  }
  pending.add(promise)
  promise.finally(() => pending.delete(promise!))
  return promise
}

// The screen is ready only once every pictogram on it has been placed by its ink.
export async function pictogramsSettled(): Promise<void> {
  while (pending.size) await Promise.all([...pending])
}
