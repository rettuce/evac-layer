import { join } from 'node:path'
import { approvalWith, classKey } from '~~/layout/gate'
import type { ReplayRow } from '~~/layout/replay'

interface ReportFile {
  outcome: string
  verifier: string
  writer_note?: string
  attempts: { n: number; findings: unknown[]; screens_ok: Record<string, boolean> }[]
}

function readReport(root: string, site: string, bulletin: string): Promise<ReportFile | undefined> {
  return readJsonIfExists<ReportFile>(join(root, 'reports', site, bulletin, 'report.json'))
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
        const report = entry.screen ? await readReport(root, site, entry.bulletin_id) : undefined
        const last = report?.attempts.at(-1)
        const cls = entry.screen ? await currentClassOf(site, entry.bulletin_id) : undefined
        const approval = approvalWith(approvals, site, entry.bulletin_id, entry.screen ? await currentLayoutDigest(site, entry.bulletin_id) : undefined, cls)
        return {
          ...entry,
          approved: approval.approved,
          stale: approval.stale,
          approved_by: approval.by,
          ...(approval.by === 'class' ? { approved_from: approvals.classes![classKey(site, cls!.key)]!.approved_from } : {}),
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
