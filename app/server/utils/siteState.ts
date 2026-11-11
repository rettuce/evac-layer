import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { type Approvals, approvalWith, classKey, isSyntheticBulletinId, layoutKey } from '~~/layout/gate'
import type { LayoutSnapshot } from './approvals'
import type { ExportRecords } from './exportJob'
import type { Generation, SiteGenerations } from './generationRecord'
import type { Representative } from './screenClasses'

export interface ClassState {
  class: string
  bulletin_id: string
  synthetic: boolean
  digest: string
  outcome: 'pending' | 'pass' | 'fail'
  stale: boolean
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

const COMPOSED_WITHOUT_SCREEN = new Set(['unsupported', 'no-screen'])

async function exists(file: string): Promise<boolean> {
  return access(file).then(() => true, () => false)
}

function approvedAt(approvals: Approvals, site: string, bulletin: string, snapshot: LayoutSnapshot): { approved: boolean; approved_at?: string } {
  const { approved, by } = approvalWith(approvals, site, bulletin, snapshot.digest, snapshot.cls)
  if (!approved) return { approved }
  const record = by === 'bulletin' ? approvals.layouts[layoutKey(site, bulletin)] : approvals.classes?.[classKey(site, snapshot.cls.key)]
  return { approved, ...(record ? { approved_at: record.updated_at } : {}) }
}

async function classStates(site: string, reps: Representative[], approvals: Approvals, generations: SiteGenerations): Promise<ClassState[]> {
  const liveBulletin = (await currentFeed(site))?.bulletin_id
  const liveClass = liveBulletin ? await currentClassKey(site, liveBulletin) : undefined
  const atLastJob = generations.latest?.digests ?? generations.previous?.digests
  return Promise.all(
    reps.map(async ({ cls, row, snapshot, stale }) => ({
      class: cls,
      bulletin_id: row.bulletin_id,
      synthetic: isSyntheticBulletinId(row.bulletin_id),
      digest: snapshot.digest,
      outcome: snapshotOutcome(snapshot),
      stale,
      ...(atLastJob ? { unchanged: atLastJob[cls]?.bulletin_id === row.bulletin_id && atLastJob[cls]?.digest === snapshot.digest } : {}),
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

// A job can only remake the classes it composes, so a stale screen of a class it cannot compose is shown on that
// class and does not ask for a job. Before any job has a result, every stale screen asks for one.
function needsGeneration(classes: ClassState[], generations: SiteGenerations): boolean {
  if (!classes.length || lastFinished(generations)?.status === 'failed') return true
  const result = generations.last_result
  if (!result) return classes.some((c) => c.stale)
  return result.rows.some((row) => {
    if (COMPOSED_WITHOUT_SCREEN.has(row.outcome)) return false
    if (row.outcome !== 'pass') return true
    const state = classes.find((c) => c.class === row.class)
    return !state || state.stale
  })
}

export async function siteState(site: SiteFile, approvals: Approvals, warnings: string[] = []): Promise<SiteState> {
  const generations = await readSiteGenerations(site.id)
  const reps = await representatives(site, generations)
  const [classes, exports, prepared] = await Promise.all([
    classStates(site.id, reps, approvals, generations),
    exportsOf(site.id),
    exists(join(dataDir(), 'municipalities', `${site.municipality_id}.json`)),
  ])
  return {
    site,
    facility_id: site.facility_id ?? null,
    auto_publish: approvals.sites[site.id]?.auto_publish ?? false,
    municipality_prepared: prepared,
    needs_generation: needsGeneration(classes, generations),
    ...(generations.latest ? { last_generation: publicGeneration(generations.latest) } : {}),
    classes,
    approved_classes: { approved: classes.filter((c) => c.approved).length, total: classes.length },
    exports,
    warnings,
  }
}
