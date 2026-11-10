import { spawn } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { H3Event } from 'h3'
import { EXPORT_DIGEST_FILE } from '~~/layout/feed'
import type { ReplayRow } from '~~/layout/replay'

const EXPORT_TIMEOUT_MS = 2 * 60 * 1000
const MESSAGE_TAIL_CHARS = 2000

export interface ExportJobRecord {
  status: 'running' | 'ok' | 'failed'
  updated_at: string
  message?: string
}

export interface ExportRecords {
  site_id: string
  jobs: Record<string, ExportJobRecord>
}

const queued = new Set<string>()
let lastJob: Promise<void> = Promise.resolve()

export function exportRecordFile(site: string): string {
  return join(dataDir(), 'live', `${site}.export.json`)
}

async function recordJob(site: string, bulletin: string, job: Omit<ExportJobRecord, 'updated_at'>): Promise<void> {
  const file = exportRecordFile(site)
  const jobs = (await readJsonIfExists<Partial<ExportRecords>>(file))?.jobs ?? {}
  const records: ExportRecords = { site_id: site, jobs: { ...jobs, [bulletin]: { ...job, updated_at: new Date().toISOString() } } }
  await mkdir(join(dataDir(), 'live'), { recursive: true })
  await writeFile(`${file}.tmp`, `${JSON.stringify(records, null, 2)}\n`)
  await rename(`${file}.tmp`, file)
}

export async function exportedDigest(site: string, bulletin: string): Promise<string | undefined> {
  try {
    return (await readFile(join(distDir(), site, bulletin, EXPORT_DIGEST_FILE), 'utf8')).trim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function exportCommand(): string[] {
  const command = String(useRuntimeConfig().exportCommand).split(/\s+/).filter(Boolean)
  return command[0] === 'off' ? [] : command
}

// The exporter opens /screen on this server. In dev the request arrives through nuxi's relay, whose worker port
// is not the public one, so there the exporter falls back to EVAC_URL.
export function ownBaseUrl(event: H3Event): string | undefined {
  const { localAddress, localPort } = event.node.req.socket
  if (import.meta.dev || !localAddress || !localPort) return undefined
  return `http://${localAddress.includes(':') ? `[${localAddress}]` : localAddress}:${localPort}`
}

function run(command: string[], args: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((done) => {
    // Its own process group, so a timeout also ends the Chrome that pnpm and tsx started.
    const child = spawn(command[0]!, [...command.slice(1), ...args], {
      cwd: useRuntimeConfig().repoRoot,
      env: { ...process.env, EVAC_DATA_DIR: resolve(dataDir()) },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    let output = ''
    let timedOut = false
    const collect = (chunk: string) => (output = (output + chunk).slice(-MESSAGE_TAIL_CHARS))
    child.stdout.setEncoding('utf8').on('data', collect)
    child.stderr.setEncoding('utf8').on('data', collect)
    const timer = setTimeout(() => {
      timedOut = true
      if (child.pid) process.kill(-child.pid, 'SIGKILL')
    }, EXPORT_TIMEOUT_MS)
    const finish = (ok: boolean, message: string) => {
      clearTimeout(timer)
      done({ ok, output: message.trim() })
    }
    child.on('error', (error) => finish(false, error.message))
    child.on('close', (code) => finish(code === 0, timedOut ? `${output}\ntimed out after ${EXPORT_TIMEOUT_MS / 1000} s` : output))
  })
}

async function exportNow(command: string[], site: string, bulletin: string, baseUrl: string | undefined): Promise<void> {
  await recordJob(site, bulletin, { status: 'running' })
  const args = [`--site=${site}`, `--bulletin=${bulletin}`, `--out=${resolve(distDir())}`, ...(baseUrl ? [`--base-url=${baseUrl}`] : [])]
  const { ok, output } = await run(command, args)
  if (!ok) console.warn(`[export] ${site} ${bulletin} failed: ${output}`)
  await recordJob(site, bulletin, ok ? { status: 'ok' } : { status: 'failed', message: output })
}

// Chrome renders one bulletin at a time.
function enqueue(command: string[], site: string, bulletin: string, baseUrl: string | undefined): void {
  const key = `${site}/${bulletin}`
  if (queued.has(key)) return
  queued.add(key)
  lastJob = lastJob.then(async () => {
    queued.delete(key)
    await exportNow(command, site, bulletin, baseUrl).catch((error: Error) => console.warn(`[export] ${key} stopped: ${error.message}`))
  })
}

// Every bulletin of the site that may go out now and has no export of its current screens: the one just approved,
// the others its class approval covers, or all of them when auto publish was switched on.
export async function requestMissingExports(site: string, baseUrl: string | undefined): Promise<void> {
  const command = exportCommand()
  if (!command.length) return
  const index = await readLayoutIndex(site)
  const approvals = await readApprovals()
  for (const row of (index?.entries ?? []) as ReplayRow[]) {
    if (!row.screen) continue
    const digest = await deliverableDigest(approvals, site, row.bulletin_id)
    if (digest && (await exportedDigest(site, row.bulletin_id)) !== digest) enqueue(command, site, row.bulletin_id, baseUrl)
  }
}
