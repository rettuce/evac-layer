import { liveLayoutGate } from '~~/layout/gate'

export default defineEventHandler(async (event) => {
  const layoutQuery = await parseLayoutQuery(getQuery(event))
  const { site, bulletin } = layoutQuery
  const snapshot = await readLayoutSnapshot(site, bulletin)
  const gate = liveLayoutGate(await readApprovals(), site, bulletin, snapshot?.digest, snapshot?.cls)
  if (gate !== 'ok') throw createError({ status: 403, statusText: 'Forbidden', data: { reason: gate, site } })
  const file = snapshot?.files.find((f) => f.shape === layoutQuery.shape)
  if (!file) throw createError({ status: 404, statusText: 'Not Found', message: `no layout for ${site} ${bulletin} ${layoutQuery.shape}` })
  return JSON.parse(file.body)
})
