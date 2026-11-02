import { join } from 'node:path'
import {
  DEFAULT_REPLAY_SPEED,
  isMunicipalityId,
  isReplayBound,
  rowIndexAt,
  rowsInWindow,
  type ReplayIndex,
  type ReplayRow,
  type ReplayStatus,
  type ReplayWindow,
} from '~~/layout/replay'

interface LayoutIndexFile {
  municipality: string
  name: string
  entries: ReplayRow[]
}

interface AgentsReplayFixture {
  municipality: string
  entries: { issued_at: string; bulletin_id: string; wmo_code: string; municipality_level: number | null; alert: { raw_title: string } }[]
}

const replayOrigins = new Map<string, number>()

function sharedReplayOrigin(municipality: string, speed: number, window: ReplayWindow, reset: boolean): number {
  const key = `${municipality}:${speed}:${window.from ?? ''}:${window.to ?? ''}`
  if (reset || !replayOrigins.has(key)) replayOrigins.set(key, Date.now())
  return replayOrigins.get(key)!
}

async function loadReplayIndex(municipality: string): Promise<ReplayIndex | undefined> {
  const index = await readJsonIfExists<LayoutIndexFile>(join(dataDir(), 'layouts', municipality, 'index.json'))
  if (index) return { municipality, name: index.name, rows: index.entries }

  const fixtureDir = join(useRuntimeConfig().repoRoot, 'agents', 'test', 'fixtures')
  const fixtureName = (await listDir(fixtureDir)).find((f) => f.startsWith(`replay-${municipality}-`) && f.endsWith('.json'))
  if (!fixtureName) return undefined
  const fixture = await readJsonIfExists<AgentsReplayFixture>(join(fixtureDir, fixtureName))
  if (!fixture) return undefined
  return {
    municipality,
    name: municipality,
    rows: fixture.entries.map((e) => ({
      issued_at: e.issued_at,
      bulletin_id: e.bulletin_id,
      raw_title: e.alert.raw_title,
      wmo_code: e.wmo_code,
      municipality_level: e.municipality_level,
      screen: true,
    })),
  }
}

export default defineEventHandler(async (event): Promise<ReplayStatus> => {
  const query = getQuery(event)
  if (!isMunicipalityId(query.municipality)) throw createError({ status: 400, statusText: 'Bad Request', message: 'municipality must be a 5-digit code' })
  const speed = Number(query.speed ?? DEFAULT_REPLAY_SPEED)
  if (!(speed > 0)) throw createError({ status: 400, statusText: 'Bad Request', message: 'speed must be positive' })

  const replay = await loadReplayIndex(query.municipality)
  if (!replay) throw createError({ status: 404, statusText: 'Not Found', message: `no replay data for ${query.municipality}` })

  for (const bound of [query.from, query.to]) {
    if (bound !== undefined && !isReplayBound(bound)) throw createError({ status: 400, statusText: 'Bad Request', message: 'from and to must be ISO timestamps' })
  }
  const window: ReplayWindow = { from: query.from as string | undefined, to: query.to as string | undefined }
  const rows = rowsInWindow(replay.rows, window)
  const origin = sharedReplayOrigin(query.municipality, speed, window, query.reset !== undefined)
  const elapsedMs = query.t !== undefined ? Number(query.t) : Date.now() - origin

  return { ...replay, rows, window, speed, elapsedMs, index: rowIndexAt(rows, elapsedMs, speed) }
})
