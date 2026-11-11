import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type Approvals, type CheckReport, type LayoutClass, classDigest, layoutDigest, passedBrowserCheck, screenClass } from '~~/layout/gate'
import { type HeadlineTables, headlineEvidence } from '~~/layout/headlineTable'
import { isMunicipalityId } from '~~/layout/replay'
import { isShape } from '~~/layout/shapes'

const EMPTY: Approvals = { version: '0.1', layouts: {}, sites: {}, classes: {} }
const approvalsQueue = serialQueue()
const warnedLegacyKeys = new Set<string>()

export function approvalsFile(): string {
  return join(dataDir(), 'approvals.json')
}

// On a server of several facilities an old key is never read as a site's: whose it would be depends on which sites
// exist in the municipality, and facilities register and delete those. Such keys are kept in the file untouched.
async function withSiteKeys(approvals: Approvals, multiFacility: boolean): Promise<{ view: Approvals; kept: Approvals['layouts'] }> {
  const sites = await readSites()
  const siteIds = new Set(sites.map((site) => site.id))
  const layouts: Approvals['layouts'] = {}
  const legacy: [string, string, string][] = []
  for (const [key, record] of Object.entries(approvals.layouts)) {
    const [owner = '', bulletin = ''] = key.split('/')
    if (!siteIds.has(owner) && isMunicipalityId(owner)) legacy.push([key, owner, bulletin])
    else layouts[key] = record
  }
  if (multiFacility) return { view: { ...approvals, layouts }, kept: Object.fromEntries(legacy.map(([key]) => [key, approvals.layouts[key]!])) }
  for (const [key, municipality, bulletin] of legacy) {
    const owners = sites.filter((site) => site.municipality_id === municipality)
    if (owners.length === 1) {
      layouts[`${owners[0]!.id}/${bulletin}`] ??= approvals.layouts[key]!
    } else if (!warnedLegacyKeys.has(key)) {
      warnedLegacyKeys.add(key)
      console.warn(`[approvals] ${key} is ignored: municipality ${municipality} has ${owners.length} sites; approve it again per site`)
    }
  }
  return { view: { ...approvals, layouts }, kept: {} }
}

async function readApprovalsKeeping(): Promise<{ view: Approvals; kept: Approvals['layouts'] }> {
  const stored = await readJsonIfExists<Approvals>(approvalsFile())
  if (!stored) return { view: structuredClone(EMPTY), kept: {} }
  return withSiteKeys({ ...stored, classes: stored.classes ?? {} }, await isMultiFacilityServer())
}

export async function readApprovals(): Promise<Approvals> {
  return (await readApprovalsKeeping()).view
}

async function layoutFiles(site: string, bulletin: string): Promise<{ shape: string; body: string }[]> {
  const dir = siteLayoutsDir(site, bulletin)
  const shapes = (await listDir(dir)).filter((f) => f.endsWith('.json') && isShape(f.slice(0, -5)))
  return Promise.all(shapes.map(async (f) => ({ shape: f.slice(0, -5), body: await readFile(join(dir, f), 'utf8') })))
}

export interface LayoutSnapshot {
  files: { shape: string; body: string }[]
  digest: string
  cls: LayoutClass
  report?: CheckReport
}

async function rowStatus(site: string, bulletin: string): Promise<string | undefined> {
  return (await readLayoutIndex(site))?.entries.find((row) => row.bulletin_id === bulletin)?.status
}

export async function readHeadlineTables(): Promise<HeadlineTables | undefined> {
  const [names, easy] = await Promise.all([
    readJsonIfExists<HeadlineTables['names']>(join(dataDir(), 'jma', 'warning-names.json')),
    readJsonIfExists<HeadlineTables['easy']>(join(dataDir(), 'jma', 'warning-names-ja-easy.json')),
  ])
  return names && easy ? { names, easy } : undefined
}

// One read of a bulletin's shape files and report: the gate decides on these bytes and the feed serves them.
export async function readLayoutSnapshot(site: string, bulletin: string): Promise<LayoutSnapshot | undefined> {
  const files = await layoutFiles(site, bulletin)
  if (!files.length) return undefined
  const report = await readJsonIfExists<CheckReport>(join(dataDir(), 'reports', site, bulletin, 'report.json'))
  const digest = layoutDigest(files)
  return {
    files,
    digest,
    cls: {
      key: screenClass(JSON.parse(files[0]!.body), await rowStatus(site, bulletin)), digest: classDigest(files), checked: passedBrowserCheck(report, digest),
      headline: headlineEvidence({ files, digest, report, tables: await readHeadlineTables() }),
    },
    ...(report ? { report } : {}),
  }
}

export async function currentClassKey(site: string, bulletin: string): Promise<string | undefined> {
  try {
    const [first] = await layoutFiles(site, bulletin)
    return first && screenClass(JSON.parse(first.body), await rowStatus(site, bulletin))
  } catch {
    return undefined
  }
}

function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
}

async function writeApprovals(approvals: Approvals): Promise<void> {
  const stable: Approvals = { version: '0.1', layouts: sortedRecord(approvals.layouts), sites: sortedRecord(approvals.sites), classes: sortedRecord(approvals.classes ?? {}) }
  const partial = `${approvalsFile()}.${process.pid}.tmp`
  await writeFile(partial, `${JSON.stringify(stable, null, 2)}\n`)
  await rename(partial, approvalsFile())
}

// Each old key whose municipality has exactly one site becomes that site's key in the file, so that a site registered
// in the municipality later cannot change whose approval it is. Not with facility tokens: the one site there may be one
// a facility registered after the key was written.
export function migrateLegacyApprovalKeys(): Promise<number> {
  return approvalsQueue(async () => {
    if (await isMultiFacilityServer()) return 0
    const stored = await readJsonIfExists<Approvals>(approvalsFile())
    if (!stored?.layouts) return 0
    const sites = await readSites()
    const siteIds = new Set(sites.map((site) => site.id))
    const layouts: Approvals['layouts'] = {}
    let migrated = 0
    for (const [key, record] of Object.entries(stored.layouts)) {
      const [owner = '', bulletin = ''] = key.split('/')
      const owners = !siteIds.has(owner) && isMunicipalityId(owner) ? sites.filter((site) => site.municipality_id === owner) : []
      if (owners.length !== 1) {
        layouts[key] = record
        continue
      }
      const target = `${owners[0]!.id}/${bulletin}`
      if (!(target in stored.layouts)) layouts[target] = record
      migrated++
    }
    if (migrated) await writeApprovals({ ...stored, layouts, sites: stored.sites ?? {} })
    return migrated
  })
}

// The only way to change approvals.json. A change that throws leaves the file as it was.
export function updateApprovals<T>(change: (approvals: Approvals) => T | Promise<T>): Promise<T> {
  return approvalsQueue(async () => {
    const { view: approvals, kept } = await readApprovalsKeeping()
    const result = await change(approvals)
    await writeApprovals({ ...approvals, layouts: { ...kept, ...approvals.layouts } })
    return result
  })
}
