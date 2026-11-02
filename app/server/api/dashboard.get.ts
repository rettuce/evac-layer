import { join } from 'node:path'
import type { EvacScreen } from '~~/layout/types'
import type { ReplayRow } from '~~/layout/replay'

interface LayoutIndexFile {
  name: string
  entries: (ReplayRow & { layouts?: string[] })[]
}

interface ReportFile {
  outcome: string
  attempts: { findings: unknown[]; screens_ok: Record<string, boolean> }[]
}

interface MunicipalityStats {
  id: string
  name: string
  bulletins: number
  screens: number
  layouts: number
  languageVariants: number
  reports: number
  ngAttempts: number
  fixedAfterNg: number
}

function attemptFailed(attempt: ReportFile['attempts'][number]): boolean {
  return attempt.findings.length > 0 || Object.values(attempt.screens_ok).some((ok) => !ok)
}

export default defineEventHandler(async () => {
  assertDev()
  const root = dataDir()
  const knowledge = new Set((await listDir(join(root, 'municipalities'))).map((f) => f.split('.')[0]!).filter((code) => /^\d{5}$/.test(code)))

  const rows: MunicipalityStats[] = []
  const sources = new Set<string>()
  for (const code of await listDir(join(root, 'layouts'))) {
    const index = await readJsonIfExists<LayoutIndexFile>(join(root, 'layouts', code, 'index.json'))
    if (!index) continue
    let layouts = 0
    let languageVariants = 0
    let ngAttempts = 0
    let fixedAfterNg = 0
    let reports = 0
    for (const entry of index.entries) {
      for (const file of entry.layouts ?? []) {
        const layout = await readJsonIfExists<EvacScreen>(join(root, '..', file))
        if (!layout) continue
        layouts += 1
        const languages = layout.cells.find((cell) => cell.role === 'languages')
        languageVariants += languages ? Object.keys(languages.text).length : 1
        for (const source of layout.sources) sources.add(JSON.stringify(source))
      }
      const report = entry.screen
        ? await readJsonIfExists<ReportFile>(join(root, 'reports', `${code}-${entry.bulletin_id}`, 'report.json'))
        : undefined
      if (!report) continue
      reports += 1
      const failed = report.attempts.filter(attemptFailed).length
      ngAttempts += failed
      if (failed > 0 && report.outcome === 'pass') fixedAfterNg += 1
    }
    rows.push({
      id: code,
      name: index.name,
      bulletins: index.entries.length,
      screens: index.entries.filter((e) => e.screen).length,
      layouts,
      languageVariants,
      reports,
      ngAttempts,
      fixedAfterNg,
    })
  }

  const sum = (key: Exclude<keyof MunicipalityStats, 'id' | 'name'>) => rows.reduce((total, row) => total + row[key], 0)
  return {
    totals: {
      municipalities: new Set([...knowledge, ...rows.map((r) => r.id)]).size,
      bulletins: sum('bulletins'),
      screens: sum('screens'),
      layouts: sum('layouts'),
      languageVariants: sum('languageVariants'),
      ngAttempts: sum('ngAttempts'),
      fixedAfterNg: sum('fixedAfterNg'),
      sources: sources.size,
    },
    rows,
  }
})
