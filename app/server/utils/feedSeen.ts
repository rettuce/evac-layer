import { join } from 'node:path'
import { type FeedRequests, notedRequest } from '~~/layout/liveness'

// The disk copy only carries the requests across a restart: while they go on it may lag this much, and once they stop
// the last one is written within a check of this quiet time.
const WRITE_EVERY_MS = 60 * 1000
const QUIET_MS = 3000

interface Seen extends FeedRequests {
  generation: number
  written?: FeedRequests
}

const seen = new Map<string, Seen>()
const loaded = new Map<string, number>()
let thresholdMs = 0

export function feedSeenFile(site: string): string {
  return join(dataDir(), 'live', `${site}.feed-seen.json`)
}

export function watchFeedRequests(threshold: number): void {
  thresholdMs = threshold
}

// Called on every counted request, so it only touches memory. `generation` is the site's when the request began: a
// site deleted, or deleted and registered again, meanwhile is not credited with it.
export function noteSiteRequest(site: SiteFile, generation: number, now = Date.now()): void {
  if (thresholdMs <= 0 || site.replay || siteGeneration(site.id) !== generation) return
  const known = seen.get(site.id)
  if (known?.generation === generation) Object.assign(known, notedRequest(known, now, thresholdMs))
  else seen.set(site.id, { ...notedRequest(undefined, now, thresholdMs), generation })
}

async function loadOnce(site: string, generation: number): Promise<void> {
  if (loaded.get(site) === generation) return
  loaded.set(site, generation)
  const stored = await readJsonIfExists<{ site_id?: unknown; first_request_at?: unknown; last_request_at?: unknown }>(feedSeenFile(site)).catch(() => undefined)
  const firstMs = typeof stored?.first_request_at === 'string' ? Date.parse(stored.first_request_at) : Number.NaN
  const lastMs = typeof stored?.last_request_at === 'string' ? Date.parse(stored.last_request_at) : Number.NaN
  if (stored?.site_id !== site || !Number.isFinite(firstMs) || !Number.isFinite(lastMs) || siteGeneration(site) !== generation) return
  const disk = { firstMs, lastMs }
  const known = seen.get(site)
  if (known?.generation !== generation) return void seen.set(site, { ...disk, generation, written: disk })
  if (known.firstMs - lastMs < thresholdMs) known.firstMs = Math.min(known.firstMs, firstMs)
  known.written ??= disk
}

export async function feedRequests(site: string): Promise<FeedRequests | undefined> {
  const generation = siteGeneration(site)
  await loadOnce(site, generation)
  const known = seen.get(site)
  return known?.generation === generation ? { firstMs: known.firstMs, lastMs: known.lastMs } : undefined
}

export function forgetFeedRequests(watched: Set<string>): void {
  for (const [site, known] of seen) if (!watched.has(site) || known.generation !== siteGeneration(site)) seen.delete(site)
  for (const site of loaded.keys()) if (!watched.has(site)) loaded.delete(site)
}

function due(known: Seen, now: number): boolean {
  const { written } = known
  if (!written) return true
  if (written.firstMs === known.firstMs && written.lastMs === known.lastMs) return false
  return written.firstMs !== known.firstMs || known.lastMs - written.lastMs >= WRITE_EVERY_MS || now - known.lastMs >= QUIET_MS
}

export async function writeFeedRequests(now: number, warn: (scope: string, message: string) => void, recovered: (scope: string) => void): Promise<void> {
  for (const [site, known] of seen) {
    if (!due(known, now)) continue
    const requests = { firstMs: known.firstMs, lastMs: known.lastMs }
    try {
      const value = { site_id: site, first_request_at: new Date(requests.firstMs).toISOString(), last_request_at: new Date(requests.lastMs).toISOString() }
      if (await writeSiteRecord(site, known.generation, feedSeenFile(site), value)) {
        known.written = requests
        recovered(`feed-seen ${site}`)
      } else if (seen.get(site) === known) seen.delete(site)
    } catch (error) {
      warn(`feed-seen ${site}`, `feed requests of ${site} not recorded: ${failureCode(error)}`)
    }
  }
}
