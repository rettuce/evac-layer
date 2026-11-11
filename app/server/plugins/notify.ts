import type { Approvals } from '~~/layout/gate'
import { pendingMessage } from '~~/layout/notice'
import { noticeDue } from '~~/layout/noticeSchedule'
import type { PendingReason } from '~~/layout/pending'
import { type NoticeTarget, type SentChannels, sentFrom, storedFrom } from '../utils/noticeDelivery'

const WATCH_INTERVAL_MS = 2000
const SITES_AT_ONCE = 8
const SAME_WARNING_EVERY_MS = 10 * 60 * 1000

// What this process knows was sent. The disk record only seeds it after a start, so a record that cannot be written
// never makes a notice go out again.
interface Notice {
  generation: number
  key: string
  record: NotifyRecord
  sent: SentChannels<PendingReason>
}

const keyOf = (bulletin: string, digest: string) => `${bulletin}\n${digest}`

async function eachAtMost<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) await task(items[next++]!)
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

export default defineNitroPlugin((nitroApp) => {
  if (import.meta.prerender) return
  const startedMs = Date.now()
  const settings = notifySettings()
  for (const warning of settings.warnings) console.warn(`[notify] ${warning}`)
  console.log(`[notify] channels: ${settings.channels.join(', ') || 'none'}`)
  if (!settings.channels.length) return

  const notices = new Map<string, Notice>()
  const warnedAt = new Map<string, number>()
  const delivery = noticeDelivery(settings)
  let watching = false

  function warn(scope: string, message: string) {
    const key = `${scope}\n${message}`
    const now = Date.now()
    if (now - (warnedAt.get(key) ?? -Infinity) < SAME_WARNING_EVERY_MS) return
    warnedAt.set(key, now)
    console.warn(`[notify] ${message}`)
  }

  function recovered(scope: string) {
    for (const key of warnedAt.keys()) if (key.startsWith(`${scope}\n`)) warnedAt.delete(key)
  }

  const checkReceivers = receiverWatch(settings, delivery, warn)
  const feedIdle = feedIdleWatch(settings, delivery, warn, startedMs)

  async function persist(site: string, notice: Notice): Promise<boolean> {
    try {
      const written = await writeNotifyRecord(site, notice.generation, { ...notice.record, channels: storedFrom(notice.sent) })
      if (written) recovered(`record ${site}`)
      return written
    } catch (error) {
      warn(`record ${site}`, `notice record of ${site} not recorded: ${failureCode(error)}`)
      return true
    }
  }

  async function noticeOf(site: string, generation: number): Promise<Notice | undefined> {
    const known = notices.get(site)
    if (known?.generation === generation) return known
    const record = await readNotifyRecord(site)
    if (!record) return undefined
    const loaded: Notice = { generation, key: keyOf(record.bulletin_id, record.digest), record, sent: sentFrom(record.channels, record.reason) }
    notices.set(site, loaded)
    return loaded
  }

  async function checkSite(site: SiteFile, approvals: Approvals, now: number) {
    const generation = siteGeneration(site.id)
    const pending = await findPending(site, approvals, now, settings.adminUrl)
    let notice = await noticeOf(site.id, generation)
    if (!pending) {
      if (notice && !notice.record.resolved_at) {
        notice.record = { ...notice.record, resolved_at: new Date(now).toISOString() }
        if (!(await persist(site.id, notice))) notices.delete(site.id)
      }
      return
    }
    const key = keyOf(pending.bulletin_id, pending.digest)
    if (!notice || notice.key !== key || notice.record.resolved_at) {
      notice = {
        generation,
        key,
        record: { site_id: site.id, bulletin_id: pending.bulletin_id, digest: pending.digest, reason: pending.reason, first_seen_at: new Date(now).toISOString(), channels: {} },
        sent: {},
      }
      notices.set(site.id, notice)
      if (!(await persist(site.id, notice))) return void notices.delete(site.id)
    } else if (notice.record.reason !== pending.reason) {
      notice.record = { ...notice.record, reason: pending.reason }
      await persist(site.id, notice)
    }
    const current = notice
    const target: NoticeTarget<PendingReason> = {
      slot: `pending ${site.id}`,
      state: key,
      label: `${site.id} ${pending.bulletin_id}`,
      current: () => notices.get(site.id) === current && siteGeneration(site.id) === current.generation && !current.record.resolved_at,
      sent: async (channel, sent) => {
        current.sent[channel] = sent
        await persist(site.id, current)
      },
    }
    const due = settings.channels.flatMap((channel) => {
      if (!delivery.ready(target, channel, now)) return []
      const next = noticeDue({ sent: current.sent[channel], reason: pending.reason, now, remindMs: settings.remindMs })
      return next ? [[channel, next] as const] : []
    })
    if (!due.length) return
    const showing = await showingNow(site, approvals, pending.rows)
    for (const [channel, next] of due) {
      const facts = { ...pending.facts, showing, count: next.count, first_seen_at: current.record.first_seen_at, ...(next.previous_reason ? { previous_reason: next.previous_reason } : {}) }
      void delivery.deliver(target, channel, { count: next.count, reason: pending.reason }, (at) => pendingMessage(facts, at))
    }
  }

  async function watch() {
    if (watching) return
    watching = true
    try {
      const now = Date.now()
      delivery.sweep(now)
      const approvals = await readApprovals()
      const sites = await readSites()
      const present = new Set(sites.map((site) => site.id))
      for (const site of notices.keys()) if (!present.has(site)) notices.delete(site)
      feedIdle.forget(present)
      forgetFeedRequests(present)
      await eachAtMost(sites, SITES_AT_ONCE, async (site) => {
        try {
          await checkSite(site, approvals, now)
          recovered(site.id)
        } catch (error) {
          warn(site.id, `${site.id}: ${(error as Error).message}`)
        }
        try {
          await feedIdle.check(site, now)
          recovered(`feed ${site.id}`)
        } catch (error) {
          warn(`feed ${site.id}`, `feed idle check of ${site.id}: ${(error as Error).message}`)
        }
      })
      try {
        await checkReceivers(sites, now)
        recovered('receivers')
      } catch (error) {
        warn('receivers', `receiver check: ${(error as Error).message}`)
      }
      if (settings.feedIdleMs > 0) await writeFeedRequests(warn, recovered)
      recovered('watch')
    } catch (error) {
      warn('watch', `watch failed: ${(error as Error).message}`)
    } finally {
      watching = false
    }
  }

  const timer = setInterval(watch, WATCH_INTERVAL_MS)
  nitroApp.hooks.hook('close', () => {
    clearInterval(timer)
    closeNotifyMail()
  })
})
