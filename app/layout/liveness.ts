import { type ChannelSent, type DueNotice, REASON_CHANGE_MIN_MS, msSince, noticeDue } from './noticeSchedule.ts'

export interface StoppedReceiver {
  site: string
  received_at: string
  ms: number
}

// `received_at` is written by `receive` after a round in which every feed was fetched; a site it never ran for has none.
export function stoppedReceivers(records: { site: string; received_at: unknown }[], now: number, thresholdMs: number): StoppedReceiver[] {
  const stopped: StoppedReceiver[] = []
  for (const { site, received_at } of records) {
    const ms = typeof received_at === 'string' ? Date.parse(received_at) : Number.NaN
    if (Number.isFinite(ms) && now - ms >= thresholdMs) stopped.push({ site, received_at: received_at as string, ms })
  }
  return stopped.sort((a, b) => a.ms - b.ms || a.site.localeCompare(b.site))
}

// The sites listed in a channel's last notice are kept as its reason, separated by spaces (site ids hold none).
export function receiversNoticeDue({ sent, sites, now, remindMs }: { sent: ChannelSent<string> | undefined; sites: string[]; now: number; remindMs: number }): DueNotice<string> | undefined {
  if (sent?.reason !== undefined) {
    const before = new Set(sent.reason.split(' '))
    if (sites.some((site) => !before.has(site)) && msSince(sent.lastSentMs, now) >= REASON_CHANGE_MIN_MS) return { count: sent.count + 1 }
  }
  return noticeDue({ sent: sent && { ...sent, reason: undefined }, reason: '', now, remindMs })
}

export type FeedActivity = 'active' | 'idle' | 'unsure'

// A poll from before the server started is not known to have stopped until the threshold has passed since the start:
// the screen may have been waiting for the server to come back.
export function feedActivity({ lastSeenMs, startedMs, now, thresholdMs }: { lastSeenMs: number | undefined; startedMs: number; now: number; thresholdMs: number }): FeedActivity | undefined {
  if (lastSeenMs === undefined) return undefined
  if (now - lastSeenMs < thresholdMs) return 'active'
  return now - startedMs >= thresholdMs ? 'idle' : 'unsure'
}
