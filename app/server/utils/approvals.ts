import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type Approvals, classDigest, layoutDigest, screenClass } from '~~/layout/gate'
import { isMunicipalityId } from '~~/layout/replay'
import { isShape } from '~~/layout/shapes'

const EMPTY: Approvals = { version: '0.1', layouts: {}, sites: {}, classes: {} }
const warnedLegacyKeys = new Set<string>()

export function approvalsFile(): string {
  return join(dataDir(), 'approvals.json')
}

async function withSiteKeys(approvals: Approvals): Promise<Approvals> {
  const sites = await readSites()
  const siteIds = new Set(sites.map((site) => site.id))
  const layouts: Approvals['layouts'] = {}
  const legacy: [string, string, string][] = []
  for (const [key, record] of Object.entries(approvals.layouts)) {
    const [owner = '', bulletin = ''] = key.split('/')
    if (!siteIds.has(owner) && isMunicipalityId(owner)) legacy.push([key, owner, bulletin])
    else layouts[key] = record
  }
  for (const [key, municipality, bulletin] of legacy) {
    const owners = sites.filter((site) => site.municipality_id === municipality)
    if (owners.length === 1) {
      layouts[`${owners[0]!.id}/${bulletin}`] ??= approvals.layouts[key]!
    } else if (!warnedLegacyKeys.has(key)) {
      warnedLegacyKeys.add(key)
      console.warn(`[approvals] ${key} is ignored: municipality ${municipality} has ${owners.length} sites; approve it again per site`)
    }
  }
  return { ...approvals, layouts }
}

export async function readApprovals(): Promise<Approvals> {
  const stored = await readJsonIfExists<Approvals>(approvalsFile())
  return stored ? withSiteKeys({ ...stored, classes: stored.classes ?? {} }) : structuredClone(EMPTY)
}

async function layoutFiles(site: string, bulletin: string): Promise<{ shape: string; body: string }[]> {
  const dir = siteLayoutsDir(site, bulletin)
  const shapes = (await listDir(dir)).filter((f) => f.endsWith('.json') && isShape(f.slice(0, -5)))
  return Promise.all(shapes.map(async (f) => ({ shape: f.slice(0, -5), body: await readFile(join(dir, f), 'utf8') })))
}

export async function currentLayoutDigest(site: string, bulletin: string): Promise<string | undefined> {
  const files = await layoutFiles(site, bulletin)
  return files.length ? layoutDigest(files) : undefined
}

export async function currentClassOf(site: string, bulletin: string): Promise<{ key: string; digest: string } | undefined> {
  const files = await layoutFiles(site, bulletin)
  return files.length ? { key: screenClass(JSON.parse(files[0]!.body)), digest: classDigest(files) } : undefined
}

function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
}

export async function writeApprovals(approvals: Approvals): Promise<void> {
  const stable: Approvals = { version: '0.1', layouts: sortedRecord(approvals.layouts), sites: sortedRecord(approvals.sites), classes: sortedRecord(approvals.classes ?? {}) }
  await writeFile(approvalsFile(), `${JSON.stringify(stable, null, 2)}\n`)
}
