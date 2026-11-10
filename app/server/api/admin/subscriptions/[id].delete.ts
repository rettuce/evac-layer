export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const admin = event.context.admin
  const notFound = () => createError({ status: 404, statusText: 'Not Found', message: `no subscription ${id}` })
  if (!id) throw notFound()
  const subscription = (await readSubscriptions()).find((s) => s.id === id)
  if (!subscription || (admin?.kind === 'facility' && !(await readVisibleSite(subscription.site_id, admin)))) throw notFound()
  if (event.context.audit) event.context.audit.site_id = subscription.site_id
  if (!(await removeSubscription(id))) throw notFound()
  setResponseStatus(event, 204)
  return null
})
