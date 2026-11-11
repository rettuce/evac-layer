export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'site_id') ?? ''
  const state = await readWhileOwned(id, { visible: () => readVisibleSite(id, event.context.admin), read: async (site) => siteState(site, await readApprovals()) })
  if (!state) throw problem(404, 'not-found', `no site ${id}`)
  return state
})
