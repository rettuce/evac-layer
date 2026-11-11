import { join } from 'node:path'
import { feedActivity, receiversNoticeDue, stoppedReceivers } from '~~/layout/liveness'
import { type ExpectedScreen, type ExpectedState, expectedState, feedIdleMessage, receiverStoppedMessage } from '~~/layout/livenessNotice'
import { noticeDue } from '~~/layout/noticeSchedule'
import { type NoticeDelivery, type NoticeTarget, type SentChannels, type StoredChannels, sentFrom, storedFrom } from './noticeDelivery'

type Warn = (scope: string, message: string) => void

const iso = (ms: number) => new Date(ms).toISOString()

interface ReceiversRecord {
  first_seen_at: string
  resolved_at?: string
  channels: StoredChannels<string>
}

// Not under a site id: one notice covers every site whose receiver stopped. A directory name holds no dot, so it never
// meets a file of a site.
export function receiversRecordFile(): string {
  return join(dataDir(), 'live', 'notify', 'receivers.json')
}

async function receivedAtOf(site: string): Promise<unknown> {
  const state = await readJsonIfExists<{ received_at?: unknown }>(join(dataDir(), 'live', `${site}.receiver.json`)).catch(() => undefined)
  return state?.received_at
}

export function receiverWatch(settings: NotifySettings, delivery: NoticeDelivery, warn: Warn) {
  let notice: { record: ReceiversRecord; sent: SentChannels<string> } | undefined
  let loaded = false

  async function persist(current: NonNullable<typeof notice>) {
    try {
      await writeJsonFile(receiversRecordFile(), { ...current.record, channels: storedFrom(current.sent) })
    } catch (error) {
      warn('record receivers', `notice record of stopped receivers not recorded: ${failureCode(error)}`)
    }
  }

  async function load() {
    if (loaded) return
    loaded = true
    const record = await readJsonIfExists<ReceiversRecord>(receiversRecordFile()).catch(() => undefined)
    if (record && typeof record.first_seen_at === 'string' && record.channels && typeof record.channels === 'object') notice = { record, sent: sentFrom(record.channels) }
  }

  return async function check(sites: SiteFile[], now: number) {
    if (settings.receiverStoppedMs <= 0) return
    const watched = sites.filter((site) => !site.replay)
    const records = await Promise.all(watched.map(async (site) => ({ site: site.id, received_at: await receivedAtOf(site.id) })))
    const stopped = stoppedReceivers(records, now, settings.receiverStoppedMs)
    await load()
    if (!stopped.length) {
      if (notice && !notice.record.resolved_at) {
        notice.record = { ...notice.record, resolved_at: iso(now) }
        await persist(notice)
      }
      return
    }
    if (!notice || notice.record.resolved_at) {
      notice = { record: { first_seen_at: iso(now), channels: {} }, sent: {} }
      await persist(notice)
    }
    const current = notice
    const ids = stopped.map((entry) => entry.site)
    const target: NoticeTarget<string> = {
      slot: 'receivers',
      state: current.record.first_seen_at,
      label: 'stopped receivers',
      current: () => notice === current && !current.record.resolved_at,
      sent: async (channel, sent) => {
        current.sent[channel] = sent
        await persist(current)
      },
    }
    const due = settings.channels.flatMap((channel) => {
      if (!delivery.ready(target, channel, now)) return []
      const next = receiversNoticeDue({ sent: current.sent[channel], sites: ids, now, remindMs: settings.remindMs })
      return next ? [[channel, next] as const] : []
    })
    if (!due.length) return
    const byId = new Map(watched.map((site) => [site.id, site]))
    const listed = await Promise.all(stopped.map(async (entry) => ({ ...(await siteNoticeFacts(byId.get(entry.site)!)), received_at: entry.received_at })))
    const facts = { sites: listed, threshold_minutes: settings.receiverStoppedMs / 60000, first_seen_at: current.record.first_seen_at, ...(settings.adminUrl ? { admin_url: settings.adminUrl } : {}) }
    for (const [channel, next] of due) {
      void delivery.deliver(target, channel, { count: next.count, reason: ids.join(' ') }, (at) => receiverStoppedMessage({ ...facts, count: next.count }, at))
    }
  }
}

interface IdleRecord {
  site_id: string
  last_request_at: string
  first_seen_at: string
  resolved_at?: string
  channels: StoredChannels<ExpectedState>
}

interface IdleNotice {
  generation: number
  record: IdleRecord
  sent: SentChannels<ExpectedState>
}

export function feedIdleRecordFile(site: string): string {
  return join(dataDir(), 'live', `${site}.feed-idle.json`)
}

async function expectedOf(site: string): Promise<ExpectedScreen | undefined> {
  try {
    const feed = await currentFeed(site)
    if (!feed) return undefined
    if (feed.state === 'ambient' || !feed.alert) return { state: 'ambient' }
    return { state: 'alert', bulletin_id: feed.alert.bulletin_id, level: feed.alert.level, hazard: feed.alert.hazard }
  } catch {
    return 'unknown'
  }
}

export function feedIdleWatch(settings: NotifySettings, delivery: NoticeDelivery, warn: Warn, startedMs: number) {
  const notices = new Map<string, IdleNotice>()

  async function persist(site: string, notice: IdleNotice): Promise<boolean> {
    try {
      return await writeSiteRecord(site, notice.generation, feedIdleRecordFile(site), { ...notice.record, channels: storedFrom(notice.sent) })
    } catch (error) {
      warn(`record feed ${site}`, `feed idle record of ${site} not recorded: ${failureCode(error)}`)
      return true
    }
  }

  async function noticeOf(site: string, generation: number): Promise<IdleNotice | undefined> {
    const known = notices.get(site)
    if (known?.generation === generation) return known
    const record = await readJsonIfExists<IdleRecord>(feedIdleRecordFile(site)).catch(() => undefined)
    if (!(record?.site_id === site && typeof record.last_request_at === 'string' && typeof record.first_seen_at === 'string' && record.channels)) return undefined
    const loaded: IdleNotice = { generation, record, sent: sentFrom(record.channels) }
    notices.set(site, loaded)
    return loaded
  }

  async function check(site: SiteFile, now: number) {
    if (settings.feedIdleMs <= 0 || site.replay) return
    const generation = siteGeneration(site.id)
    const lastMs = await lastFeedRequest(site.id)
    const activity = feedActivity({ lastSeenMs: lastMs, startedMs, now, thresholdMs: settings.feedIdleMs })
    if (activity === undefined || activity === 'unsure') return
    let notice = await noticeOf(site.id, generation)
    if (activity === 'active') {
      if (notice && !notice.record.resolved_at) {
        notice.record = { ...notice.record, resolved_at: iso(now) }
        if (!(await persist(site.id, notice))) notices.delete(site.id)
      }
      return
    }
    const lastRequestAt = iso(lastMs!)
    if (!notice || notice.record.last_request_at !== lastRequestAt || notice.record.resolved_at) {
      notice = { generation, record: { site_id: site.id, last_request_at: lastRequestAt, first_seen_at: iso(now), channels: {} }, sent: {} }
      notices.set(site.id, notice)
      if (!(await persist(site.id, notice))) return void notices.delete(site.id)
    }
    const current = notice
    const target: NoticeTarget<ExpectedState> = {
      slot: `feed ${site.id}`,
      state: lastRequestAt,
      label: `idle feed of ${site.id}`,
      current: () => notices.get(site.id) === current && siteGeneration(site.id) === current.generation && !current.record.resolved_at,
      sent: async (channel, sent) => {
        current.sent[channel] = sent
        await persist(site.id, current)
      },
    }
    const channels = settings.channels.filter((channel) => delivery.ready(target, channel, now))
    if (!channels.length) return
    const expected = await expectedOf(site.id)
    if (!expected) return
    const reason = expectedState(expected)
    const due = channels.flatMap((channel) => {
      const next = noticeDue({ sent: current.sent[channel], reason, now, remindMs: settings.remindMs })
      return next ? [[channel, next] as const] : []
    })
    if (!due.length) return
    const facts = { site: await siteNoticeFacts(site), last_request_at: lastRequestAt, expected, first_seen_at: current.record.first_seen_at, ...(settings.adminUrl ? { admin_url: settings.adminUrl } : {}) }
    for (const [channel, next] of due) {
      const message = { ...facts, count: next.count, ...(next.previous_reason ? { previous_expected: next.previous_reason } : {}) }
      void delivery.deliver(target, channel, { count: next.count, reason }, (at) => feedIdleMessage(message, at))
    }
  }

  function forget(present: Set<string>) {
    for (const site of notices.keys()) if (!present.has(site)) notices.delete(site)
  }

  return { check, forget }
}
