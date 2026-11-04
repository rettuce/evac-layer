import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type Approvals, layoutDigest } from '~~/layout/gate'
import { isShape } from '~~/layout/shapes'

const EMPTY: Approvals = { version: '0.1', layouts: {}, sites: {} }

export function approvalsFile(): string {
  return join(dataDir(), 'approvals.json')
}

export async function readApprovals(): Promise<Approvals> {
  return (await readJsonIfExists<Approvals>(approvalsFile())) ?? structuredClone(EMPTY)
}

export async function currentLayoutDigest(municipality: string, bulletin: string): Promise<string | undefined> {
  const dir = join(dataDir(), 'layouts', municipality, bulletin)
  const shapes = (await listDir(dir)).filter((f) => f.endsWith('.json') && isShape(f.slice(0, -5)))
  if (!shapes.length) return undefined
  const files = await Promise.all(shapes.map(async (f) => ({ shape: f.slice(0, -5), body: await readFile(join(dir, f), 'utf8') })))
  return layoutDigest(files)
}

function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
}

export async function writeApprovals(approvals: Approvals): Promise<void> {
  const stable: Approvals = { version: '0.1', layouts: sortedRecord(approvals.layouts), sites: sortedRecord(approvals.sites) }
  await writeFile(approvalsFile(), `${JSON.stringify(stable, null, 2)}\n`)
}
