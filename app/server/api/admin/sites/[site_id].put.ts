export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'site_id')
  if (!isSchemaSiteId(id)) throw problem(400, 'invalid-request', 'site id must be 3-64 of a-z 0-9 -, not starting with -')
  const input = parseSiteInput(await readBody(event))
  const { site, created, warnings } = await putSite(id, input, event.context.admin!)
  setResponseStatus(event, created ? 201 : 200)
  return siteState(site, await readApprovals(), warnings)
})
