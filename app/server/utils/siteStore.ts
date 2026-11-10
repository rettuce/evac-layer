import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { GSI_REVERSE_GEOCODER, InvalidCoordinates, MunicipalityLookupFailed, buildSite } from '~~/layout/siteRegister'
import type { AdminPrincipal } from './adminPolicy'

// The patterns of schema/site.schema.json. The server has no JSON Schema validator; the tests check written
// files against the schema itself.
const SCHEMA_SITE_ID = /^[a-z0-9][a-z0-9-]{2,63}$/
const MUNICIPALITY_ID = /^\d{5}$/
const SITE_FIELDS = new Set(['id', 'municipality_id', 'lat', 'lng', 'facing_deg', 'name', 'note', 'facility_id', 'location_updated_at', 'replay'])
const REPLAY_FIELDS = new Set(['municipality', 'from', 'to', 'speed'])
const INPUT_FIELDS = new Set(['lat', 'lng', 'facing_deg', 'name', 'municipality_id', 'actor'])

export interface SiteInput {
  lat: number
  lng: number
  facing_deg: number
  name?: string
  municipality_id?: string
}

type StoredSite = { kind: 'none' } | { kind: 'site'; site: SiteFile } | { kind: 'unreadable'; error: unknown }

const siteLocks = new Map<string, ReturnType<typeof serialQueue>>()
let partialCounter = 0

function invalid(message: string): never {
  throw problem(400, 'invalid-request', message)
}

const isNumberIn = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0

export function isSchemaSiteId(id: unknown): id is string {
  return typeof id === 'string' && SCHEMA_SITE_ID.test(id)
}

export function parseSiteInput(body: unknown): SiteInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) invalid('the body must be an object { lat, lng, facing_deg, name?, municipality_id?, actor? }')
  const input = body as Record<string, unknown>
  const unknown = Object.keys(input).find((key) => !INPUT_FIELDS.has(key))
  if (unknown) invalid(`unknown field ${unknown}`)
  if (!isNumberIn(input.lat, -90, 90)) invalid('lat must be a number within ±90')
  if (!isNumberIn(input.lng, -180, 180)) invalid('lng must be a number within ±180')
  if (!isNumberIn(input.facing_deg, 0, 360)) invalid('facing_deg must be a number from 0 to 360')
  if (input.name !== undefined && !isText(input.name)) invalid('name must be a non-empty string')
  if (input.municipality_id !== undefined && !(typeof input.municipality_id === 'string' && MUNICIPALITY_ID.test(input.municipality_id))) invalid('municipality_id must be 5 digits')
  return { lat: input.lat, lng: input.lng, facing_deg: input.facing_deg, name: input.name as string | undefined, municipality_id: input.municipality_id as string | undefined }
}

function schemaProblem(site: Record<string, unknown>): string | undefined {
  const unknown = Object.keys(site).find((key) => !SITE_FIELDS.has(key))
  if (unknown) return `the site would carry ${unknown}, which schema/site.schema.json does not allow`
  if (!isSchemaSiteId(site.id)) return 'id must be 3-64 of a-z 0-9 -, not starting with -'
  if (!(typeof site.municipality_id === 'string' && MUNICIPALITY_ID.test(site.municipality_id))) return 'municipality_id must be 5 digits'
  if (!isNumberIn(site.lat, -90, 90) || !isNumberIn(site.lng, -180, 180) || !isNumberIn(site.facing_deg, 0, 360)) return 'lat, lng or facing_deg is out of range'
  if (site.name !== undefined && !isText(site.name)) return 'name must be a non-empty string'
  if (site.note !== undefined && typeof site.note !== 'string') return 'note must be a string'
  if (site.facility_id !== undefined && !isSchemaSiteId(site.facility_id)) return 'facility_id is invalid'
  if (site.location_updated_at !== undefined && Number.isNaN(Date.parse(String(site.location_updated_at)))) return 'location_updated_at must be a date-time'
  if (site.replay !== undefined) {
    const replay = site.replay as Record<string, unknown>
    const valid =
      typeof replay === 'object' && replay !== null &&
      Object.keys(replay).every((key) => REPLAY_FIELDS.has(key)) &&
      isText(replay.from) && isText(replay.to) && typeof replay.speed === 'number' && replay.speed > 0 &&
      (replay.municipality === undefined || (typeof replay.municipality === 'string' && MUNICIPALITY_ID.test(replay.municipality)))
    if (!valid) return 'replay does not match schema/site.schema.json'
  }
  return undefined
}

export function siteFilePath(id: string): string {
  return join(dataDir(), 'sites', `${id}.json`)
}

// A file that cannot be read, or that names another id, may belong to anyone: it is never taken as "no site".
async function storedSite(id: string): Promise<StoredSite> {
  try {
    const site = await readJsonIfExists<SiteFile>(siteFilePath(id))
    if (site === undefined) return { kind: 'none' }
    return site?.id === id ? { kind: 'site', site } : { kind: 'unreadable', error: new Error(`sites/${id}.json does not hold site ${id}`) }
  } catch (error) {
    return { kind: 'unreadable', error }
  }
}

function assertMayWrite(id: string, admin: AdminPrincipal, stored: StoredSite): void {
  if (admin.kind === 'operator') {
    if (stored.kind === 'unreadable') throw stored.error
    return
  }
  if (stored.kind === 'none' || (stored.kind === 'site' && stored.site.facility_id === admin.facility_id)) return
  throw problem(409, 'site-id-taken', `site id ${id} is taken; choose another id`)
}

export function withSiteLock<T>(id: string, task: () => Promise<T>): Promise<T> {
  let lock = siteLocks.get(id)
  if (!lock) siteLocks.set(id, (lock = serialQueue()))
  return lock(task)
}

async function placeSite(id: string, input: SiteInput) {
  try {
    return await buildSite({ id, ...input }, fetch, { url: useRuntimeConfig().reverseGeocoderUrl || GSI_REVERSE_GEOCODER })
  } catch (error) {
    if (error instanceof MunicipalityLookupFailed) throw problem(502, 'geocoder-unavailable', `${error.message}; give municipality_id to register without it`)
    if (error instanceof InvalidCoordinates) invalid(error.message)
    throw error
  }
}

// Spreading the stored site first keeps its field order, so the same body twice writes the same bytes.
function mergedSite(previous: SiteFile | undefined, placed: SiteFile, admin: AdminPrincipal): SiteFile {
  const moved = !previous || previous.lat !== placed.lat || previous.lng !== placed.lng || previous.facing_deg !== placed.facing_deg
  return {
    ...previous,
    id: placed.id,
    municipality_id: placed.municipality_id,
    lat: placed.lat,
    lng: placed.lng,
    facing_deg: placed.facing_deg,
    name: placed.name ?? previous?.name,
    facility_id: previous ? previous.facility_id : admin.kind === 'facility' ? admin.facility_id : undefined,
    location_updated_at: moved ? new Date().toISOString() : previous?.location_updated_at,
  }
}

async function writeSiteFile(site: SiteFile): Promise<void> {
  const file = siteFilePath(site.id)
  await mkdir(join(dataDir(), 'sites'), { recursive: true })
  const partial = `${file}.${process.pid}.${++partialCounter}.tmp`
  await writeFile(partial, `${JSON.stringify(site, null, 2)}\n`)
  await rename(partial, file)
}

export async function putSite(id: string, input: SiteInput, admin: AdminPrincipal): Promise<{ site: SiteFile; created: boolean; warnings: string[] }> {
  assertMayWrite(id, admin, await storedSite(id))
  const { site: placed, warnings } = await placeSite(id, input)
  return withSiteLock(id, async () => {
    const stored = await storedSite(id)
    assertMayWrite(id, admin, stored)
    const previous = stored.kind === 'site' ? stored.site : undefined
    const site = mergedSite(previous, placed, admin)
    const reason = schemaProblem(JSON.parse(JSON.stringify(site)))
    if (reason) invalid(reason)
    if (JSON.stringify(site) !== JSON.stringify(previous)) await writeSiteFile(site)
    return { site, created: !previous, warnings }
  })
}

function withoutSite<T>(record: Record<string, T>, id: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !key.startsWith(`${id}/`)))
}

// The site file goes last: a removal that stops half way leaves a site that can be removed again, never
// approvals or registrations of a site that no longer exists.
export function deleteSite(id: string, admin: AdminPrincipal): Promise<boolean> {
  return withSiteLock(id, async () => {
    if (!(await readVisibleSite(id, admin))) return false
    await removeSubscriptionsOf(id)
    await updateApprovals((approvals) => {
      approvals.layouts = withoutSite(approvals.layouts, id)
      approvals.classes = withoutSite(approvals.classes ?? {}, id)
      delete approvals.sites[id]
    })
    const live = join(dataDir(), 'live')
    const remove = (path: string) => rm(path, { recursive: true, force: true })
    await Promise.all([join(live, `${id}.json`), join(live, `${id}.receiver.json`), exportRecordFile(id)].map(remove))
    await Promise.all([join(distDir(), id), join(dataDir(), 'layouts', id), join(dataDir(), 'reports', id)].map(remove))
    await remove(siteFilePath(id))
    return true
  })
}
