export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const layoutQuery = parseLayoutQuery(query)
  const site = isSiteId(query.site) ? query.site : await defaultSiteFor(layoutQuery.municipality)
  const approvals = await readApprovals()
  if (!site || !approvals.sites[site]?.auto_publish) {
    throw createError({ status: 403, statusText: 'Forbidden', data: { reason: 'auto-publish-off', site } })
  }
  if (!approvals.layouts[layoutKey(layoutQuery.municipality, layoutQuery.bulletin)]?.approved) {
    throw createError({ status: 403, statusText: 'Forbidden', data: { reason: 'unapproved', site } })
  }
  return readLayout(layoutQuery)
})
