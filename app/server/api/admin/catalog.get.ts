import { join } from 'node:path'
import { approvalState, layoutKey } from '~~/layout/gate'
import type { ReplayRow } from '~~/layout/replay'

interface LayoutIndexFile {
  municipality: string
  name: string
  site?: string
  writer_note?: string
  entries: (ReplayRow & { outcome?: string })[]
}

interface ReportFile {
  outcome: string
  verifier: string
  writer_note?: string
  attempts: { n: number; findings: unknown[]; screens_ok: Record<string, boolean> }[]
}

interface SiteFile {
  id: string
  municipality_id: string
  lat: number
  lng: number
  note?: string
}

export default defineEventHandler(async () => {
  const root = dataDir()
  const approvals = await readApprovals()

  const municipalities = []
  for (const code of await listDir(join(root, 'layouts'))) {
    const index = await readJsonIfExists<LayoutIndexFile>(join(root, 'layouts', code, 'index.json'))
    if (!index) continue
    const entries = await Promise.all(
      index.entries.map(async (entry) => {
        const report = entry.screen
          ? await readJsonIfExists<ReportFile>(join(root, 'reports', `${code}-${entry.bulletin_id}`, 'report.json'))
          : undefined
        const last = report?.attempts.at(-1)
        return {
          ...entry,
          ...approvalState(approvals.layouts[layoutKey(code, entry.bulletin_id)], entry.screen ? await currentLayoutDigest(code, entry.bulletin_id) : undefined),
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
    municipalities.push({ id: code, name: index.name, writer_note: index.writer_note, entries })
  }

  const sites = []
  for (const file of (await listDir(join(root, 'sites'))).filter((f) => f.endsWith('.json'))) {
    const site = await readJsonIfExists<SiteFile>(join(root, 'sites', file))
    if (site) sites.push({ ...site, auto_publish: approvals.sites[site.id]?.auto_publish ?? false })
  }

  return { municipalities, sites, approvals_file: 'data/approvals.json' }
})
