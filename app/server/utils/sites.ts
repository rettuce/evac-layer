import { join } from 'node:path'
import { isMunicipalityId } from '~~/layout/replay'
import type { AdminPrincipal } from './adminPolicy'

const SITE_ID = /^[A-Za-z0-9_-]{1,80}$/

export interface SiteReplay {
  municipality?: string
  from?: string
  to?: string
  speed?: number
}

export interface SiteFile {
  id: string
  municipality_id: string
  name?: string
  note?: string
  lat?: number
  lng?: number
  facing_deg?: number
  facility_id?: string
  location_updated_at?: string
  replay?: SiteReplay
}

const misnamed = new Set<string>()
const unreadable = new Set<string>()

export function isSiteId(value: unknown): value is string {
  return typeof value === 'string' && SITE_ID.test(value)
}

export async function readSites(): Promise<SiteFile[]> {
  const dir = join(dataDir(), 'sites')
  const files = (await listDir(dir)).filter((f) => f.endsWith('.json'))
  const sites = await Promise.all(
    files.map(async (file) => {
      let site: SiteFile | undefined
      try {
        site = await readJsonIfExists<SiteFile>(join(dir, file))
      } catch (error) {
        if (!unreadable.has(file)) {
          unreadable.add(file)
          console.warn(`[sites] ${file} is skipped: ${(error as Error).message}`)
        }
        return undefined
      }
      if (site && `${site.id}.json` === file) return site
      if (site && !misnamed.has(file)) {
        misnamed.add(file)
        console.warn(`[sites] ${file} is ignored: a site file must be named <id>.json (id ${site.id})`)
      }
      return undefined
    }),
  )
  return sites.filter((site): site is SiteFile => site !== undefined)
}

export async function readSite(id: string): Promise<SiteFile | undefined> {
  if (!isSiteId(id)) return undefined
  const site = await readJsonIfExists<SiteFile>(join(dataDir(), 'sites', `${id}.json`))
  return site?.id === id ? site : undefined
}

export function siteVisibleTo(admin: AdminPrincipal | undefined, site: SiteFile): boolean {
  return admin?.kind !== 'facility' || (site.facility_id !== undefined && site.facility_id === admin.facility_id)
}

// A site of another facility answers exactly as a missing one, so a facility cannot find others by probing
// ids; a site file that cannot be read may be another facility's, so it answers a facility the same way.
export async function readVisibleSite(id: string, admin: AdminPrincipal | undefined): Promise<SiteFile | undefined> {
  try {
    const site = await readSite(id)
    return site && siteVisibleTo(admin, site) ? site : undefined
  } catch (error) {
    if (admin?.kind === 'facility') return undefined
    throw error
  }
}

export function siteNotFound(id: string) {
  return createError({ status: 404, statusText: 'Not Found', message: `no site ${id}` })
}

export async function readSiteOr404(id: string, admin: AdminPrincipal | undefined): Promise<SiteFile> {
  const site = await readVisibleSite(id, admin)
  if (!site) throw siteNotFound(id)
  return site
}

export async function sitesOf(municipality: string): Promise<SiteFile[]> {
  return (await readSites()).filter((site) => site.municipality_id === municipality)
}

function badRequest(message: string): never {
  throw createError({ status: 400, statusText: 'Bad Request', message })
}

// `site` names the screen. `municipality` alone is the pre-site alias: it stands for the municipality's
// only site, because with two sites it cannot tell whose arrows and shelters to serve.
// A facility credential always names the site: the alias would resolve through sites it may not see. So does every
// caller without a credential on a server of several facilities, where a facility could add a site to a municipality
// to change what the alias names.
export async function resolveSite({ site, municipality }: { site?: unknown; municipality?: unknown }, admin?: AdminPrincipal): Promise<SiteFile> {
  if (site !== undefined) {
    if (!isSiteId(site)) badRequest('site id is invalid')
    const found = await readSiteOr404(site, admin)
    if (municipality !== undefined && municipality !== found.municipality_id && municipality !== found.replay?.municipality) {
      badRequest(`site ${site} is in municipality ${found.municipality_id}, not ${String(municipality)}`)
    }
    return found
  }
  if (admin?.kind === 'facility') badRequest('site is required')
  if (!admin && (await isMultiFacilityServer())) badRequest('site is required on this server')
  if (!isMunicipalityId(municipality)) badRequest('site is required (or municipality, when it has exactly one site)')
  const sites = await sitesOf(municipality)
  if (sites.length === 1) return sites[0]!
  badRequest(
    sites.length
      ? `municipality ${municipality} has ${sites.length} sites (${sites.map((s) => s.id).join(', ')}); specify site=<site id>`
      : `municipality ${municipality} has no site; specify site=<site id>`,
  )
}
