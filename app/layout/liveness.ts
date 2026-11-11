import { type ChannelSent, type DueNotice, REASON_CHANGE_MIN_MS, msSince, noticeDue } from './noticeSchedule.ts'

const HOUR_MS = 60 * 60 * 1000
const RESUME_WITHOUT_REMINDERS_MS = 15 * 60 * 1000

export interface StoppedReceiver {
  site: string
  at: string
  ms: number
}

export interface ReceiverScan {
  stopped: StoppedReceiver[]
  unreadable: string[]
  future: string[]
}

// `receive` writes `fetched_at` once every feed of a round was fetched, before it composes any site's screens, and
// `received_at` once it has composed the site's. A receiver of an earlier version writes only `received_at`; a site no
// receiver ran for has neither.
export function stoppedReceivers(records: { site: string; received_at: unknown; fetched_at?: unknown }[], now: number, thresholdMs: number): ReceiverScan {
  const scan: ReceiverScan = { stopped: [], unreadable: [], future: [] }
  for (const { site, received_at, fetched_at } of records) {
    const at = fetched_at === undefined ? received_at : fetched_at
    if (at === undefined) continue
    const ms = typeof at === 'string' ? Date.parse(at) : Number.NaN
    if (!Number.isFinite(ms)) scan.unreadable.push(site)
    else if (ms > now) scan.future.push(site)
    else if (now - ms >= thresholdMs) scan.stopped.push({ site, at: at as string, ms })
  }
  scan.stopped.sort((a, b) => a.ms - b.ms || a.site.localeCompare(b.site))
  return scan
}

export interface ListEntry {
  site: string
  alert?: boolean
}

// A channel's reason holds the entries of its last notice: site ids (which hold no space or `!`), `!` after one that
// should show a warning.
export function entriesReason(entries: ListEntry[]): string {
  return entries.map((entry) => (entry.alert ? `${entry.site}!` : entry.site)).join(' ')
}

function parseReason(reason: string): Map<string, boolean> {
  return new Map(reason.split(' ').filter(Boolean).map((token) => [token.replace(/!$/, ''), token.endsWith('!')]))
}

export function withoutSite(reason: string, site: string): string {
  return reason.split(' ').filter((token) => token && token.replace(/!$/, '') !== site).join(' ')
}

// A site that joins the list, or one that should now show a warning, is told at once; one that leaves it is not.
export function listNoticeDue({ sent, entries, now, remindMs }: { sent: ChannelSent<string> | undefined; entries: ListEntry[]; now: number; remindMs: number }): DueNotice<string> | undefined {
  if (sent?.reason !== undefined) {
    const before = parseReason(sent.reason)
    const grew = entries.some((entry) => !before.has(entry.site) || (entry.alert && !before.get(entry.site)))
    if (grew && msSince(sent.lastSentMs, now) >= REASON_CHANGE_MIN_MS) return { count: sent.count + 1 }
  }
  return noticeDue({ sent: sent && { ...sent, reason: undefined }, reason: '', now, remindMs })
}

// A record read after a long stop of the server tells of a state nobody has been reminded of for long: it is over.
export function recordOutdated(lastMs: number, now: number, remindMs: number): boolean {
  return now - lastMs > (remindMs > 0 ? 3 * remindMs : HOUR_MS)
}

// A state that ends and comes back within a reminder interval is the same state, so short gaps do not restart the count.
export function resumesWithin(resolvedMs: number, now: number, remindMs: number): boolean {
  return now - resolvedMs <= (remindMs > 0 ? remindMs : RESUME_WITHOUT_REMINDERS_MS)
}

export interface FeedRequests {
  firstMs: number
  lastMs: number
}

// A gap of the threshold or more starts a new run of requests: a screen back after a long stop is watched again only
// once it has kept polling for the threshold.
export function notedRequest(previous: FeedRequests | undefined, now: number, thresholdMs: number): FeedRequests {
  if (!previous || now - previous.lastMs >= thresholdMs) return { firstMs: now, lastMs: now }
  return { firstMs: previous.firstMs, lastMs: Math.max(previous.lastMs, now) }
}

export type FeedActivity = 'active' | 'idle'

// Only a screen that kept polling for the threshold is watched, so a site requested once by hand raises nothing.
export function feedActivity(requests: FeedRequests | undefined, now: number, thresholdMs: number): FeedActivity | undefined {
  if (!requests) return undefined
  if (now - requests.lastMs < thresholdMs) return 'active'
  return requests.lastMs - requests.firstMs >= thresholdMs ? 'idle' : undefined
}

export function stoppedTogether(newlyIdle: number, watched: number): boolean {
  return watched >= 3 && newlyIdle * 2 > watched
}
