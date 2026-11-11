import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isBulletinId } from '~~/layout/replay'
import { isShape } from '~~/layout/shapes'
import type { Shape } from '~~/layout/types'
import type { ChildResult } from './childProcess'

const PREVIEW_TIMEOUT_MS = 3 * 60 * 1000
const PREVIEW_DIGEST_FILE = 'layout-digest'

export interface PreviewRun {
  site: string
  isCurrent: () => boolean
  run: (command: string[], args: string[], timeoutMs: number) => Promise<ChildResult | undefined>
}

export function previewsDir(site: string, ...rest: string[]): string {
  return join(dataDir(), 'previews', site, ...rest)
}

export function previewUrl(site: string, bulletin: string, shape: string): string {
  return `/api/admin/sites/${encodeURIComponent(site)}/previews/${encodeURIComponent(bulletin)}/${shape}.png`
}

async function storedDigest(site: string, bulletin: string): Promise<string | undefined> {
  return readFile(previewsDir(site, bulletin, PREVIEW_DIGEST_FILE), 'utf8').then((text) => text.trim(), () => undefined)
}

// A preview shows the screens it was rendered from; once they are composed again it shows nothing current.
export async function currentPreviews(site: string, bulletin: string, digest: string): Promise<Record<string, string>> {
  if ((await storedDigest(site, bulletin)) !== digest) return {}
  const shapes = (await listDir(previewsDir(site, bulletin))).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)).filter(isShape)
  return Object.fromEntries(shapes.map((shape) => [shape, previewUrl(site, bulletin, shape)]))
}

export async function readPreview(site: string, bulletin: string, shape: Shape): Promise<{ png: Buffer; digest: string } | undefined> {
  const snapshot = await readLayoutSnapshot(site, bulletin)
  if (!snapshot || (await storedDigest(site, bulletin)) !== snapshot.digest) return undefined
  const png = await readFile(previewsDir(site, bulletin, `${shape}.png`)).catch(() => undefined)
  return png && { png, digest: snapshot.digest }
}

async function publish(site: string, bulletin: string, staging: string, digest: string, result: ChildResult): Promise<string | undefined> {
  const rendered = (await listDir(staging)).filter((f) => f.endsWith('.png'))
  const now = await readLayoutSnapshot(site, bulletin)
  if (now?.digest !== digest || !rendered.length) {
    await rm(staging, { recursive: true, force: true })
    return now?.digest !== digest ? 'the screens were composed again while the preview rendered' : result.output || 'no preview was rendered'
  }
  await writeFile(join(staging, PREVIEW_DIGEST_FILE), digest)
  await rm(previewsDir(site, bulletin), { recursive: true, force: true })
  await rename(staging, previewsDir(site, bulletin))
  return result.ok ? undefined : result.output || 'some shapes were not rendered'
}

// Answers why the preview of each bulletin is missing or partial, or undefined when the job no longer belongs to the
// site (deleted, perhaps registered again by someone else) and must stop.
export async function renderPreviews(job: PreviewRun, bulletins: readonly string[]): Promise<Record<string, string> | undefined> {
  const command = configuredCommand(useRuntimeConfig().previewCommand)
  const errors: Record<string, string> = {}
  if (!command.length) return errors
  const baseUrl = ownBaseUrl()
  for (const bulletin of new Set(bulletins.filter(isBulletinId))) {
    const snapshot = await readLayoutSnapshot(job.site, bulletin)
    if (!snapshot || (await storedDigest(job.site, bulletin)) === snapshot.digest) continue
    const staging = previewsDir(job.site, `.${bulletin}.staging`)
    const ready = await withSiteLock(job.site, async () => {
      if (!job.isCurrent()) return false
      await rm(staging, { recursive: true, force: true })
      await mkdir(previewsDir(job.site), { recursive: true })
      return true
    })
    if (!ready) return undefined
    const args = [`--site=${job.site}`, `--bulletin=${bulletin}`, `--out=${staging}`, ...(baseUrl ? [`--base-url=${baseUrl}`] : [])]
    const result = await job.run(command, args, PREVIEW_TIMEOUT_MS)
    if (!result) return undefined
    const outcome = await withSiteLock(job.site, async () => (job.isCurrent() ? { error: await publish(job.site, bulletin, staging, snapshot.digest, result) } : undefined))
    if (!outcome) return undefined
    if (outcome.error) errors[bulletin] = outcome.error
  }
  return errors
}
