export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'site_id') ?? ''
  const site = await readVisibleSite(id, event.context.admin)
  if (!site) throw problem(404, 'not-found', `no site ${id}`)
  return siteState(site, await readApprovals())
})
