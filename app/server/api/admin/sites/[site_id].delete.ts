export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'site_id') ?? ''
  if (!(await deleteSite(id, event.context.admin!))) throw problem(404, 'not-found', `no site ${id}`)
  setResponseStatus(event, 204)
  return null
})
