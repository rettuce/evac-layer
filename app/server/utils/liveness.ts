import { join } from 'node:path'
import type { Approvals } from '~~/layout/gate'
import { type ListEntry, entriesReason, feedActivity, listNoticeDue, recordOutdated, resumesWithin, stoppedReceivers, stoppedTogether, withoutSite } from '~~/layout/liveness'
import { type ExpectedScreen, type IdleSite, feedIdleMessage, isAlert, receiverStoppedMessage } from '~~/layout/livenessNotice'
import type { OutgoingNotice } from '~~/layout/notice'
import { type NoticeDelivery, type NoticeTarget, type SentChannels, type StoredChannels, sentFrom, storedFrom } from './noticeDelivery'

type Warn = (scope: string, message: string) => void

const TICK_MAX_MS = 15000
const TICK_MIN_MS = 1000
// A check this late means the clock jumped or the process was paused: requests may simply not have been seen.
const PAUSED_AFTER_MS = 30000
const EXPECTED_FOR_MS = 30000

const iso = (ms: number) => new Date(ms).toISOString()

interface ListRecord {
  first_seen_at: string
  resolved_at?: string
  together?: boolean
  channels: StoredChannels<string>
}

interface ListState {
  record: ListRecord
  sent: SentChannels<string>
}

// Not under a site id: one notice covers every site. A directory name holds no dot, so it never meets a file of a site.
export function listRecordFile(name: 'receivers' | 'feed-idle'): string {
  return join(dataDir(), 'live', 'notify', `${name}.json`)
}

function lastActivityMs(state: ListState): number {
  return Math.max(Date.parse(state.record.first_seen_at), ...Object.values(state.sent).map((sent) => (Number.isFinite(sent?.lastSentMs) ? sent!.lastSentMs! : -Infinity)))
}

function listNotice(name: 'receivers' | 'feed-idle', settings: NotifySettings, delivery: NoticeDelivery, warn: Warn) {
  let state: ListState | undefined
  let loaded = false

  async function persist(current: ListState) {
    try {
      await writeJsonFile(listRecordFile(name), { ...current.record, channels: storedFrom(current.sent) })
    } catch (error) {
      warn(`record ${name}`, `notice record of ${name} not recorded: ${failureCode(error)}`)
    }
  }

  async function load(now: number) {
    if (loaded) return
    loaded = true
    const record = await readJsonIfExists<ListRecord>(listRecordFile(name)).catch(() => undefined)
    if (!(record && typeof record.first_seen_at === 'string' && record.channels && typeof record.channels === 'object')) return
    state = { record, sent: sentFrom(record.channels) }
    const last = lastActivityMs(state)
    if (!record.resolved_at && recordOutdated(last, now, settings.remindMs)) state.record = { ...record, resolved_at: iso(last) }
  }

  async function resolve(now: number) {
    await load(now)
    if (!state || state.record.resolved_at) return
    state.record = { ...state.record, resolved_at: iso(now) }
    await persist(state)
  }

  async function open(now: number, together: boolean): Promise<ListState> {
    await load(now)
    if (state?.record.resolved_at && resumesWithin(Date.parse(state.record.resolved_at), now, settings.remindMs)) {
      const { resolved_at: _resolved, ...open } = state.record
      state.record = open
      await persist(state)
    } else if (!state || state.record.resolved_at) {
      state = { record: { first_seen_at: iso(now), channels: {} }, sent: {} }
      await persist(state)
    }
    if (together && !state.record.together) {
      state.record = { ...state.record, together: true }
      await persist(state)
    }
    return state
  }

  async function forget(site: string) {
    await load(Date.now())
    if (!state) return
    let changed = false
    for (const sent of Object.values(state.sent)) {
      if (sent?.reason === undefined) continue
      const kept = withoutSite(sent.reason, site)
      if (kept !== sent.reason) [sent.reason, changed] = [kept, true]
    }
    if (changed) await persist(state)
  }

  async function dispatch(current: ListState, entries: ListEntry[], now: number, message: (count: number) => Promise<(at: number) => OutgoingNotice>) {
    const target: NoticeTarget<string> = {
      slot: `list ${name}`,
      state: current.record.first_seen_at,
      label: name,
      current: () => state === current && !current.record.resolved_at,
      sent: async (channel, sent) => {
        current.sent[channel] = sent
        await persist(current)
      },
    }
    const due = settings.channels.flatMap((channel) => {
      if (!delivery.ready(target, channel, now)) return []
      const next = listNoticeDue({ sent: current.sent[channel], entries, now, remindMs: settings.remindMs })
      return next ? [[channel, next.count] as const] : []
    })
    for (const [channel, count] of due) void delivery.deliver(target, channel, { count, reason: entriesReason(entries) }, await message(count))
  }

  return { resolve, open, forget, dispatch }
}

async function receiverRecord(site: string): Promise<{ received_at: unknown } | 'unreadable'> {
  try {
    return { received_at: (await readJsonIfExists<{ received_at?: unknown }>(join(dataDir(), 'live', `${site}.receiver.json`)))?.received_at }
  } catch {
    return 'unreadable'
  }
}

async function expectedOf(site: SiteFile, approvals: Approvals): Promise<ExpectedScreen> {
  try {
    const bulletin = await liveBulletin(site, approvals)
    if (!bulletin) return { state: 'ambient' }
    const row = (await readLayoutIndex(site.id).catch(() => undefined))?.entries?.find((entry) => entry?.bulletin_id === bulletin)
    const level = [row?.display_level, row?.municipality_level].find((value) => typeof value === 'number')
    return { state: 'alert', bulletin_id: bulletin, ...(level === undefined ? {} : { level }) }
  } catch {
    return 'unknown'
  }
}

export function livenessWatch(settings: NotifySettings, delivery: NoticeDelivery, warn: Warn, recovered: (scope: string) => void) {
  const thresholds = [settings.receiverStoppedMs, settings.feedIdleMs].filter((ms) => ms > 0)
  if (!thresholds.length) return undefined
  const tickMs = Math.min(TICK_MAX_MS, Math.max(TICK_MIN_MS, Math.min(...thresholds, ...(settings.remindMs > 0 ? [settings.remindMs] : [])) / 4))
  watchFeedRequests(settings.feedIdleMs)
  const receivers = listNotice('receivers', settings, delivery, warn)
  const idle = listNotice('feed-idle', settings, delivery, warn)
  const generations = new Map<string, number>()
  const expected = new Map<string, { at: number; generation: number; value: ExpectedScreen }>()
  let startedMs = Date.now()
  let lastCheck: number | undefined
  let idleBefore = new Set<string>()

  async function forgetChanged(sites: SiteFile[]) {
    const now = new Map(sites.map((site) => [site.id, siteGeneration(site.id)]))
    for (const [site, generation] of generations) {
      if (now.get(site) === generation) continue
      await receivers.forget(site)
      await idle.forget(site)
      expected.delete(site)
    }
    generations.clear()
    for (const [site, generation] of now) generations.set(site, generation)
  }

  async function checkReceivers(sites: SiteFile[], now: number) {
    if (settings.receiverStoppedMs <= 0) return
    const records: { site: string; received_at: unknown }[] = []
    for (const site of sites) {
      const record = await receiverRecord(site.id)
      if (record === 'unreadable') warn(`receiver ${site.id}`, `the receiver record of ${site.id} cannot be read; the site is left out of the receiver check`)
      else records.push({ site: site.id, ...record })
    }
    const scan = stoppedReceivers(records, now, settings.receiverStoppedMs)
    for (const site of scan.unreadable) warn(`receiver ${site}`, `the last receive of ${site} is not a time; the site is left out of the receiver check`)
    for (const site of scan.future) warn(`receiver ${site}`, `the last receive of ${site} lies in the future; the site is left out of the receiver check`)
    const named = new Set([...scan.unreadable, ...scan.future])
    for (const { site } of records) if (!named.has(site)) recovered(`receiver ${site}`)
    if (!scan.stopped.length) return receivers.resolve(now)
    const current = await receivers.open(now, false)
    const byId = new Map(sites.map((site) => [site.id, site]))
    await receivers.dispatch(current, scan.stopped.map(({ site }) => ({ site })), now, async (count) => {
      const listed = await Promise.all(scan.stopped.map(async (entry) => ({ ...(await siteNoticeFacts(byId.get(entry.site)!)), received_at: entry.received_at })))
      const facts = { sites: listed, threshold_ms: settings.receiverStoppedMs, count, first_seen_at: current.record.first_seen_at, ...(settings.adminUrl ? { admin_url: settings.adminUrl } : {}) }
      return (at) => receiverStoppedMessage(facts, at)
    })
  }

  async function expectedNow(site: SiteFile, now: number, approvals: () => Promise<Approvals>): Promise<ExpectedScreen> {
    const generation = siteGeneration(site.id)
    const known = expected.get(site.id)
    if (known && known.generation === generation && now - known.at < EXPECTED_FOR_MS) return known.value
    const value = await expectedOf(site, await approvals())
    expected.set(site.id, { at: now, generation, value })
    return value
  }

  async function checkFeeds(sites: SiteFile[], now: number) {
    if (settings.feedIdleMs <= 0) return
    if (lastCheck !== undefined && now - lastCheck > PAUSED_AFTER_MS) startedMs = now
    lastCheck = now
    if (now - startedMs < settings.feedIdleMs) return
    let watched = 0
    const stopped: { site: SiteFile; lastMs: number }[] = []
    for (const site of sites) {
      const requests = await feedRequests(site.id)
      if (requests && requests.lastMs - requests.firstMs >= settings.feedIdleMs) watched++
      if (feedActivity(requests, now, settings.feedIdleMs) === 'idle') stopped.push({ site, lastMs: requests!.lastMs })
    }
    const newly = stopped.filter(({ site }) => !idleBefore.has(site.id)).length
    idleBefore = new Set(stopped.map(({ site }) => site.id))
    for (const site of expected.keys()) if (!idleBefore.has(site)) expected.delete(site)
    if (!stopped.length) return idle.resolve(now)
    const current = await idle.open(now, stoppedTogether(newly, watched))
    let approvals: Promise<Approvals> | undefined
    const read = () => (approvals ??= readApprovals())
    const listed: IdleSite[] = []
    for (const { site, lastMs } of stopped) listed.push({ ...(await siteNoticeFacts(site)), last_request_at: iso(lastMs), expected: await expectedNow(site, now, read) })
    const entries = listed.map((site) => ({ site: site.id, alert: isAlert(site.expected) }))
    await idle.dispatch(current, entries, now, async (count) => {
      const facts = { sites: listed, together: Boolean(current.record.together), threshold_ms: settings.feedIdleMs, count, first_seen_at: current.record.first_seen_at, ...(settings.adminUrl ? { admin_url: settings.adminUrl } : {}) }
      return (at) => feedIdleMessage(facts, at)
    })
  }

  async function check(now: number) {
    const sites = (await readSites()).filter((site) => !site.replay)
    await forgetChanged(sites)
    forgetFeedRequests(new Set(sites.map((site) => site.id)))
    for (const [scope, run] of [['receivers', checkReceivers], ['feeds', checkFeeds]] as const) {
      try {
        await run(sites, now)
        recovered(scope)
      } catch (error) {
        warn(scope, `${scope} check: ${(error as Error).message}`)
      }
    }
    if (settings.feedIdleMs > 0) await writeFeedRequests(now, warn, recovered)
  }

  return { tickMs, check }
}
