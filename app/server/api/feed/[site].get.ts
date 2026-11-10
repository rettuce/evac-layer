export default defineEventHandler(async (event) => {
  const site = getRouterParam(event, 'site')
  if (!isSiteId(site)) throw createError({ status: 400, statusText: 'Bad Request', message: 'site id is invalid' })
  const feed = await currentFeed(site)
  if (!feed) throw createError({ status: 404, statusText: 'Not Found', message: `no site ${site}` })
  return feedResponse(event, feed)
})
