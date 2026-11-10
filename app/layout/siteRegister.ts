import { parseCoordinate } from './nearSite'

export const GSI_REVERSE_GEOCODER = 'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress'
const REVERSE_GEOCODER_TIMEOUT_MS = 10_000

export { parseCoordinate }

export class MunicipalityLookupFailed extends Error {}
// The geocoder answered, but the point is in no municipality (at sea, outside Japan): asking again will not help.
export class NoMunicipalityAt extends MunicipalityLookupFailed {}
export class InvalidCoordinates extends Error {}

export interface RegisteredSite {
  id: string
  municipality_id: string
  lat: number
  lng: number
  facing_deg: number
  name?: string
  facility_id?: string
  location_updated_at?: string
}

export interface GeocoderOptions {
  fetchFn?: typeof fetch
  timeoutMs?: number
  url?: string
}

export function assertCoordinates(lat: unknown, lng: unknown): { lat: number; lng: number } {
  const la = parseCoordinate(lat, 90)
  const ln = parseCoordinate(lng, 180)
  if (la === undefined || ln === undefined) throw new InvalidCoordinates(`invalid coordinates ${String(lat)},${String(lng)}: lat must be within ±90 and lng within ±180`)
  return { lat: la, lng: ln }
}

export async function municipalityAt(lat: number, lng: number, fetchFn: typeof fetch = fetch, timeoutMs = REVERSE_GEOCODER_TIMEOUT_MS, url = GSI_REVERSE_GEOCODER): Promise<string> {
  assertCoordinates(lat, lng)
  let body: unknown
  try {
    const res = await fetchFn(`${url}?lat=${lat}&lon=${lng}`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    body = await res.json()
  } catch (e) {
    throw new MunicipalityLookupFailed(`GSI reverse geocoder failed for ${lat},${lng}: ${(e as Error).message}`)
  }
  const code = (body as { results?: { muniCd?: unknown } } | null)?.results?.muniCd
  if (code === undefined || code === null || code === '') {
    throw new NoMunicipalityAt(`GSI reverse geocoder places ${lat},${lng} in no municipality (outside Japan or at sea?)`)
  }
  if (typeof code !== 'string' || !/^\d{5}$/.test(code)) {
    throw new MunicipalityLookupFailed(`GSI reverse geocoder returned an unusable municipality code for ${lat},${lng}`)
  }
  return code
}

export interface SiteRegistration {
  id: string
  lat: number
  lng: number
  facing_deg: number
  name?: string
  municipality_id?: string
}

// A given municipality_id wins over the geocoder: the caller may know better near a border. A mismatch is reported,
// not refused.
export async function buildSite(input: SiteRegistration, fetchFn: typeof fetch = fetch, options: Omit<GeocoderOptions, 'fetchFn'> = {}): Promise<{ site: RegisteredSite; warnings: string[] }> {
  const { lat, lng } = assertCoordinates(input.lat, input.lng)
  const warnings: string[] = []
  let looked: string
  try {
    looked = await municipalityAt(lat, lng, fetchFn, options.timeoutMs, options.url)
  } catch (e) {
    if (!input.municipality_id) throw e
    warnings.push(`${(e as Error).message}; keeping the given municipality_id ${input.municipality_id} unchecked`)
    looked = input.municipality_id
  }
  const municipality_id = input.municipality_id ?? looked
  if (input.municipality_id && input.municipality_id !== looked) {
    warnings.push(`municipality_id ${input.municipality_id} was given, but GSI places ${lat},${lng} in ${looked}; keeping ${input.municipality_id}`)
  }
  const site: RegisteredSite = { id: input.id, municipality_id, lat, lng, facing_deg: input.facing_deg }
  if (input.name) site.name = input.name
  return { site, warnings }
}
