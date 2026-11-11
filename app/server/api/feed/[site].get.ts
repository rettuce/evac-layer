export default defineEventHandler(async (event) => {
  const site = getRouterParam(event, 'site')
  if (!isSiteId(site)) throw createError({ status: 400, statusText: 'Bad Request', message: 'site id is invalid' })
  const generation = siteGeneration(site)
  const feed = await currentFeed(site)
  if (!feed) throw createError({ status: 404, statusText: 'Not Found', message: `no site ${site}` })
  noteFeedRequest(site, generation)
  return feedResponse(event, feed)
})
