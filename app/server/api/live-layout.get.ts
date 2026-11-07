import { liveLayoutGate } from '~~/layout/gate'

export default defineEventHandler(async (event) => {
  const layoutQuery = await parseLayoutQuery(getQuery(event))
  const { site, bulletin } = layoutQuery
  const gate = liveLayoutGate(await readApprovals(), site, bulletin, await currentLayoutDigest(site, bulletin), await currentClassOf(site, bulletin))
  if (gate !== 'ok') throw createError({ status: 403, statusText: 'Forbidden', data: { reason: gate, site } })
  return readLayout(layoutQuery)
})
