import { type Approvals, type LayoutClass, approvalWith, bulletinStatus, classApprovable, isSyntheticBulletinId, liveLayoutGateWith } from './gate.ts'
import type { LiveState } from './liveState'
import type { ReplayRow } from './replay'

export type PendingReason = 'unapproved' | 'changed-after-approval' | 'auto-publish-off' | 'screens-missing' | 'screens-unreadable' | 'check-failed'

// A record composed from old feeds (fanout, pipeline) also leaves rows that did not pass; only a bulletin of the last
// day can be one the receiver has just failed to put on screen.
export const CHECK_FAILED_WINDOW_MS = 24 * 60 * 60 * 1000

export type IndexRow = ReplayRow & { outcome?: string }

export interface PendingSubject {
  bulletin_id: string
  failed?: IndexRow
}

export type ScreensRead = { kind: 'read'; digest: string; cls: LayoutClass } | { kind: 'missing' } | { kind: 'unreadable' }

const isReal = (row: IndexRow) => !row.synthetic && !isSyntheticBulletinId(row.bulletin_id) && bulletinStatus(undefined, row.status) === 'normal'

// The receiver puts on the live state only a bulletin whose screens passed; one composed after it that did not pass is
// in the index alone, and the site keeps showing an older bulletin or nothing.
function failedAfterLive(rows: IndexRow[], live: LiveState | undefined, now: number): IndexRow | undefined {
  const liveId = live?.bulletin_id
  const shownIssuedAt = liveId ? Date.parse(rows.find((row) => row.bulletin_id === liveId)?.issued_at ?? live!.updated_at) : -Infinity
  let newest: IndexRow | undefined
  for (const row of rows) {
    const issued = Date.parse(row.issued_at)
    if (row.template === undefined || row.screen === true || !isReal(row)) continue
    if (!(issued > shownIssuedAt) || now - issued > CHECK_FAILED_WINDOW_MS) continue
    if (!newest || issued > Date.parse(newest.issued_at)) newest = row
  }
  return newest
}

export function pendingSubject({ replay, live, rows, now }: { replay: boolean; live: LiveState | undefined; rows: IndexRow[]; now: number }): PendingSubject | undefined {
  if (replay) return undefined
  const failed = failedAfterLive(rows, live, now)
  if (failed) return { bulletin_id: failed.bulletin_id, failed }
  const id = live?.bulletin_id
  return id && !isSyntheticBulletinId(id) ? { bulletin_id: id } : undefined
}

export function pendingReason({ approvals, site, subject, screens, rowStatus }: {
  approvals: Approvals; site: string; subject: PendingSubject; screens: ScreensRead; rowStatus?: string
}): PendingReason | undefined {
  if (subject.failed) return 'check-failed'
  if (bulletinStatus(undefined, rowStatus) !== 'normal') return undefined
  if (screens.kind === 'unreadable') return 'screens-unreadable'
  if (screens.kind === 'missing') return 'screens-missing'
  if (!classApprovable(screens.cls.key)) return undefined
  const { gate } = liveLayoutGateWith(approvals, site, subject.bulletin_id, screens.digest, screens.cls)
  if (gate === 'ok' || gate === 'synthetic') return undefined
  if (gate === 'unapproved') return 'unapproved'
  if (gate === 'stale') return 'changed-after-approval'
  const approval = approvalWith(approvals, site, subject.bulletin_id, screens.digest, screens.cls)
  return approval.approved ? 'auto-publish-off' : approval.stale ? 'changed-after-approval' : 'unapproved'
}
