import { join } from 'node:path'
import { type CheckReport, approvalWith, classKey } from '~~/layout/gate'
import type { ReplayRow } from '~~/layout/replay'

interface ReportFile extends CheckReport {
  outcome: string
  verifier: string
  attempts: { n: number; findings: unknown[]; screens_ok: Record<string, boolean> }[]
}

export default defineEventHandler(async () => {
  const root = dataDir()
  const approvals = await readApprovals()

  const layouts = []
  for (const site of await listDir(join(root, 'layouts'))) {
    const index = await readLayoutIndex(site)
    if (!index) continue
    const entries = await Promise.all(
      index.entries.map(async (entry: ReplayRow) => {
        const snapshot = entry.screen ? await readLayoutSnapshot(site, entry.bulletin_id) : undefined
        const report = snapshot?.report as ReportFile | undefined
        const last = report?.attempts.at(-1)
        const approval = approvalWith(approvals, site, entry.bulletin_id, snapshot?.digest, snapshot?.cls)
        return {
          ...entry,
          approved: approval.approved,
          stale: approval.stale,
          approved_by: approval.by,
          ...(snapshot ? { digest: snapshot.digest } : {}),
          ...(approval.by === 'class' ? { approved_from: approvals.classes![classKey(site, snapshot!.cls.key)]!.approved_from } : {}),
          report: report && {
            outcome: report.outcome,
            verifier: report.verifier,
            attempts: report.attempts.length,
            findings: last?.findings ?? [],
            screens_ok: last?.screens_ok ?? {},
          },
        }
      }),
    )
    layouts.push({ site_id: site, municipality_id: index.municipality, name: index.name, writer_note: index.writer_note, entries })
  }

  const sites = (await readSites()).map((site) => ({ ...site, auto_publish: approvals.sites[site.id]?.auto_publish ?? false }))

  return { layouts, sites, approvals_file: 'data/approvals.json' }
})
