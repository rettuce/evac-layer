import type { OutgoingNotice } from '~~/layout/notice'
import type { ChannelSent } from '~~/layout/noticeSchedule'

const RETRY_DELAYS_MS = [2000, 5000, 15000]
const AFTER_GIVING_UP_MS = 5 * 60 * 1000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export type SentChannels<R extends string> = Partial<Record<NotifyChannel, ChannelSent<R>>>
export type StoredChannels<R extends string> = Partial<Record<NotifyChannel, { count: number; last_sent_at?: string; reason?: R }>>

export function sentFrom<R extends string>(channels: StoredChannels<R>, fallbackReason?: R): SentChannels<R> {
  const sent: SentChannels<R> = {}
  for (const [channel, stored] of Object.entries(channels) as [NotifyChannel, StoredChannels<R>[NotifyChannel]][]) {
    if (!stored) continue
    const lastSentMs = typeof stored.last_sent_at === 'string' ? Date.parse(stored.last_sent_at) : Number.NaN
    sent[channel] = { count: Number.isInteger(stored.count) && stored.count > 0 ? stored.count : 1, lastSentMs, reason: stored.reason ?? fallbackReason }
  }
  return sent
}

export function storedFrom<R extends string>(sent: SentChannels<R>): StoredChannels<R> {
  const channels: StoredChannels<R> = {}
  for (const [channel, one] of Object.entries(sent) as [NotifyChannel, ChannelSent<R>][]) {
    channels[channel] = { count: one.count, ...(Number.isFinite(one.lastSentMs) ? { last_sent_at: new Date(one.lastSentMs!).toISOString() } : {}), ...(one.reason ? { reason: one.reason } : {}) }
  }
  return channels
}

export interface NoticeTarget<R extends string> {
  // One notice at a time per slot and channel; a send that gave up pauses the slot for that state only.
  slot: string
  state: string
  label: string
  current: () => boolean
  sent: (channel: NotifyChannel, sent: ChannelSent<R>) => Promise<void>
}

export function noticeDelivery(settings: NotifySettings) {
  const sending = new Set<string>()
  const pausedUntil = new Map<string, number>()

  function ready(target: { slot: string; state: string }, channel: NotifyChannel, now: number): boolean {
    const slot = `${target.slot}\n${channel}`
    return !sending.has(slot) && (pausedUntil.get(`${slot}\n${target.state}`) ?? 0) <= now
  }

  function sweep(now: number) {
    for (const [slot, until] of pausedUntil) if (until <= now) pausedUntil.delete(slot)
  }

  async function deliver<R extends string>(target: NoticeTarget<R>, channel: NotifyChannel, due: { count: number; reason: R | undefined }, message: (now: number) => OutgoingNotice) {
    const slot = `${target.slot}\n${channel}`
    sending.add(slot)
    try {
      let lastFailure = ''
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        if (!target.current()) return
        try {
          await sendNotice(settings, channel, message(Date.now()))
          lastFailure = ''
        } catch (error) {
          lastFailure = failureCode(error)
        }
        if (!lastFailure) {
          if (target.current()) await target.sent(channel, { count: due.count, lastSentMs: Date.now(), reason: due.reason })
          return
        }
        if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]!)
      }
      pausedUntil.set(`${slot}\n${target.state}`, Date.now() + AFTER_GIVING_UP_MS)
      console.warn(`[notify] ${channel} notice for ${target.label} not sent after ${RETRY_DELAYS_MS.length + 1} attempts: ${lastFailure}`)
    } finally {
      sending.delete(slot)
    }
  }

  return { ready, sweep, deliver }
}

export type NoticeDelivery = ReturnType<typeof noticeDelivery>
