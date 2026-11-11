import type { PendingReason } from './pending'

// A reason that changes back and forth (an approval given and taken back) must not become a stream of notices.
export const REASON_CHANGE_MIN_MS = 60 * 1000

export interface ChannelSent<R extends string = PendingReason> {
  count: number
  lastSentMs: number | undefined
  reason: R | undefined
}

export interface DueNotice<R extends string = PendingReason> {
  count: number
  previous_reason?: R
}

export function msSince(last: number | undefined, now: number): number {
  return last !== undefined && Number.isFinite(last) && last <= now ? now - last : Infinity
}

export function noticeDue<R extends string = PendingReason>({ sent, reason, now, remindMs }: { sent: ChannelSent<R> | undefined; reason: R; now: number; remindMs: number }): DueNotice<R> | undefined {
  if (!sent) return { count: 1 }
  const since = msSince(sent.lastSentMs, now)
  if (sent.reason !== undefined && sent.reason !== reason && since >= REASON_CHANGE_MIN_MS) return { count: sent.count + 1, previous_reason: sent.reason }
  if (remindMs > 0 && since >= remindMs) return { count: sent.count + 1 }
  return undefined
}
