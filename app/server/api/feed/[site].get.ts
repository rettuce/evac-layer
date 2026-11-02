export default defineEventHandler(async (event) => {
  const site = getRouterParam(event, 'site')
  if (!isSiteId(site)) throw createError({ status: 400, statusText: 'Bad Request', message: 'site id is invalid' })
  const feed = await currentFeed(site)
  if (!feed) throw createError({ status: 404, statusText: 'Not Found', message: `no site ${site}` })

  const body = JSON.stringify(feed)
  const etag = feedEtag(body)
  setResponseHeaders(event, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'ETag',
    'Cache-Control': 'no-cache',
    ETag: etag,
  })
  if (etagMatches(getHeader(event, 'if-none-match'), etag)) {
    setResponseStatus(event, 304)
    return null
  }
  setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8')
  return body
})
