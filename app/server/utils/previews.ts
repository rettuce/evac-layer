import { copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { isBulletinId } from '~~/layout/replay'
import { isShape } from '~~/layout/shapes'
import type { Shape } from '~~/layout/types'
import type { LayoutSnapshot } from './approvals'
import type { ChildResult } from './childProcess'
import type { PreviewErrorCode } from './generationRecord'

const PREVIEW_TIMEOUT_MS = 3 * 60 * 1000
const PREVIEW_DIGEST_FILE = 'layout-digest'
const STAGING_PREFIX = '.'

export interface PreviewRun {
  site: string
  isCurrent: () => boolean
  run: (command: string[], args: string[], timeoutMs: number, match: string[]) => Promise<ChildResult | undefined>
}

export interface PreviewOutcome {
  errors: Record<string, PreviewErrorCode>
}

function previewsRoot(): string {
  return join(dataDir(), 'previews')
}

export function previewsDir(site: string, ...rest: string[]): string {
  return join(previewsRoot(), site, ...rest)
}

export function previewUrl(site: string, bulletin: string, shape: string): string {
  return `/api/admin/sites/${encodeURIComponent(site)}/previews/${encodeURIComponent(bulletin)}/${shape}.png`
}

// A link below the data directory could point anywhere, so nothing under it is read or written through one.
async function linkFree(base: string, target: string): Promise<boolean> {
  let current = base
  for (const part of relative(base, target).split(sep).filter(Boolean)) {
    current = join(current, part)
    const stat = await lstat(current).catch(() => undefined)
    if (!stat) return true
    if (stat.isSymbolicLink()) return false
  }
  return true
}

async function readPreviewFile(site: string, bulletin: string, name: string): Promise<Buffer | undefined> {
  const file = previewsDir(site, bulletin, name)
  if (!(await linkFree(previewsRoot(), file))) return undefined
  return readFile(file).catch(() => undefined)
}

async function storedDigest(site: string, bulletin: string): Promise<string | undefined> {
  return (await readPreviewFile(site, bulletin, PREVIEW_DIGEST_FILE))?.toString('utf8').trim()
}

async function renderedShapes(site: string, bulletin: string): Promise<Shape[]> {
  if (!(await linkFree(previewsRoot(), previewsDir(site, bulletin)))) return []
  const names = (await listDir(previewsDir(site, bulletin))).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)).filter(isShape)
  const plain = await Promise.all(names.map(async (shape) => ((await lstat(previewsDir(site, bulletin, `${shape}.png`))).isFile() ? shape : undefined)))
  return plain.filter((shape): shape is Shape => shape !== undefined)
}

// A preview shows the screens it was rendered from; once they are composed again it shows nothing current.
export async function currentPreviews(site: string, bulletin: string, digest: string): Promise<Record<string, string>> {
  if ((await storedDigest(site, bulletin)) !== digest) return {}
  return Object.fromEntries((await renderedShapes(site, bulletin)).map((shape) => [shape, previewUrl(site, bulletin, shape)]))
}

export async function readPreview(site: string, bulletin: string, shape: Shape): Promise<{ png: Buffer; digest: string } | undefined> {
  const snapshot = await readLayoutSnapshot(site, bulletin)
  if (!snapshot || (await storedDigest(site, bulletin)) !== snapshot.digest) return undefined
  if (!(await renderedShapes(site, bulletin)).includes(shape)) return undefined
  const png = await readPreviewFile(site, bulletin, `${shape}.png`)
  return png && { png, digest: snapshot.digest }
}

async function complete(site: string, bulletin: string, snapshot: LayoutSnapshot): Promise<boolean> {
  if ((await storedDigest(site, bulletin)) !== snapshot.digest) return false
  const rendered = await renderedShapes(site, bulletin)
  return snapshot.files.every((file) => rendered.includes(file.shape as Shape))
}

// Shapes this render missed are kept from an earlier render of the same screens.
async function publish(site: string, bulletin: string, staging: string, digest: string, result: ChildResult): Promise<PreviewErrorCode | undefined> {
  const now = await readLayoutSnapshot(site, bulletin)
  if (now?.digest !== digest) {
    await rm(staging, { recursive: true, force: true })
    return 'screens-changed'
  }
  if (!(await linkFree(previewsRoot(), staging))) return 'preview-failed'
  const fresh = (await listDir(staging)).filter((f) => f.endsWith('.png'))
  if ((await storedDigest(site, bulletin)) === digest) {
    for (const shape of await renderedShapes(site, bulletin)) {
      if (!fresh.includes(`${shape}.png`)) await copyFile(previewsDir(site, bulletin, `${shape}.png`), join(staging, `${shape}.png`))
    }
  }
  if (!(await listDir(staging)).some((f) => f.endsWith('.png'))) {
    await rm(staging, { recursive: true, force: true })
    return result.timedOut ? 'timed-out' : 'preview-failed'
  }
  await writeFile(join(staging, PREVIEW_DIGEST_FILE), digest)
  await rm(previewsDir(site, bulletin), { recursive: true, force: true })
  await rename(staging, previewsDir(site, bulletin))
  if (result.ok && (await complete(site, bulletin, now))) return undefined
  return result.timedOut ? 'timed-out' : 'preview-failed'
}

// Answers why the preview of each bulletin is missing or partial, or undefined when the job no longer belongs to the
// site (deleted, perhaps registered again by someone else) and must stop.
export async function renderPreviews(job: PreviewRun, bulletins: readonly string[], deadline: number): Promise<PreviewOutcome | undefined> {
  const command = configuredCommand(useRuntimeConfig().previewCommand)
  const outcome: PreviewOutcome = { errors: {} }
  if (!command.length) return outcome
  const baseUrl = ownBaseUrl()
  for (const bulletin of new Set(bulletins.filter(isBulletinId))) {
    const snapshot = await readLayoutSnapshot(job.site, bulletin)
    if (!snapshot || (await complete(job.site, bulletin, snapshot))) continue
    const left = deadline - Date.now()
    if (left <= 0) {
      outcome.errors[bulletin] = 'timed-out'
      continue
    }
    const staging = previewsDir(job.site, `${STAGING_PREFIX}${bulletin}.staging`)
    const ready = await withSiteLock(job.site, async () => {
      if (!job.isCurrent()) return undefined
      const layoutsSafe = await Promise.all(snapshot.files.map((file) => linkFree(join(dataDir(), 'layouts'), siteLayoutsDir(job.site, bulletin, `${file.shape}.json`))))
      if (!layoutsSafe.every(Boolean)) return false
      await mkdir(previewsDir(job.site), { recursive: true })
      if (!(await linkFree(previewsRoot(), previewsDir(job.site)))) return false
      await rm(staging, { recursive: true, force: true })
      return true
    })
    if (ready === undefined) return undefined
    if (!ready) {
      outcome.errors[bulletin] = 'preview-failed'
      continue
    }
    const args = [`--site=${job.site}`, `--bulletin=${bulletin}`, `--out=${staging}`, ...(baseUrl ? [`--base-url=${baseUrl}`] : [])]
    const result = await job.run(command, args, Math.min(PREVIEW_TIMEOUT_MS, left), [`--site=${job.site}`, `--bulletin=${bulletin}`])
    if (!result) return undefined
    if (!result.ok) console.warn(`[preview] ${job.site} ${bulletin}: ${result.output}`)
    const published = await withSiteLock(job.site, async () => (job.isCurrent() ? { error: await publish(job.site, bulletin, staging, snapshot.digest, result) } : undefined))
    if (!published) return undefined
    if (published.error) outcome.errors[bulletin] = published.error
  }
  return outcome
}

// Run under the site's lock: previews of bulletins that no longer stand for a class are not shown anywhere.
export async function prunePreviews(site: string, keep: ReadonlySet<string>): Promise<void> {
  if (!(await linkFree(previewsRoot(), previewsDir(site)))) return
  for (const name of await listDir(previewsDir(site))) {
    if (!keep.has(name)) await rm(previewsDir(site, name), { recursive: true, force: true })
  }
}
