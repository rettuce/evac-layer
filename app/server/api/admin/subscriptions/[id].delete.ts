export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const admin = event.context.admin
  const notFound = () => createError({ status: 404, statusText: 'Not Found', message: `no subscription ${id}` })
  if (!id) throw notFound()
  const subscription = (await readSubscriptions()).find((s) => s.id === id)
  const site = subscription && (await readSite(subscription.site_id))
  if (!subscription || (admin?.kind === 'facility' && !(site && siteVisibleTo(admin, site)))) throw notFound()
  if (!(await removeSubscription(id))) throw notFound()
  setResponseStatus(event, 204)
  return null
})
