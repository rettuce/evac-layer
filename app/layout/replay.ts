import { isSyntheticBulletinId } from './gate'
import { CLEAR_CROSSFADE_MS, SWITCH_BLACK_MS } from './scenario'
import type { Shape, TemplateId } from './types'

export const DEFAULT_REPLAY_SPEED = 600

export interface ReplayRow {
  issued_at: string
  bulletin_id: string
  raw_title: string
  wmo_code?: string
  municipality_level: number | null
  screen: boolean
  template?: TemplateId
  display_level?: number
  reason?: string
  synthetic?: boolean
}

export interface ReplayIndex {
  municipality: string
  name: string
  rows: ReplayRow[]
}

export interface ReplayStatus extends ReplayIndex {
  window: ReplayWindow
  speed: number
  elapsedMs: number
  index: number
}

export interface ReplayWindow {
  from?: string
  to?: string
}

export function isReplayBound(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

export function rowsInWindow(rows: ReplayRow[], { from, to }: ReplayWindow): ReplayRow[] {
  const start = from ? Date.parse(from) : -Infinity
  const end = to ? Date.parse(to) : Infinity
  return rows.filter((row) => {
    if (row.synthetic || isSyntheticBulletinId(row.bulletin_id)) return false
    const issued = Date.parse(row.issued_at)
    return issued >= start && issued <= end
  })
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

function streamOf(row: ReplayRow): string {
  return row.wmo_code ?? ''
}

// Each bulletin stream (wmo_code) replaces only its own previous bulletin: a prefecture rain advisory
// does not lift a river level 5 that is still in force. The newest stream that has a screen wins.
export function shownRowAt(rows: ReplayRow[], index: number, hasScreenFor: (bulletinId: string) => boolean): number {
  const latestByStream = new Map<string, number>()
  for (let i = 0; i <= index; i++) latestByStream.set(streamOf(rows[i]!), i)
  let shown = -1
  for (const i of latestByStream.values()) {
    if (rows[i]!.screen && hasScreenFor(rows[i]!.bulletin_id) && i > shown) shown = i
  }
  return shown
}

export function currentBulletinAt(
  rows: ReplayRow[],
  elapsedMs: number,
  speed: number,
  hasScreenFor: (bulletinId: string) => boolean,
): string | undefined {
  const shown = shownRowAt(rows, rowIndexAt(rows, elapsedMs, speed), hasScreenFor)
  return shown >= 0 ? rows[shown]!.bulletin_id : undefined
}

function lastChangeAt(rows: ReplayRow[], index: number, hasScreenFor: (bulletinId: string) => boolean): number {
  const current = shownRowAt(rows, index, hasScreenFor)
  let change = index
  while (change > 0 && shownRowAt(rows, change - 1, hasScreenFor) === current) change -= 1
  return change
}

export function liveFrame(
  rows: ReplayRow[],
  elapsedMs: number,
  speed: number,
  hasScreenFor: (bulletinId: string) => boolean,
): LiveFrame {
  const index = rowIndexAt(rows, elapsedMs, speed)
  const ambient: LiveFrame = { index, showingElapsedMs: 0, showingOpacity: 0, black: false, ambientVisible: true }
  if (index < 0) return ambient

  const shown = shownRowAt(rows, index, hasScreenFor)
  const change = lastChangeAt(rows, index, hasScreenFor)
  const previous = change > 0 ? shownRowAt(rows, change - 1, hasScreenFor) : -1
  const sinceChange = elapsedMs - rowStartMs(rows, change, speed)

  if (shown >= 0) {
    const fromAmbient = previous < 0
    if (fromAmbient && sinceChange < SWITCH_BLACK_MS) {
      return { index, showingElapsedMs: 0, showingOpacity: 0, black: true, ambientVisible: false }
    }
    return {
      index,
      showing: rows[shown]!.bulletin_id,
      showingElapsedMs: fromAmbient ? sinceChange - SWITCH_BLACK_MS : sinceChange,
      showingOpacity: 1,
      black: false,
      ambientVisible: false,
    }
  }

  if (previous >= 0 && sinceChange < CLEAR_CROSSFADE_MS) {
    return {
      index,
      showing: rows[previous]!.bulletin_id,
      showingElapsedMs: elapsedMs - rowStartMs(rows, previous, speed),
      showingOpacity: 1 - sinceChange / CLEAR_CROSSFADE_MS,
      black: false,
      ambientVisible: true,
    }
  }
  return ambient
}

export function isBulletinId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value)
}

export function isMunicipalityId(value: unknown): value is string {
  return typeof value === 'string' && /^\d{5}$/.test(value)
}

export { SYNTHETIC_PREFIX, isSyntheticBulletinId } from './gate'
export type { Shape }
