import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface Approvals {
  version: '0.1'
  layouts: Record<string, { approved: boolean; updated_at: string }>
  sites: Record<string, { auto_publish: boolean; updated_at: string }>
}

const EMPTY: Approvals = { version: '0.1', layouts: {}, sites: {} }

export function approvalsFile(): string {
  return join(dataDir(), 'approvals.json')
}

export async function readApprovals(): Promise<Approvals> {
  return (await readJsonIfExists<Approvals>(approvalsFile())) ?? structuredClone(EMPTY)
}

function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
}

export async function writeApprovals(approvals: Approvals): Promise<void> {
  const stable: Approvals = { version: '0.1', layouts: sortedRecord(approvals.layouts), sites: sortedRecord(approvals.sites) }
  await writeFile(approvalsFile(), `${JSON.stringify(stable, null, 2)}\n`)
}
