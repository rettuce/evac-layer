import { randomBytes } from 'node:crypto'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { AdminPrincipal } from './adminPolicy'
import type { Actor } from './audit'
import type { AgentPurpose, ChildResult, ChildRun } from './childProcess'
import type { Generation, GenerationClass, GenerationErrorCode, JobResult, PreviewErrorCode, SiteGenerations, StoredGeneration } from './generationRecord'

// Each job may call the Writer once per class on the operator's API account.
export const GENERATIONS_PER_FACILITY_PER_HOUR = 6
// Jobs run one at a time over all facilities, so one facility's queue must not hold the others back for long.
export const OPEN_JOBS_PER_FACILITY = 2
const OPEN_JOBS_RETRY_AFTER_S = 60
const RATE_WINDOW_MS = 60 * 60 * 1000
const JOB_TIMEOUT_MS = 90 * 60 * 1000
const OUTPUT_TAIL_CHARS = 4000

interface ActiveJob {
  id: string
  site: string
  key: string
  siteGeneration: number
  cancelled: boolean
  child?: ChildRun
}

export class GenerationRateLimited extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`too many generations started or waiting; try again in ${retryAfterSeconds} s`)
  }
}

const active = new Map<string, ActiveJob>()
const starts = new Map<string, number[]>()
let lastJob: Promise<void> = Promise.resolve()

const isActive = (id: string) => active.has(id)
const isCurrent = (job: ActiveJob) => !job.cancelled && siteGeneration(job.site) === job.siteGeneration

function positiveSetting(value: unknown, fallback: number): number {
  const configured = Number(value)
  return Number.isInteger(configured) && configured > 0 ? configured : fallback
}

// A facility shares one budget over all its sites; the operator, who may act on every site, is counted per site.
function rateKey(admin: AdminPrincipal, site: string): string {
  return admin.kind === 'facility' ? `facility:${admin.facility_id}` : `operator:${site}`
}

function retryAfter(key: string, now: number): number | undefined {
  for (const [other, times] of starts) {
    const recent = times.filter((at) => now - at < RATE_WINDOW_MS)
    if (recent.length) starts.set(other, recent)
    else starts.delete(other)
  }
  const config = useRuntimeConfig()
  const open = [...active.values()].filter((job) => job.key === key && isCurrent(job)).length
  if (open >= positiveSetting(config.generationOpenJobsPerFacility, OPEN_JOBS_PER_FACILITY)) return OPEN_JOBS_RETRY_AFTER_S
  const recent = starts.get(key) ?? []
  if (recent.length < positiveSetting(config.generationsPerHour, GENERATIONS_PER_FACILITY_PER_HOUR)) return undefined
  return Math.max(1, Math.ceil((recent[0]! + RATE_WINDOW_MS - now) / 1000))
}

async function municipalityPrepared(municipality: string): Promise<boolean> {
  return access(join(dataDir(), 'municipalities', `${municipality}.json`)).then(() => true, () => false)
}

// Run under the site's lock. A record left open by a stopped server becomes failed; its child, when it is still
// running and matches the record, is stopped first. One that cannot be checked, or does not stop, goes to the orphan
// table, which holds the site until it ends.
async function reapStale(site: string): Promise<void> {
  const file = await readRawGenerationFile(site)
  let changed = false
  for (const slot of ['latest', 'previous'] as const) {
    const record = file[slot]
    if (!record || !isOpen(record) || active.has(record.generation_id)) continue
    const state = record.child ? await stopOrphan(record.child) : 'gone'
    if (record.child && (state === 'unknown' || state === 'alive')) {
      const facility = (await readSite(site).catch(() => undefined))?.facility_id
      await addOrphan({ ...record.child, site_id: site, generation_id: record.generation_id, ...(facility ? { facility_id: facility } : {}) })
    }
    file[slot] = restarted(record)
    changed = true
  }
  if (changed) await writeGenerationFile(file)
}

function needsReaping(file: SiteGenerations): boolean {
  return [file.latest, file.previous].some((record) => record && isOpen(record) && !active.has(record.generation_id))
}

export async function readSiteGenerations(site: string): Promise<SiteGenerations> {
  if (needsReaping(await readRawGenerationFile(site))) await withSiteLock(site, () => reapStale(site))
  return readGenerationFile(site, isActive)
}

export async function reapAllStale(): Promise<void> {
  const sites = (await listDir(join(dataDir(), 'live'))).filter((f) => f.endsWith('.generation.json')).map((f) => f.slice(0, -'.generation.json'.length))
  for (const site of sites) await readSiteGenerations(site).catch((error: Error) => console.warn(`[generate] ${site}: ${error.message}`))
}

function update(job: ActiveJob, change: (record: StoredGeneration) => StoredGeneration, results: Pick<SiteGenerations, 'last_result' | 'last_success'> = {}): Promise<boolean> {
  return withSiteLock(job.site, async () => {
    if (!isCurrent(job)) return false
    await updateGeneration(job.site, job.id, change, isActive, results)
    return true
  })
}

async function runChild(job: ActiveJob, purpose: AgentPurpose, command: string[], args: string[], timeoutMs: number, match: string[]): Promise<ChildResult | undefined> {
  if (!isCurrent(job) || isShuttingDown()) return undefined
  const child = runAgentCommand(command, args, { purpose, timeoutMs, tailChars: OUTPUT_TAIL_CHARS, owner: { site: job.site, match, generationId: job.id } })
  job.child = child
  if (child.pid) await update(job, (record) => ({ ...record, child: { pgid: child.pid!, started_at: child.startedAt, match, kind: purpose } }))
  const result = await child.done
  job.child = undefined
  return isCurrent(job) && !isShuttingDown() ? result : undefined
}

function withPreviewErrors(classes: GenerationClass[], errors: Record<string, PreviewErrorCode>): GenerationClass[] {
  return classes.map((c) => (c.bulletin_id && errors[c.bulletin_id] ? { ...c, preview_error: errors[c.bulletin_id] } : c))
}

async function currentRepresentatives(site: string) {
  const stored = await readSite(site)
  return stored ? representatives(stored, await readGenerationFile(site, isActive)) : []
}

async function finish(job: ActiveJob, failure: GenerationErrorCode | undefined, classes: GenerationClass[], summary: JobResult | undefined): Promise<void> {
  await withSiteLock(job.site, async () => {
    if (!isCurrent(job)) return
    const finishedAt = new Date().toISOString()
    await updateGeneration(
      job.site,
      job.id,
      ({ child: _child, ...record }) => ({ ...record, status: failure ? 'failed' : 'done', finished_at: finishedAt, classes, ...(failure ? { error_code: failure, error: ERROR_TEXT[failure] } : {}) }),
      isActive,
      !failure && summary ? { last_success: summary } : {},
    )
    await prunePreviews(job.site, new Set((await currentRepresentatives(job.site)).map((rep) => rep.row.bulletin_id)))
  })
}

async function runJob(command: string[], job: ActiveJob): Promise<void> {
  const begun = await withSiteLock(job.site, async () => {
    const site = isCurrent(job) ? await readSite(job.site) : undefined
    if (!site) return undefined
    const reps = await representatives(site, await readGenerationFile(job.site, isActive))
    const digests = Object.fromEntries(reps.map((rep) => [rep.cls, { bulletin_id: rep.row.bulletin_id, digest: rep.snapshot.digest }]))
    const startedAt = new Date().toISOString()
    const place = placeOf(site)
    await updateGeneration(job.site, job.id, (record) => ({ ...record, status: 'running', started_at: startedAt, place, digests }), isActive)
    return { startedAt, place }
  })
  if (!begun) return
  const deadline = Date.parse(begun.startedAt) + JOB_TIMEOUT_MS
  const config = useRuntimeConfig()
  const baseUrl = ownBaseUrl()
  const match = [`--site=${job.site}`, `--writer=${config.generateWriter}`]
  const args = [...match, `--verifier=${config.generateVerifier}`, ...(baseUrl ? [`--base-url=${baseUrl}`] : [])]
  const result = await runChild(job, 'generate', command, args, deadline - Date.now(), match)
  if (!result) return
  if (!result.ok) console.warn(`[generate] ${job.site} ${job.id}: ${result.output}`)
  const generated = await generatedResult(job.site, begun.startedAt)
  const summary = generated && { generation_id: job.id, started_at: begun.startedAt, place: begun.place, rows: generated.rows, ...(generated.composable ? { composable: generated.composable } : {}) }
  const classes = generated?.classes ?? []
  if (!(await update(job, (record) => ({ ...record, classes }), summary ? { last_result: summary } : {}))) return
  let errors: Record<string, PreviewErrorCode> = {}
  if (generated) {
    const passed = classes.flatMap((c) => (c.outcome === 'pass' && c.bulletin_id ? [c.bulletin_id] : []))
    const standing = (await currentRepresentatives(job.site)).filter((rep) => snapshotOutcome(rep.snapshot) === 'pass').map((rep) => rep.row.bulletin_id)
    const previews = await renderPreviews(
      { site: job.site, isCurrent: () => isCurrent(job) && !isShuttingDown(), run: (previewCommand, previewArgs, timeoutMs, previewMatch) => runChild(job, 'preview', previewCommand, previewArgs, timeoutMs, previewMatch) },
      [...passed, ...standing],
      deadline,
    )
    if (!previews) return
    errors = previews.errors
  }
  const failure: GenerationErrorCode | undefined = result.timedOut || Date.now() >= deadline ? 'timed-out' : !result.ok ? 'generate-failed' : !generated ? 'no-result' : undefined
  await finish(job, failure, withPreviewErrors(classes, errors), summary)
}

// Composing opens Chrome and calls the Writer, so jobs run one at a time over all sites, in the order they came.
function enqueue(command: string[], job: ActiveJob): void {
  lastJob = lastJob.then(() =>
    runJob(command, job)
      .catch(async (error: Error) => {
        console.warn(`[generate] ${job.site} ${job.id} stopped: ${error.stack ?? error.message}`)
        await update(job, ({ child: _child, ...record }) => ({ ...record, status: 'failed', finished_at: new Date().toISOString(), error_code: 'internal-error', error: ERROR_TEXT['internal-error'] })).catch(() => undefined)
      })
      .finally(() => active.delete(job.id)),
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
      await reapStale(site)
      const [orphan] = await liveOrphans(site)
      if (orphan) throw problem(409, 'generation-running', `a process of site ${site} left by an earlier job is still running`, orphan.generation_id ? { generation_id: orphan.generation_id } : {})
      // From here to the registration nothing awaits, so starts of one facility on other sites cannot slip in between.
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
      const job: ActiveJob = { id: record.generation_id, site, key, siteGeneration: siteGeneration(site), cancelled: false }
      const times = starts.get(key) ?? []
      starts.set(key, [...times, now])
      active.set(job.id, job)
      try {
        await pushGeneration(site, record, isActive)
      } catch (error) {
        active.delete(job.id)
        const kept = [...(starts.get(key) ?? [])]
        kept.splice(kept.lastIndexOf(now), 1)
        starts.set(key, kept)
        throw error
      }
      enqueue(command, job)
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
