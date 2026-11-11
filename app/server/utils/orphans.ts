import { execFile } from 'node:child_process'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { AgentPurpose } from './childProcess'

export interface ChildMark {
  pgid: number
  started_at: number
  match: string[]
  kind?: AgentPurpose
}

export interface PsProcess {
  pid: number
  ppid: number
  pgid: number
  startedAt: number
  args: string[]
}

export interface OrphanEntry extends ChildMark {
  site_id: string
  facility_id?: string
  generation_id?: string
}

export type MarkState = 'gone' | 'ours' | 'not-ours' | 'unknown'

// ps prints the start time to the second, and the server notes it right after spawning.
const START_SLACK_MS = 3000
const STOP_GRACE_MS = 5000
const STOP_FINAL_MS = 2000
const POLL_MS = 100
const PS_LINE = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d{1,2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/
let orphanQueue: ReturnType<typeof serialQueue> | undefined

// ps prints start times in the time zone it is given, which must be the one this process reads them in.
export function psEnv(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, LC_ALL: 'C', ...(process.env.TZ ? { TZ: process.env.TZ } : {}) }
}

export function parsePsLine(line: string): PsProcess | undefined {
  const parsed = PS_LINE.exec(line)
  if (!parsed) return undefined
  const startedAt = new Date(parsed[4]!).getTime()
  if (Number.isNaN(startedAt)) return undefined
  return { pid: Number(parsed[1]), ppid: Number(parsed[2]), pgid: Number(parsed[3]), startedAt, args: parsed[5]!.trim().split(/\s+/) }
}

export function argumentsMatch(match: readonly string[], args: readonly string[]): boolean {
  return match.every((arg) => args.includes(arg))
}

export async function processTable(): Promise<PsProcess[] | undefined> {
  try {
    const { stdout } = await promisify(execFile)('ps', ['-A', '-ww', '-o', 'pid=,ppid=,pgid=,lstart=,command='], { env: psEnv(), maxBuffer: 16 * 1024 * 1024 })
    return stdout.split('\n').flatMap((line) => parsePsLine(line) ?? [])
  } catch {
    return undefined
  }
}

export function descendsFrom(table: readonly PsProcess[], pid: number, ancestor: number): boolean {
  const byPid = new Map(table.map((p) => [p.pid, p]))
  const seen = new Set<number>()
  for (let current = byPid.get(pid)?.ppid; current && current > 1 && !seen.has(current); current = byPid.get(current)?.ppid) {
    if (current === ancestor) return true
    seen.add(current)
  }
  return false
}

// A pid alone may have been reused by anything since it was recorded: the group is taken for the recorded child only
// when its leader (or, once the leader is gone, its members) started when the record says and runs the job's command.
export function markState(mark: ChildMark, table: readonly PsProcess[] | undefined): MarkState {
  if (!table) return groupAlive(mark.pgid) ? 'unknown' : 'gone'
  const members = table.filter((p) => p.pgid === mark.pgid)
  if (!members.length) return groupAlive(mark.pgid) ? 'unknown' : 'gone'
  const leader = members.find((p) => p.pid === mark.pgid)
  const ours = leader
    ? Math.abs(leader.startedAt - mark.started_at) <= START_SLACK_MS && argumentsMatch(mark.match, leader.args)
    : members.every((p) => p.startedAt >= mark.started_at - START_SLACK_MS) && members.some((p) => argumentsMatch(mark.match, p.args))
  return ours ? 'ours' : 'not-ours'
}

async function waitWhileAlive(pgid: number, ms: number): Promise<void> {
  const deadline = Date.now() + ms
  while (groupAlive(pgid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, POLL_MS))
}

// Every signal goes out only after the group is matched again, so a group that changed hands meanwhile is left alone.
export async function stopOrphan(mark: ChildMark): Promise<MarkState | 'stopped' | 'alive'> {
  const state = markState(mark, await processTable())
  if (state !== 'ours') return state
  signalGroup(mark.pgid, 'SIGTERM')
  await waitWhileAlive(mark.pgid, STOP_GRACE_MS)
  if (groupAlive(mark.pgid) && markState(mark, await processTable()) === 'ours') {
    signalGroup(mark.pgid, 'SIGKILL')
    await waitWhileAlive(mark.pgid, STOP_FINAL_MS)
  }
  return groupAlive(mark.pgid) ? 'alive' : 'stopped'
}

// Kept apart from every site's own records, so that deleting a site does not forget a child of it that still runs.
function orphanFile(): string {
  return join(dataDir(), 'orphans.json')
}

async function writeOrphans(entries: OrphanEntry[]): Promise<void> {
  await mkdir(dataDir(), { recursive: true })
  await writeFile(`${orphanFile()}.tmp`, `${JSON.stringify({ orphans: entries }, null, 2)}\n`)
  await rename(`${orphanFile()}.tmp`, orphanFile())
}

async function readOrphans(): Promise<OrphanEntry[]> {
  const stored = await readJsonIfExists<{ orphans?: OrphanEntry[] }>(orphanFile()).catch(() => undefined)
  return Array.isArray(stored?.orphans) ? stored.orphans : []
}

export function addOrphan(entry: OrphanEntry): Promise<void> {
  console.warn(`[agents] process group ${entry.pgid} (${entry.kind ?? 'agent'} of site ${entry.site_id}) is still running and could not be stopped as this server's child; the site takes no job and its id no new registration until it ends`)
  return (orphanQueue ??= serialQueue())(async () => {
    const entries = await readOrphans()
    if (!entries.some((e) => e.pgid === entry.pgid && e.started_at === entry.started_at)) await writeOrphans([...entries, entry])
  })
}

// An entry stays while its group runs and still matches it; one whose group ended or now runs something else goes.
export function liveOrphans(site?: string): Promise<OrphanEntry[]> {
  return (orphanQueue ??= serialQueue())(async () => {
    const entries = await readOrphans()
    if (!entries.length) return []
    const relevant = entries.filter((e) => site === undefined || e.site_id === site)
    if (!relevant.length) return []
    const table = await processTable()
    const kept = entries.filter((e) => !relevant.includes(e) || ['ours', 'unknown'].includes(markState(e, table)))
    if (kept.length !== entries.length) await writeOrphans(kept)
    return kept.filter((e) => site === undefined || e.site_id === site)
  })
}
