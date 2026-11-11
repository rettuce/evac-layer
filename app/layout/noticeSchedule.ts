import type { PendingReason } from './pending'

// A reason that changes back and forth (an approval given and taken back) must not become a stream of notices.
export const REASON_CHANGE_MIN_MS = 60 * 1000

export interface ChannelSent {
  count: number
  lastSentMs: number | undefined
  reason: PendingReason | undefined
}

export interface DueNotice {
  count: number
  previous_reason?: PendingReason
}

export function noticeDue({ sent, reason, now, remindMs }: { sent: ChannelSent | undefined; reason: PendingReason; now: number; remindMs: number }): DueNotice | undefined {
  if (!sent) return { count: 1 }
  const last = sent.lastSentMs
  const since = last !== undefined && Number.isFinite(last) && last <= now ? now - last : Infinity
  if (sent.reason !== undefined && sent.reason !== reason && since >= REASON_CHANGE_MIN_MS) return { count: sent.count + 1, previous_reason: sent.reason }
  if (remindMs > 0 && since >= remindMs) return { count: sent.count + 1 }
  return undefined
}
