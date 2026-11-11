import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { EXPORT_DIGEST_FILE } from '~~/layout/feed'
import type { ReplayRow } from '~~/layout/replay'

const EXPORT_TIMEOUT_MS = 2 * 60 * 1000
const MESSAGE_TAIL_CHARS = 2000

export interface ExportJobRecord {
  status: 'running' | 'ok' | 'failed'
  digest: string
  updated_at: string
  message?: string
}

export interface ExportRecords {
  site_id: string
  jobs: Record<string, ExportJobRecord>
}

const pending = new Set<string>()
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
  return configuredCommand(useRuntimeConfig().exportCommand)
}

// The exporter opens /screen on this server. A dev server listens through nuxi's relay and a socket deployment has
// no port, so there the exporter falls back to EVAC_URL.
export function ownBaseUrl(): string | undefined {
  const port = process.env.NITRO_PORT ?? process.env.PORT
  if (import.meta.dev || !port || process.env.NITRO_UNIX_SOCKET) return undefined
  const host = process.env.NITRO_HOST ?? process.env.HOST ?? ''
  const reachable = !host || host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
  return `http://${reachable.includes(':') ? `[${reachable}]` : reachable}:${port}`
}

// A site deleted since the export was queued, perhaps registered again by another facility under the same id, is
// not the one these screens were made for.
async function exportNow(command: string[], site: string, bulletin: string, digest: string, generation: number): Promise<void> {
  const started = await withSiteLock(site, async () => {
    if (siteGeneration(site) !== generation) return false
    await recordJob(site, bulletin, { status: 'running', digest })
    return true
  })
  if (!started) return
  const baseUrl = ownBaseUrl()
  const args = [`--site=${site}`, `--bulletin=${bulletin}`, `--out=${resolve(distDir())}`, ...(baseUrl ? [`--base-url=${baseUrl}`] : [])]
  const { ok, output } = await runAgentCommand(command, args, { purpose: 'export', timeoutMs: EXPORT_TIMEOUT_MS, tailChars: MESSAGE_TAIL_CHARS }).done
  if (!ok) console.warn(`[export] ${site} ${bulletin} failed: ${output}`)
  await withSiteLock(site, async () => {
    if (siteGeneration(site) === generation) return recordJob(site, bulletin, ok ? { status: 'ok', digest } : { status: 'failed', digest, message: output })
    // Exports run one at a time, so what dist/<site>/ holds now is this job's output and nothing of the new site.
    await rm(join(distDir(), site), { recursive: true, force: true })
  })
}

// Chrome renders one bulletin at a time. A bulletin composed again while its export waits or runs is picked up by
// the next sweep, because its export then carries another digest than its screens.
function enqueue(command: string[], site: string, bulletin: string, digest: string): void {
  const generation = siteGeneration(site)
  const key = `${site}/${bulletin}#${generation}`
  if (pending.has(key)) return
  pending.add(key)
  lastJob = lastJob.then(() =>
    exportNow(command, site, bulletin, digest, generation)
      .catch((error: Error) => console.warn(`[export] ${key} stopped: ${error.message}`))
      .finally(() => pending.delete(key)),
  )
}

// Every bulletin of the site that may go out now and has no export of its current screens: the one just approved,
// the others its class approval covers, or all of them when auto publish was switched on.
export async function requestMissingExports(site: string): Promise<void> {
  const command = exportCommand()
  if (!command.length) return
  const index = await readLayoutIndex(site)
  const approvals = await readApprovals()
  for (const row of (index?.entries ?? []) as ReplayRow[]) {
    if (!row.screen) continue
    const digest = await deliverableDigest(approvals, site, row.bulletin_id)
    if (digest && (await exportedDigest(site, row.bulletin_id)) !== digest) enqueue(command, site, row.bulletin_id, digest)
  }
}

// What a site shows without an approval action at that moment: a new bulletin that receive put up on a class
// approval, or one whose export was lost when the server stopped. Screens whose export already failed are left
// alone until they are composed or approved again, so a broken export does not start Chrome every few seconds.
export async function exportShownBulletins(): Promise<void> {
  const command = exportCommand()
  if (!command.length) return
  const approvals = await readApprovals()
  for (const [site, { auto_publish }] of Object.entries(approvals.sites)) {
    if (!auto_publish) continue
    const feed = await currentFeed(site)
    if (!feed?.bulletin_id || Object.keys(feed.assets).length) continue
    const digest = await deliverableDigest(approvals, site, feed.bulletin_id)
    if (!digest) continue
    const last = (await readJsonIfExists<Partial<ExportRecords>>(exportRecordFile(site)))?.jobs?.[feed.bulletin_id]
    if (last?.status === 'failed' && last.digest === digest) continue
    enqueue(command, site, feed.bulletin_id, digest)
  }
}
