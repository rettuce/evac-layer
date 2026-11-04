import { liveLayoutGate } from '~~/layout/gate'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const layoutQuery = parseLayoutQuery(query)
  const site = isSiteId(query.site) ? query.site : await defaultSiteFor(layoutQuery.municipality)
  const gate = liveLayoutGate(await readApprovals(), site, layoutQuery.municipality, layoutQuery.bulletin, await currentLayoutDigest(layoutQuery.municipality, layoutQuery.bulletin))
  if (gate !== 'ok') throw createError({ status: 403, statusText: 'Forbidden', data: { reason: gate, site } })
  return readLayout(layoutQuery)
})
