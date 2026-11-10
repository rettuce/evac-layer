import { SITE_MATCH_RADIUS_M, nearestSiteWithin, parseCoordinate } from '~~/layout/nearSite'

export default defineEventHandler(async (event) => {
  if (await isMultiFacilityServer()) throw problem(404, 'place-lookup-disabled', 'this server holds several facilities; read /api/feed/<site id>')
  const query = getQuery(event)
  const lat = parseCoordinate(query.lat, 90)
  const lng = parseCoordinate(query.lng, 180)
  if (lat === undefined || lng === undefined) throw problem(400, 'invalid-request', 'lat (within ±90) and lng (within ±180) are required')
  const hit = nearestSiteWithin(await readSites(), { lat, lng })
  const feed = hit && (await currentFeed(hit.site.id))
  if (!hit || !feed) throw problem(404, 'no-site-near', `no site within ${SITE_MATCH_RADIUS_M} m of ${lat},${lng}`)
  return feedResponse(event, feed, `/api/feed/${encodeURIComponent(hit.site.id)}`)
})
