export default defineEventHandler(async (event) => {
  const site = getRouterParam(event, 'site')
  if (!isSiteId(site)) throw createError({ status: 400, statusText: 'Bad Request', message: 'site id is invalid' })
  const generation = siteGeneration(site)
  const feed = await currentFeed(site, (found) => noteSiteRequest(found, generation))
  if (!feed) throw createError({ status: 404, statusText: 'Not Found', message: `no site ${site}` })
  return feedResponse(event, feed)
})
