export default defineEventHandler(async (event) => {
  const { site } = getQuery(event)
  const admin = event.context.admin
  if (site === undefined && admin?.kind === 'facility') throw createError({ status: 400, statusText: 'Bad Request', message: 'site is required' })
  if (site !== undefined && !isSiteId(site)) throw createError({ status: 400, statusText: 'Bad Request', message: 'site id is invalid' })
  if (site !== undefined && admin?.kind === 'facility') await readSiteOr404(site, admin)
  const subscriptions = (await readSubscriptions()).filter((s) => site === undefined || s.site_id === site)
  return { subscriptions: subscriptions.map(publicSubscription) }
})
