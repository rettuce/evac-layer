import {
  DEFAULT_REPLAY_SPEED,
  isReplayBound,
  isSyntheticBulletinId,
  rowIndexAt,
  rowsInWindow,
  type ReplayRow,
  type ReplayStatus,
  type ReplayWindow,
} from '~~/layout/replay'
import { firstDeliverable } from '~~/layout/liveState'

const LIVE_SPEED = 1

// A live site has at most one row: the bulletin the receiver posted, started at the moment it was posted,
// so the screen runs the same switch-in as a replayed bulletin.
async function liveStatus(site: SiteFile, t: unknown): Promise<ReplayStatus> {
  const [state, index] = await Promise.all([readLiveState(site.id), readLayoutIndex(site.id)])
  const name = index?.name ?? site.name ?? ''
  const base = { municipality: site.municipality_id, name, window: {}, speed: LIVE_SPEED }
  if (!state?.bulletin_id) return { ...base, rows: [], elapsedMs: 0, index: -1 }
  const bulletin = (await firstDeliverable(state, (id) => isDeliverable(site.id, id))) ?? state.bulletin_id
  if (isSyntheticBulletinId(bulletin)) return { ...base, rows: [], elapsedMs: 0, index: -1 }
  const known = index?.entries.find((entry) => entry.bulletin_id === bulletin)
  const row: ReplayRow = { raw_title: '', municipality_level: null, ...known, bulletin_id: bulletin, issued_at: state.updated_at, screen: true }
  const elapsedMs = t !== undefined ? Number(t) : Date.now() - Date.parse(state.updated_at)
  return { ...base, rows: [row], elapsedMs, index: rowIndexAt([row], elapsedMs, LIVE_SPEED) }
}

export default defineEventHandler(async (event): Promise<ReplayStatus> => {
  const query = getQuery(event)
  const site = await resolveSite(query)
  // `municipality=` is the pre-site URL: it always replays the record, with the window and speed of the query.
  const bySite = query.municipality === undefined
  if (bySite && !site.replay) return liveStatus(site, query.t)

  const siteReplay = bySite ? site.replay : undefined
  const speed = Number(query.speed ?? siteReplay?.speed ?? DEFAULT_REPLAY_SPEED)
  if (!(speed > 0)) throw createError({ status: 400, statusText: 'Bad Request', message: 'speed must be positive' })
  for (const bound of [query.from, query.to]) {
    if (bound !== undefined && !isReplayBound(bound)) throw createError({ status: 400, statusText: 'Bad Request', message: 'from and to must be ISO timestamps' })
  }
  const window: ReplayWindow = { from: (query.from as string | undefined) ?? siteReplay?.from, to: (query.to as string | undefined) ?? siteReplay?.to }

  const replay = await loadReplayIndex(site)
  if (!replay) throw createError({ status: 404, statusText: 'Not Found', message: `no replay data for ${site.id}` })
  const rows = rowsInWindow(replay.rows, window)
  // With several facilities anyone could restart another facility's replay.
  const reset = query.reset !== undefined && !(await isMultiFacilityServer())
  const origin = sharedReplayOrigin(site.id, speed, window, reset)
  const elapsedMs = query.t !== undefined ? Number(query.t) : Date.now() - origin

  return { ...replay, rows, window, speed, elapsedMs, index: rowIndexAt(rows, elapsedMs, speed) }
})
