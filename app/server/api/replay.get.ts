import { join } from 'node:path'
import { DEFAULT_REPLAY_SPEED, isMunicipalityId, rowIndexAt, type ReplayIndex, type ReplayRow, type ReplayStatus } from '~~/layout/replay'

interface LayoutIndexFile {
  municipality: string
  name: string
  entries: ReplayRow[]
}

interface AgentsReplayFixture {
  municipality: string
  entries: { issued_at: string; bulletin_id: string; municipality_level: number | null; alert: { raw_title: string } }[]
}

const replayOrigins = new Map<string, number>()

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
      municipality_level: e.municipality_level,
      screen: true,
    })),
  }
}

export default defineEventHandler(async (event): Promise<ReplayStatus> => {
  assertDev()
  const query = getQuery(event)
  if (!isMunicipalityId(query.municipality)) throw createError({ status: 400, statusText: 'Bad Request', message: 'municipality must be a 5-digit code' })
  const speed = Number(query.speed ?? DEFAULT_REPLAY_SPEED)
  if (!(speed > 0)) throw createError({ status: 400, statusText: 'Bad Request', message: 'speed must be positive' })

  const replay = await loadReplayIndex(query.municipality)
  if (!replay) throw createError({ status: 404, statusText: 'Not Found', message: `no replay data for ${query.municipality}` })

  // All screens polling the same municipality and speed share one origin, so they switch together.
  const key = `${query.municipality}:${speed}`
  if (query.reset !== undefined || !replayOrigins.has(key)) replayOrigins.set(key, Date.now())
  const elapsedMs = query.t !== undefined ? Number(query.t) : Date.now() - replayOrigins.get(key)!

  return { ...replay, speed, elapsedMs, index: rowIndexAt(replay.rows, elapsedMs, speed) }
})
