export const SITE_MATCH_RADIUS_M = 100
const EARTH_RADIUS_M = 6_371_008.8

export interface Point {
  lat: number
  lng: number
}

export function parseCoordinate(value: unknown, limit: number): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : undefined
}

export function haversineMeters(a: Point, b: Point): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function nearestSiteWithin<S extends { lat?: number; lng?: number }>(
  sites: readonly S[],
  point: Point,
  radiusM = SITE_MATCH_RADIUS_M,
): { site: S; distanceM: number } | undefined {
  let best: { site: S; distanceM: number } | undefined
  for (const site of sites) {
    if (typeof site.lat !== 'number' || typeof site.lng !== 'number') continue
    const distanceM = haversineMeters(point, { lat: site.lat, lng: site.lng })
    if (distanceM <= radiusM && (!best || distanceM < best.distanceM)) best = { site, distanceM }
  }
  return best
}
