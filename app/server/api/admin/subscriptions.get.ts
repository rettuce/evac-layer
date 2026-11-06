export default defineEventHandler(async (event) => {
  const { site } = getQuery(event)
  if (site !== undefined && !isSiteId(site)) throw createError({ status: 400, statusText: 'Bad Request', message: 'site id is invalid' })
  const subscriptions = (await readSubscriptions()).filter((s) => site === undefined || s.site_id === site)
  return { subscriptions: subscriptions.map(publicSubscription) }
})
