import { access, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { type Approvals, approvalWith, classKey, isSyntheticBulletinId, layoutKey } from '~~/layout/gate'
import type { ReplayRow } from '~~/layout/replay'
import type { LayoutSnapshot } from './approvals'
import type { ExportRecords } from './exportJob'
import type { Generation } from './generationRecord'

export interface ClassState {
  class: string
  bulletin_id: string
  synthetic: boolean
  digest: string
  outcome: 'pending' | 'pass' | 'fail'
  approved: boolean
  approved_at?: string
  unchanged?: boolean
  live: boolean
  previews: Record<string, string>
}

export interface SiteState {
  site: SiteFile
  facility_id: string | null
  auto_publish: boolean
  municipality_prepared: boolean
  needs_generation: boolean
  last_generation?: Generation
  classes: ClassState[]
  approved_classes: { approved: number; total: number }
  exports: { pending: string[]; failed: { bulletin_id: string; reason: string; at: string }[] }
  warnings: string[]
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(() => true, () => false)
}

async function representatives(site: string, rows: ReplayRow[]): Promise<Map<string, { row: ReplayRow; snapshot: LayoutSnapshot }>> {
  const byClass = new Map<string, { row: ReplayRow; snapshot: LayoutSnapshot }>()
  for (const row of rows) {
    if (!row.screen) continue
    const snapshot = await readLayoutSnapshot(site, row.bulletin_id)
    if (!snapshot) continue
    const current = byClass.get(snapshot.cls.key)
    if (!current || Date.parse(row.issued_at) >= Date.parse(current.row.issued_at)) byClass.set(snapshot.cls.key, { row, snapshot })
  }
  return byClass
}

function approvedAt(approvals: Approvals, site: string, bulletin: string, snapshot: LayoutSnapshot): { approved: boolean; approved_at?: string } {
  const { approved, by } = approvalWith(approvals, site, bulletin, snapshot.digest, snapshot.cls)
  if (!approved) return { approved }
  const record = by === 'bulletin' ? approvals.layouts[layoutKey(site, bulletin)] : approvals.classes?.[classKey(site, snapshot.cls.key)]
  return { approved, ...(record ? { approved_at: record.updated_at } : {}) }
}

function outcomeOf(snapshot: LayoutSnapshot): ClassState['outcome'] {
  if (!snapshot.report) return 'pending'
  return snapshot.report.outcome === 'pass' ? 'pass' : 'fail'
}

async function sortedRepresentatives(site: string) {
  const index = await readLayoutIndex(site)
  return [...(await representatives(site, index?.entries ?? []))].sort(([a], [b]) => a.localeCompare(b))
}

export async function classDigests(site: string): Promise<Record<string, string>> {
  return Object.fromEntries((await sortedRepresentatives(site)).map(([cls, { snapshot }]) => [cls, snapshot.digest]))
}

export async function passingBulletins(site: string): Promise<string[]> {
  return (await sortedRepresentatives(site)).filter(([, { snapshot }]) => outcomeOf(snapshot) === 'pass').map(([, { row }]) => row.bulletin_id)
}

async function classStates(site: string, approvals: Approvals, digestsAtLastJob: Record<string, string> | undefined): Promise<ClassState[]> {
  const liveBulletin = (await currentFeed(site))?.bulletin_id
  const liveClass = liveBulletin ? await currentClassKey(site, liveBulletin) : undefined
  return Promise.all(
    (await sortedRepresentatives(site)).map(async ([cls, { row, snapshot }]) => ({
      class: cls,
      bulletin_id: row.bulletin_id,
      synthetic: isSyntheticBulletinId(row.bulletin_id),
      digest: snapshot.digest,
      outcome: outcomeOf(snapshot),
      ...(digestsAtLastJob ? { unchanged: digestsAtLastJob[cls] === snapshot.digest } : {}),
      ...approvedAt(approvals, site, row.bulletin_id, snapshot),
      live: cls === liveClass,
      previews: await currentPreviews(site, row.bulletin_id, snapshot.digest),
    })),
  )
}

async function exportsOf(site: string): Promise<SiteState['exports']> {
  const jobs = Object.entries((await readJsonIfExists<Partial<ExportRecords>>(exportRecordFile(site)))?.jobs ?? {})
  return {
    pending: jobs.filter(([, job]) => job.status === 'running').map(([bulletin]) => bulletin),
    failed: jobs.filter(([, job]) => job.status === 'failed').map(([bulletin, job]) => ({ bulletin_id: bulletin, reason: job.message ?? '', at: job.updated_at })),
  }
}

// A successful job composed every class from the place as it was when the job started. Without one, the index,
// rewritten whenever screens are composed, tells whether the place changed after the newest screen.
async function movedSinceScreens(site: SiteFile, lastSuccessStartedAt: string | undefined): Promise<boolean> {
  if (!site.location_updated_at) return false
  if (lastSuccessStartedAt) return Date.parse(site.location_updated_at) > Date.parse(lastSuccessStartedAt)
  const index = await stat(siteLayoutsDir(site.id, 'index.json')).catch(() => undefined)
  return !index || Date.parse(site.location_updated_at) > index.mtimeMs
}

export async function siteState(site: SiteFile, approvals: Approvals, warnings: string[] = []): Promise<SiteState> {
  const generations = await readSiteGenerations(site.id)
  const [classes, exports, prepared] = await Promise.all([
    classStates(site.id, approvals, generations.latest?.digests ?? generations.previous?.digests),
    exportsOf(site.id),
    exists(join(dataDir(), 'municipalities', `${site.municipality_id}.json`)),
  ])
  return {
    site,
    facility_id: site.facility_id ?? null,
    auto_publish: approvals.sites[site.id]?.auto_publish ?? false,
    municipality_prepared: prepared,
    needs_generation: !classes.length || (await movedSinceScreens(site, generations.last_success_started_at)),
    ...(generations.latest ? { last_generation: publicGeneration(generations.latest) } : {}),
    classes,
    approved_classes: { approved: classes.filter((c) => c.approved).length, total: classes.length },
    exports,
    warnings,
  }
}
