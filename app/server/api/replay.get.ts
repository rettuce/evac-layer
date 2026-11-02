import {
  DEFAULT_REPLAY_SPEED,
  isMunicipalityId,
  isReplayBound,
  rowIndexAt,
  rowsInWindow,
  type ReplayStatus,
  type ReplayWindow,
} from '~~/layout/replay'

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
