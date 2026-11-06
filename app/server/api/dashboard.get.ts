import { basename, join } from 'node:path'
import type { EvacScreen } from '~~/layout/types'
import type { ReplayRow } from '~~/layout/replay'

type DashboardEntry = ReplayRow & { layouts?: string[] }

interface VerifierFinding {
  run?: number
  municipality: string
  fix?: string
}

interface VerifierFindingsFile {
  run: string
  findings: VerifierFinding[]
  stats?: { screens?: number; pass?: number }
}

export interface FindingsSummary {
  found: number
  fixed: number
  byRun: { run: number; found: number; screens?: number; pass?: number }[]
  files: string[]
}

interface MunicipalityStats {
  id: string
  name: string
  bulletins: number
  screens: number
  layouts: number
  languageVariants: number
  reports: number
  ngFound: number
  ngFixed: number
}

const FINDINGS_DIR = 'verifier-findings'

function fileRunNo(file: VerifierFindingsFile): number {
  return Number(/\d+/.exec(file.run)?.[0] ?? 0)
}

function runOf(finding: VerifierFinding, file: VerifierFindingsFile): number {
  return finding.run ?? fileRunNo(file)
}

interface FindingsFileView {
  file: string
  runNo: number
  stats?: VerifierFindingsFile['stats']
  findings: (VerifierFinding & { runNo: number })[]
}

async function readFindings(root: string): Promise<FindingsFileView[]> {
  const names = (await listDir(join(root, FINDINGS_DIR))).filter((f) => f.endsWith('.json'))
  const files = await Promise.all(
    names.map(async (name) => {
      const file = await readJsonIfExists<VerifierFindingsFile>(join(root, FINDINGS_DIR, name))
      if (!file) return { file: name, runNo: 0, findings: [] }
      return { file: name, runNo: fileRunNo(file), stats: file.stats, findings: file.findings.map((f) => ({ ...f, runNo: runOf(f, file) })) }
    }),
  )
  return files
}

function isFixed(finding: VerifierFinding): boolean {
  return typeof finding.fix === 'string' && finding.fix.trim().length > 0
}

export default defineEventHandler(async () => {
  const root = dataDir()
  const knowledge = new Set((await listDir(join(root, 'municipalities'))).map((f) => f.split('.')[0]!).filter((code) => /^\d{5}$/.test(code)))

  const findingFiles = await readFindings(root)
  const findings = findingFiles.flatMap((f) => f.findings)

  const rows: MunicipalityStats[] = []
  const sources = new Set<string>()
  const indexesByCode = new Map<string, { site: string; index: LayoutIndexFile }[]>()
  for (const site of await listDir(join(root, 'layouts'))) {
    const index = await readLayoutIndex(site)
    if (index) indexesByCode.set(index.municipality, [...(indexesByCode.get(index.municipality) ?? []), { site, index }])
  }
  const codes = [...new Set([...knowledge, ...indexesByCode.keys()])].sort()
  for (const code of codes) {
    const indexes = indexesByCode.get(code) ?? []
    const entries = indexes.flatMap(({ site, index }) => index.entries.map((entry) => ({ site, entry })))
    const knowledgeFile = await readJsonIfExists<{ name?: string }>(join(root, 'municipalities', `${code}.json`))
    let layouts = 0
    let languageVariants = 0
    let reports = 0
    for (const { site, entry } of entries) {
      for (const file of (entry as DashboardEntry).layouts ?? []) {
        const layout = await readJsonIfExists<EvacScreen>(siteLayoutsDir(site, entry.bulletin_id, basename(file)))
        if (!layout) continue
        layouts += 1
        const languages = layout.cells.find((cell) => cell.role === 'languages')
        languageVariants += languages ? Object.keys(languages.text).length : 1
        for (const source of layout.sources) sources.add(JSON.stringify(source))
      }
      if (entry.screen && (await readJsonIfExists(join(root, 'reports', `${code}-${entry.bulletin_id}`, 'report.json')))) reports += 1
    }
    const own = findings.filter((f) => f.municipality === code)
    rows.push({
      id: code,
      name: indexes[0]?.index.name ?? knowledgeFile?.name ?? code,
      bulletins: entries.length,
      screens: entries.filter(({ entry }) => entry.screen).length,
      layouts,
      languageVariants,
      reports,
      ngFound: own.length,
      ngFixed: own.filter(isFixed).length,
    })
  }

  const runs = [...new Set([...findingFiles.map((f) => f.runNo), ...findings.map((f) => f.runNo)])].sort((x, y) => x - y)
  const statsByRun = new Map(findingFiles.filter((f) => f.stats).map((f) => [f.runNo, f.stats!]))
  const summary: FindingsSummary = {
    found: findings.length,
    fixed: findings.filter(isFixed).length,
    byRun: runs.map((run) => ({
      run,
      found: findings.filter((f) => f.runNo === run).length,
      screens: statsByRun.get(run)?.screens,
      pass: statsByRun.get(run)?.pass,
    })),
    files: findingFiles.map((f) => `data/${FINDINGS_DIR}/${f.file}`),
  }

  const sum = (key: Exclude<keyof MunicipalityStats, 'id' | 'name'>) => rows.reduce((total, row) => total + row[key], 0)
  return {
    totals: {
      municipalities: new Set([...knowledge, ...rows.map((r) => r.id)]).size,
      bulletins: sum('bulletins'),
      screens: sum('screens'),
      layouts: sum('layouts'),
      languageVariants: sum('languageVariants'),
      ngFound: summary.found,
      ngFixed: summary.fixed,
      sources: sources.size,
    },
    rows,
    findings: summary,
  }
})
