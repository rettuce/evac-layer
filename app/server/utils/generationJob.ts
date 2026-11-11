import { randomBytes } from 'node:crypto'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { AdminPrincipal } from './adminPolicy'
import type { Actor } from './audit'
import type { ChildResult, ChildRun } from './childProcess'
import type { Generation, GenerationClass, SiteGenerations, StoredGeneration } from './generationRecord'

// Each job may call the Writer once per class on the operator's API account.
export const GENERATIONS_PER_FACILITY_PER_HOUR = 6
const RATE_WINDOW_MS = 60 * 60 * 1000
const GENERATION_TIMEOUT_MS = 60 * 60 * 1000
const OUTPUT_TAIL_CHARS = 2000

interface ActiveJob {
  id: string
  site: string
  siteGeneration: number
  cancelled: boolean
  child?: ChildRun
}

export class GenerationRateLimited extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`too many generations started in the last hour; try again in ${retryAfterSeconds} s`)
  }
}

const active = new Map<string, ActiveJob>()
const starts = new Map<string, number[]>()
let lastJob: Promise<void> = Promise.resolve()

const isActive = (id: string) => active.has(id)

export function readSiteGenerations(site: string): Promise<SiteGenerations> {
  return readGenerationFile(site, isActive)
}

function generationsPerHour(): number {
  const configured = Number(useRuntimeConfig().generationsPerHour)
  return Number.isInteger(configured) && configured > 0 ? configured : GENERATIONS_PER_FACILITY_PER_HOUR
}

// A facility shares one budget over all its sites; the operator, who may act on every site, is counted per site.
function rateKey(admin: AdminPrincipal, site: string): string {
  return admin.kind === 'facility' ? `facility:${admin.facility_id}` : `operator:${site}`
}

function retryAfter(key: string, now: number): number | undefined {
  const recent = (starts.get(key) ?? []).filter((at) => now - at < RATE_WINDOW_MS)
  starts.set(key, recent)
  if (recent.length < generationsPerHour()) return undefined
  return Math.max(1, Math.ceil((recent[0]! + RATE_WINDOW_MS - now) / 1000))
}

async function municipalityPrepared(municipality: string): Promise<boolean> {
  return access(join(dataDir(), 'municipalities', `${municipality}.json`)).then(() => true, () => false)
}

const isCurrent = (job: ActiveJob) => !job.cancelled && siteGeneration(job.site) === job.siteGeneration

function update(job: ActiveJob, change: (record: StoredGeneration) => StoredGeneration): Promise<boolean> {
  return withSiteLock(job.site, async () => {
    if (!isCurrent(job)) return false
    await updateGeneration(job.site, job.id, change, isActive)
    return true
  })
}

async function runChild(job: ActiveJob, command: string[], args: string[], timeoutMs: number): Promise<ChildResult | undefined> {
  if (!isCurrent(job)) return undefined
  job.child = runAgentCommand(command, args, { timeoutMs, tailChars: OUTPUT_TAIL_CHARS })
  const result = await job.child.done
  job.child = undefined
  return isCurrent(job) ? result : undefined
}

function withPreviewErrors(classes: GenerationClass[], errors: Record<string, string>): GenerationClass[] {
  return classes.map((c) => (c.bulletin_id && errors[c.bulletin_id] ? { ...c, preview_error: errors[c.bulletin_id] } : c))
}

async function runJob(command: string[], job: ActiveJob): Promise<void> {
  const startedAt = new Date().toISOString()
  const digests = await classDigests(job.site)
  if (!(await update(job, (record) => ({ ...record, status: 'running', started_at: startedAt, digests })))) return
  const config = useRuntimeConfig()
  const baseUrl = ownBaseUrl()
  const args = [`--site=${job.site}`, `--writer=${config.generateWriter}`, `--verifier=${config.generateVerifier}`, ...(baseUrl ? [`--base-url=${baseUrl}`] : [])]
  const result = await runChild(job, command, args, GENERATION_TIMEOUT_MS)
  if (!result) return
  const classes = (await generatedClasses(job.site, startedAt)) ?? []
  if (!(await update(job, (record) => ({ ...record, classes })))) return
  const passed = classes.filter((c) => c.outcome === 'pass').flatMap((c) => (c.bulletin_id ? [c.bulletin_id] : []))
  const errors = await renderPreviews(
    { site: job.site, isCurrent: () => isCurrent(job), run: (previewCommand, previewArgs, timeoutMs) => runChild(job, previewCommand, previewArgs, timeoutMs) },
    [...passed, ...(await passingBulletins(job.site))],
  )
  if (!errors) return
  await update(job, (record) => ({
    ...record,
    status: result.ok ? 'done' : 'failed',
    finished_at: new Date().toISOString(),
    classes: withPreviewErrors(classes, errors),
    ...(result.ok ? {} : { error: result.output || 'generate exited with an error' }),
  }))
}

// Composing opens Chrome and calls the Writer, so jobs run one at a time over all sites.
function enqueue(command: string[], id: string, site: string): void {
  const job: ActiveJob = { id, site, siteGeneration: siteGeneration(site), cancelled: false }
  active.set(id, job)
  lastJob = lastJob.then(() =>
    runJob(command, job)
      .catch(async (error: Error) => {
        console.warn(`[generate] ${site} ${id} stopped: ${error.message}`)
        await update(job, (record) => ({ ...record, status: 'failed', finished_at: new Date().toISOString(), error: error.message })).catch(() => undefined)
      })
      .finally(() => active.delete(id)),
  )
}

export async function startGeneration(site: string, admin: AdminPrincipal, actor: Actor | undefined): Promise<Generation | undefined> {
  const visible = async () => Boolean(await readVisibleSite(site, admin))
  const started = await guardedSiteWrite(site, {
    visible,
    write: async () => {
      const command = configuredCommand(useRuntimeConfig().generateCommand)
      if (!command.length) throw problem(503, 'generation-disabled', 'composing screens is switched off on this server')
      const stored = (await readSite(site))!
      if (!(await municipalityPrepared(stored.municipality_id))) {
        throw problem(409, 'municipality-not-prepared', `municipality ${stored.municipality_id} is not prepared yet; the operator prepares it`)
      }
      const open = [...active.values()].find((job) => job.site === site && isCurrent(job))
      if (open) throw problem(409, 'generation-running', `site ${site} has a job queued or running`, { generation_id: open.id })
      const now = Date.now()
      const key = rateKey(admin, site)
      const wait = retryAfter(key, now)
      if (wait !== undefined) throw new GenerationRateLimited(wait)
      const record: Generation = {
        generation_id: randomBytes(8).toString('hex'),
        site_id: site,
        status: 'queued',
        created_at: new Date(now).toISOString(),
        started_by: { token_label: admin.kind === 'facility' ? admin.label : 'operator', ...(actor ? { actor } : {}) },
        classes: [],
      }
      await pushGeneration(site, record, isActive)
      starts.get(key)!.push(now)
      enqueue(command, record.generation_id, site)
      return record
    },
  })
  return started?.value
}

// Called under the site's lock when the site's state is removed: nothing a job of the old site still holds may
// write after the removal.
export async function stopGenerationsOf(site: string): Promise<void> {
  const jobs = [...active.values()].filter((job) => job.site === site)
  for (const job of jobs) job.cancelled = true
  await Promise.all(jobs.map((job) => job.child?.stop()))
}
