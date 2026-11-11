import type { Approvals } from '~~/layout/gate'
import type { NoticeFacts } from '~~/layout/notice'

const WATCH_INTERVAL_MS = 2000
const RETRY_DELAYS_MS = [2000, 5000, 15000]
const AFTER_GIVING_UP_MS = 5 * 60 * 1000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export default defineNitroPlugin((nitroApp) => {
  if (import.meta.prerender) return
  const settings = notifySettings()
  for (const warning of settings.warnings) console.warn(`[notify] ${warning}`)
  console.log(`[notify] channels: ${settings.channels.join(', ') || 'none'}`)
  if (!settings.channels.length) return

  const pendingKeyOf = new Map<string, string>()
  const sending = new Set<string>()
  const pausedUntil = new Map<string, number>()
  const warned = new Set<string>()
  let watching = false

  function warnOnce(message: string) {
    if (warned.has(message)) return
    warned.add(message)
    console.warn(`[notify] ${message}`)
  }

  async function deliver(site: string, generation: number, key: string, channel: NotifyChannel, facts: NoticeFacts) {
    const slot = `${site}\n${channel}`
    sending.add(slot)
    try {
      let lastFailure = ''
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        if (pendingKeyOf.get(site) !== key) return
        try {
          await sendNotice(settings, channel, facts, Date.now())
          lastFailure = ''
        } catch (error) {
          lastFailure = failureCode(error)
        }
        if (!lastFailure) {
          const sentAt = new Date().toISOString()
          await changeNotifyRecord(site, generation, (record) =>
            record && noticeKey(record.bulletin_id, record.digest) === key ? { ...record, channels: { ...record.channels, [channel]: { count: facts.count, last_sent_at: sentAt } } } : undefined,
          ).catch((error: Error) => console.warn(`[notify] ${channel} notice for ${site} sent but not recorded: ${error.message}`))
          return
        }
        if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]!)
      }
      pausedUntil.set(`${slot}\n${key}`, Date.now() + AFTER_GIVING_UP_MS)
      console.warn(`[notify] ${channel} notice for ${site} ${facts.bulletin.id} not sent after ${RETRY_DELAYS_MS.length + 1} attempts: ${lastFailure}`)
    } finally {
      sending.delete(slot)
    }
  }

  function forget(site: string) {
    pendingKeyOf.delete(site)
    for (const slot of pausedUntil.keys()) if (slot.startsWith(`${site}\n`)) pausedUntil.delete(slot)
  }

  async function checkSite(site: SiteFile, approvals: Approvals, now: number) {
    const generation = siteGeneration(site.id)
    const pending = await findPending(site, approvals, now, settings.adminUrl)
    if (!pending) {
      forget(site.id)
      const record = await readNotifyRecord(site.id)
      if (record && !record.resolved_at) {
        await changeNotifyRecord(site.id, generation, (stored) => (stored && !stored.resolved_at ? { ...stored, resolved_at: new Date(now).toISOString() } : undefined))
      }
      return
    }
    const key = noticeKey(pending.bulletin_id, pending.digest)
    pendingKeyOf.set(site.id, key)
    let record = await readNotifyRecord(site.id)
    if (!record || noticeKey(record.bulletin_id, record.digest) !== key || record.resolved_at || record.reason !== pending.reason) {
      record = await changeNotifyRecord(site.id, generation, (stored) => {
        if (stored && noticeKey(stored.bulletin_id, stored.digest) === key) {
          const { resolved_at: _resolved, ...open } = stored
          return { ...open, reason: pending.reason }
        }
        return { site_id: site.id, bulletin_id: pending.bulletin_id, digest: pending.digest, reason: pending.reason, first_seen_at: new Date(now).toISOString(), channels: {} }
      })
      if (!record) return
    }
    for (const channel of settings.channels) {
      const slot = `${site.id}\n${channel}`
      if (sending.has(slot) || (pausedUntil.get(`${slot}\n${key}`) ?? 0) > now) continue
      const sent = record.channels[channel]
      const due = !sent || (settings.remindMs > 0 && now - Date.parse(sent.last_sent_at) >= settings.remindMs)
      if (due) void deliver(site.id, generation, key, channel, { ...pending.facts, count: (sent?.count ?? 0) + 1, first_seen_at: record.first_seen_at })
    }
  }

  async function watch() {
    if (watching) return
    watching = true
    try {
      const now = Date.now()
      const approvals = await readApprovals()
      const sites = await readSites()
      const present = new Set(sites.map((site) => site.id))
      for (const site of pendingKeyOf.keys()) if (!present.has(site)) forget(site)
      for (const site of sites) await checkSite(site, approvals, now).catch((error: Error) => warnOnce(`${site.id}: ${error.message}`))
    } catch (error) {
      warnOnce(`watch failed: ${(error as Error).message}`)
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
