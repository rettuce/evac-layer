import type { Approvals } from '~~/layout/gate'
import type { NoticeFacts } from '~~/layout/notice'
import { type ChannelSent, noticeDue } from '~~/layout/noticeSchedule'
import type { PendingReason } from '~~/layout/pending'

const WATCH_INTERVAL_MS = 2000
const SITES_AT_ONCE = 8
const RETRY_DELAYS_MS = [2000, 5000, 15000]
const AFTER_GIVING_UP_MS = 5 * 60 * 1000
const SAME_WARNING_EVERY_MS = 10 * 60 * 1000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// What this process knows was sent. The disk record only seeds it after a start, so a record that cannot be written
// never makes a notice go out again.
interface Notice {
  generation: number
  key: string
  record: NotifyRecord
  sent: Partial<Record<NotifyChannel, ChannelSent>>
}

const keyOf = (bulletin: string, digest: string) => `${bulletin}\n${digest}`

function sentFrom(record: NotifyRecord): Notice['sent'] {
  const sent: Notice['sent'] = {}
  for (const [channel, stored] of Object.entries(record.channels) as [NotifyChannel, NotifyRecord['channels'][NotifyChannel]][]) {
    if (!stored) continue
    const lastSentMs = typeof stored.last_sent_at === 'string' ? Date.parse(stored.last_sent_at) : Number.NaN
    sent[channel] = { count: Number.isInteger(stored.count) && stored.count > 0 ? stored.count : 1, lastSentMs, reason: stored.reason ?? record.reason }
  }
  return sent
}

function recordOf(notice: Notice): NotifyRecord {
  const channels: NotifyRecord['channels'] = {}
  for (const [channel, sent] of Object.entries(notice.sent) as [NotifyChannel, ChannelSent][]) {
    channels[channel] = { count: sent.count, ...(Number.isFinite(sent.lastSentMs) ? { last_sent_at: new Date(sent.lastSentMs!).toISOString() } : {}), ...(sent.reason ? { reason: sent.reason } : {}) }
  }
  return { ...notice.record, channels }
}

async function eachAtMost<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) await task(items[next++]!)
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

export default defineNitroPlugin((nitroApp) => {
  if (import.meta.prerender) return
  const settings = notifySettings()
  for (const warning of settings.warnings) console.warn(`[notify] ${warning}`)
  console.log(`[notify] channels: ${settings.channels.join(', ') || 'none'}`)
  if (!settings.channels.length) return

  const notices = new Map<string, Notice>()
  const sending = new Set<string>()
  const pausedUntil = new Map<string, number>()
  const warnedAt = new Map<string, number>()
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

  async function persist(site: string, notice: Notice): Promise<boolean> {
    try {
      const written = await writeNotifyRecord(site, notice.generation, recordOf(notice))
      if (written) recovered(`record ${site}`)
      return written
    } catch (error) {
      warn(`record ${site}`, `notice record of ${site} not recorded: ${failureCode(error)}`)
      return true
    }
  }

  function stillPending(site: string, notice: Notice): boolean {
    return notices.get(site) === notice && siteGeneration(site) === notice.generation && !notice.record.resolved_at
  }

  async function deliver(site: string, notice: Notice, channel: NotifyChannel, facts: NoticeFacts) {
    const slot = `${site}\n${channel}`
    sending.add(slot)
    try {
      let lastFailure = ''
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        if (!stillPending(site, notice)) return
        try {
          await sendNotice(settings, channel, facts, Date.now())
          lastFailure = ''
        } catch (error) {
          lastFailure = failureCode(error)
        }
        if (!lastFailure) {
          if (stillPending(site, notice)) {
            notice.sent[channel] = { count: facts.count, lastSentMs: Date.now(), reason: facts.reason }
            await persist(site, notice)
          }
          return
        }
        if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]!)
      }
      pausedUntil.set(`${slot}\n${notice.key}`, Date.now() + AFTER_GIVING_UP_MS)
      console.warn(`[notify] ${channel} notice for ${site} ${facts.bulletin.id} not sent after ${RETRY_DELAYS_MS.length + 1} attempts: ${lastFailure}`)
    } finally {
      sending.delete(slot)
    }
  }

  async function noticeOf(site: string, generation: number): Promise<Notice | undefined> {
    const known = notices.get(site)
    if (known?.generation === generation) return known
    const record = await readNotifyRecord(site)
    if (!record) return undefined
    const loaded: Notice = { generation, key: keyOf(record.bulletin_id, record.digest), record, sent: sentFrom(record) }
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
    const due: [NotifyChannel, { count: number; previous_reason?: PendingReason }][] = []
    for (const channel of settings.channels) {
      const slot = `${site.id}\n${channel}`
      if (sending.has(slot) || (pausedUntil.get(`${slot}\n${key}`) ?? 0) > now) continue
      const next = noticeDue({ sent: notice.sent[channel], reason: pending.reason, now, remindMs: settings.remindMs })
      if (next) due.push([channel, next])
    }
    if (!due.length) return
    const showing = await showingNow(site, approvals, pending.rows)
    for (const [channel, next] of due) {
      void deliver(site.id, notice, channel, { ...pending.facts, showing, count: next.count, first_seen_at: notice.record.first_seen_at, ...(next.previous_reason ? { previous_reason: next.previous_reason } : {}) })
    }
  }

  async function watch() {
    if (watching) return
    watching = true
    try {
      const now = Date.now()
      for (const [slot, until] of pausedUntil) if (until <= now) pausedUntil.delete(slot)
      const approvals = await readApprovals()
      const sites = await readSites()
      const present = new Set(sites.map((site) => site.id))
      for (const site of notices.keys()) if (!present.has(site)) notices.delete(site)
      await eachAtMost(sites, SITES_AT_ONCE, async (site) => {
        try {
          await checkSite(site, approvals, now)
          recovered(site.id)
        } catch (error) {
          warn(site.id, `${site.id}: ${(error as Error).message}`)
        }
      })
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
