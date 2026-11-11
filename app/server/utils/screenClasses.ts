import { stat } from 'node:fs/promises'
import type { ReplayRow } from '~~/layout/replay'
import type { LayoutSnapshot } from './approvals'
import type { JobResult, SiteGenerations } from './generationRecord'

export interface Representative {
  cls: string
  row: ReplayRow
  snapshot: LayoutSnapshot
  stale: boolean
}

export function snapshotOutcome(snapshot: LayoutSnapshot): 'pending' | 'pass' | 'fail' {
  if (!snapshot.report) return 'pending'
  return snapshot.report.outcome === 'pass' ? 'pass' : 'fail'
}

function jobThatMade(generations: SiteGenerations, bulletin: string): JobResult | undefined {
  return [generations.last_result, generations.last_success].find((result) => result?.rows.some((row) => row.bulletin_id === bulletin))
}

// Screens a job made were made for the place the job started with. Any other screen (a real bulletin, a class the
// job cannot compose) may be older than the last move, which only its files' times can tell.
async function isStale(site: SiteFile, generations: SiteGenerations, bulletin: string): Promise<boolean> {
  const job = jobThatMade(generations, bulletin)
  if (job) return !samePlace(job.place, placeOf(site))
  if (!site.location_updated_at) return false
  const moved = Date.parse(site.location_updated_at)
  const files = (await listDir(siteLayoutsDir(site.id, bulletin))).filter((f) => f.endsWith('.json'))
  const times = await Promise.all(files.map((f) => stat(siteLayoutsDir(site.id, bulletin, f)).then((s) => s.mtimeMs, () => 0)))
  return times.some((time) => time < moved)
}

// The newest bulletin stands for its class, unless the last job composed the class: then its bulletin does, whatever
// its issue time, because a later real bulletin's screens may be of an earlier place.
export async function representatives(site: SiteFile, generations: SiteGenerations): Promise<Representative[]> {
  const entries = new Map<string, { row: ReplayRow; snapshot: LayoutSnapshot }>()
  for (const row of (await readLayoutIndex(site.id))?.entries ?? []) {
    if (!row.screen) continue
    const snapshot = await readLayoutSnapshot(site.id, row.bulletin_id)
    if (snapshot) entries.set(row.bulletin_id, { row, snapshot })
  }
  const byClass = new Map<string, { row: ReplayRow; snapshot: LayoutSnapshot }>()
  for (const entry of entries.values()) {
    const current = byClass.get(entry.snapshot.cls.key)
    if (!current || Date.parse(entry.row.issued_at) >= Date.parse(current.row.issued_at)) byClass.set(entry.snapshot.cls.key, entry)
  }
  for (const result of [generations.last_success, generations.last_result]) {
    for (const made of result?.rows ?? []) {
      const entry = made.outcome === 'pass' && made.bulletin_id ? entries.get(made.bulletin_id) : undefined
      if (entry) byClass.set(entry.snapshot.cls.key, entry)
    }
  }
  return Promise.all(
    [...byClass]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(async ([cls, { row, snapshot }]) => ({ cls, row, snapshot, stale: await isStale(site, generations, row.bulletin_id) })),
  )
}
