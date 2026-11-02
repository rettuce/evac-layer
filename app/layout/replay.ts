import { CLEAR_CROSSFADE_MS, SWITCH_BLACK_MS } from './scenario'
import type { Shape, TemplateId } from './types'

export const DEFAULT_REPLAY_SPEED = 600

export interface ReplayRow {
  issued_at: string
  bulletin_id: string
  raw_title: string
  municipality_level: number | null
  screen: boolean
  template?: TemplateId
  display_level?: number
  reason?: string
}

export interface ReplayIndex {
  municipality: string
  name: string
  rows: ReplayRow[]
}

export interface ReplayStatus extends ReplayIndex {
  speed: number
  elapsedMs: number
  index: number
}

export function rowStartMs(rows: ReplayRow[], index: number, speed: number): number {
  if (index < 0 || !rows.length) return 0
  return (Date.parse(rows[index]!.issued_at) - Date.parse(rows[0]!.issued_at)) / speed
}

export function rowIndexAt(rows: ReplayRow[], elapsedMs: number, speed: number): number {
  let index = -1
  for (let i = 0; i < rows.length; i++) {
    if (rowStartMs(rows, i, speed) <= elapsedMs) index = i
  }
  return index
}

export function replayClockEpochMs(rows: ReplayRow[], elapsedMs: number, speed: number): number {
  return rows.length ? Date.parse(rows[0]!.issued_at) + elapsedMs * speed : 0
}

export interface LiveFrame {
  index: number
  showing?: string
  showingElapsedMs: number
  showingOpacity: number
  black: boolean
  ambientVisible: boolean
}

export function liveFrame(
  rows: ReplayRow[],
  elapsedMs: number,
  speed: number,
  hasScreenFor: (bulletinId: string) => boolean,
): LiveFrame {
  const index = rowIndexAt(rows, elapsedMs, speed)
  const showable = (i: number) => i >= 0 && rows[i]!.screen && hasScreenFor(rows[i]!.bulletin_id)
  const sinceRow = elapsedMs - rowStartMs(rows, index, speed)

  if (showable(index)) {
    const fromAmbient = !showable(index - 1)
    if (fromAmbient && sinceRow < SWITCH_BLACK_MS) {
      return { index, showingElapsedMs: 0, showingOpacity: 0, black: true, ambientVisible: false }
    }
    return {
      index,
      showing: rows[index]!.bulletin_id,
      showingElapsedMs: fromAmbient ? sinceRow - SWITCH_BLACK_MS : sinceRow,
      showingOpacity: 1,
      black: false,
      ambientVisible: false,
    }
  }

  if (showable(index - 1) && sinceRow < CLEAR_CROSSFADE_MS) {
    const previous = index - 1
    return {
      index,
      showing: rows[previous]!.bulletin_id,
      showingElapsedMs: elapsedMs - rowStartMs(rows, previous, speed),
      showingOpacity: 1 - sinceRow / CLEAR_CROSSFADE_MS,
      black: false,
      ambientVisible: true,
    }
  }
  return { index, showingElapsedMs: 0, showingOpacity: 0, black: false, ambientVisible: true }
}

export function isBulletinId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value)
}

export function isMunicipalityId(value: unknown): value is string {
  return typeof value === 'string' && /^\d{5}$/.test(value)
}

export type { Shape }
