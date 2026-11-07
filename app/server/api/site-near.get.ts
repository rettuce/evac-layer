import { nearestSiteWithin, parseCoordinate, SITE_MATCH_RADIUS_M } from '~~/layout/nearSite'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const lat = parseCoordinate(query.lat, 90)
  const lng = parseCoordinate(query.lng, 180)
  if (lat === undefined || lng === undefined) throw createError({ status: 400, statusText: 'Bad Request', message: 'lat and lng are required' })
  const hit = nearestSiteWithin(await readSites(), { lat, lng })
  return { radius_m: SITE_MATCH_RADIUS_M, site: hit?.site.id ?? null, distance_m: hit ? Math.round(hit.distanceM * 10) / 10 : null }
})
