import { access, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { type Approvals, approvalWith, classKey, layoutKey } from '~~/layout/gate'
import type { ReplayRow } from '~~/layout/replay'
import type { LayoutSnapshot } from './approvals'
import type { ExportRecords } from './exportJob'

export interface ClassState {
  class: string
  bulletin_id: string
  digest: string
  outcome: 'pending' | 'pass' | 'fail'
  approved: boolean
  approved_at?: string
  live: boolean
  previews: Record<string, string>
}

export interface SiteState {
  site: SiteFile
  facility_id: string | null
  auto_publish: boolean
  municipality_prepared: boolean
  needs_generation: boolean
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

async function classStates(site: string, rows: ReplayRow[], approvals: Approvals): Promise<ClassState[]> {
  const liveBulletin = (await currentFeed(site))?.bulletin_id
  const liveClass = liveBulletin ? await currentClassKey(site, liveBulletin) : undefined
  return [...(await representatives(site, rows))]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cls, { row, snapshot }]) => ({
      class: cls,
      bulletin_id: row.bulletin_id,
      digest: snapshot.digest,
      outcome: outcomeOf(snapshot),
      ...approvedAt(approvals, site, row.bulletin_id, snapshot),
      live: cls === liveClass,
      previews: {},
    }))
}

async function exportsOf(site: string): Promise<SiteState['exports']> {
  const jobs = Object.entries((await readJsonIfExists<Partial<ExportRecords>>(exportRecordFile(site)))?.jobs ?? {})
  return {
    pending: jobs.filter(([, job]) => job.status === 'running').map(([bulletin]) => bulletin),
    failed: jobs.filter(([, job]) => job.status === 'failed').map(([bulletin, job]) => ({ bulletin_id: bulletin, reason: job.message ?? '', at: job.updated_at })),
  }
}

// The index is rewritten whenever screens are composed, so a place changed after it was last written is newer
// than every screen.
async function movedSinceScreens(site: SiteFile): Promise<boolean> {
  if (!site.location_updated_at) return false
  const index = await stat(siteLayoutsDir(site.id, 'index.json')).catch(() => undefined)
  return !index || Date.parse(site.location_updated_at) > index.mtimeMs
}

export async function siteState(site: SiteFile, approvals: Approvals, warnings: string[] = []): Promise<SiteState> {
  const index = await readLayoutIndex(site.id)
  const [classes, exports, prepared] = await Promise.all([
    classStates(site.id, index?.entries ?? [], approvals),
    exportsOf(site.id),
    exists(join(dataDir(), 'municipalities', `${site.municipality_id}.json`)),
  ])
  return {
    site,
    facility_id: site.facility_id ?? null,
    auto_publish: approvals.sites[site.id]?.auto_publish ?? false,
    municipality_prepared: prepared,
    needs_generation: !classes.length || (await movedSinceScreens(site)),
    classes,
    approved_classes: { approved: classes.filter((c) => c.approved).length, total: classes.length },
    exports,
    warnings,
  }
}
