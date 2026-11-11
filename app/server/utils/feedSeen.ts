import { join } from 'node:path'

// The disk copy only carries the last request across a restart, so it may lag by this much.
const WRITE_EVERY_MS = 60 * 1000

interface Seen {
  generation: number
  ms: number
  writtenMs?: number
}

const seen = new Map<string, Seen>()
const loaded = new Map<string, number>()

export function feedSeenFile(site: string): string {
  return join(dataDir(), 'live', `${site}.feed-seen.json`)
}

// Called on every feed request, so it only touches memory. `generation` is the site's when the request began: a site
// deleted, or deleted and registered again, while it was answered is not credited with it.
export function noteFeedRequest(site: string, generation: number, now = Date.now()): void {
  if (siteGeneration(site) !== generation) return
  const known = seen.get(site)
  if (known?.generation === generation) known.ms = Math.max(known.ms, now)
  else seen.set(site, { generation, ms: now })
}

async function loadOnce(site: string, generation: number): Promise<void> {
  if (loaded.get(site) === generation) return
  loaded.set(site, generation)
  const stored = await readJsonIfExists<{ site_id?: unknown; last_request_at?: unknown }>(feedSeenFile(site)).catch(() => undefined)
  const ms = stored?.site_id === site && typeof stored.last_request_at === 'string' ? Date.parse(stored.last_request_at) : Number.NaN
  if (!Number.isFinite(ms) || siteGeneration(site) !== generation) return
  const known = seen.get(site)
  if (known?.generation === generation) {
    if (ms > known.ms) known.ms = ms
    known.writtenMs ??= ms
  } else seen.set(site, { generation, ms, writtenMs: ms })
}

export async function lastFeedRequest(site: string): Promise<number | undefined> {
  const generation = siteGeneration(site)
  await loadOnce(site, generation)
  const known = seen.get(site)
  return known?.generation === generation ? known.ms : undefined
}

export function forgetFeedRequests(present: Set<string>): void {
  for (const site of seen.keys()) if (!present.has(site) || seen.get(site)!.generation !== siteGeneration(site)) seen.delete(site)
  for (const site of loaded.keys()) if (!present.has(site)) loaded.delete(site)
}

export async function writeFeedRequests(warn: (scope: string, message: string) => void, recovered: (scope: string) => void): Promise<void> {
  for (const [site, known] of seen) {
    if (known.writtenMs !== undefined && known.ms - known.writtenMs < WRITE_EVERY_MS) continue
    const ms = known.ms
    try {
      const written = await writeSiteRecord(site, known.generation, feedSeenFile(site), { site_id: site, last_request_at: new Date(ms).toISOString() })
      if (written) {
        known.writtenMs = ms
        recovered(`feed-seen ${site}`)
      } else if (seen.get(site) === known) seen.delete(site)
    } catch (error) {
      warn(`feed-seen ${site}`, `last feed request of ${site} not recorded: ${failureCode(error)}`)
    }
  }
}
