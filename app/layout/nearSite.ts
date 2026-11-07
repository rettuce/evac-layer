export const SITE_MATCH_RADIUS_M = 100
const EARTH_RADIUS_M = 6_371_000

export interface Point {
  lat: number
  lng: number
}

export function parseCoordinate(value: unknown, limit: number): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= limit ? value : undefined
  if (typeof value !== 'string' || value.trim() === '') return undefined
  return parseCoordinate(Number(value), limit)
}

export function haversineMeters(a: Point, b: Point): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function nearestSiteWithin<S extends { id: string; lat?: unknown; lng?: unknown }>(
  sites: readonly S[],
  point: Point,
  radiusM = SITE_MATCH_RADIUS_M,
): { site: S; distanceM: number } | undefined {
  let best: { site: S; distanceM: number } | undefined
  for (const site of sites) {
    const lat = typeof site.lat === 'number' ? parseCoordinate(site.lat, 90) : undefined
    const lng = typeof site.lng === 'number' ? parseCoordinate(site.lng, 180) : undefined
    if (lat === undefined || lng === undefined) continue
    const distanceM = haversineMeters(point, { lat, lng })
    if (distanceM > radiusM) continue
    if (!best || distanceM < best.distanceM || (distanceM === best.distanceM && site.id < best.site.id)) best = { site, distanceM }
  }
  return best
}
