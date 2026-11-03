import type { AmbientRect } from './types'

const MAX_ROOM_PX = 65536

function positive(text: string | undefined): number | undefined {
  if (text === undefined || !/^\d+(\.\d+)?$/.test(text)) return undefined
  const n = Number(text)
  return n > 0 && n <= MAX_ROOM_PX ? n : undefined
}

export function parseRoom(value: unknown): { width: number; height: number } | undefined {
  if (typeof value !== 'string') return undefined
  const [w, h, extra] = value.split('x')
  const width = positive(w)
  const height = positive(h)
  return width && height && extra === undefined ? { width, height } : undefined
}

export function parseCrop(value: unknown, room: { width: number; height: number } | undefined): AmbientRect | undefined {
  if (typeof value !== 'string' || !room) return undefined
  const parts = value.split(',')
  if (parts.length !== 4 || !/^\d+(\.\d+)?$/.test(parts[0]!) || !/^\d+(\.\d+)?$/.test(parts[1]!)) return undefined
  const [x, y] = [Number(parts[0]), Number(parts[1])]
  const width = positive(parts[2])
  const height = positive(parts[3])
  if (!width || !height || x + width > room.width || y + height > room.height) return undefined
  return { x, y, width, height }
}

// Every screen cut from one room shares the room's seed, so their pieces belong to one picture.
export function roomSeedKey(room: { width: number; height: number }, canvasId: unknown): string {
  return `room:${room.width}x${room.height}:${typeof canvasId === 'string' ? canvasId : ''}`
}
