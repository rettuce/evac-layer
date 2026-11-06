import { createHash } from 'node:crypto'

export interface LayoutApproval {
  approved: boolean
  updated_at: string
  digest?: string
}

export interface Approvals {
  version: '0.1'
  layouts: Record<string, LayoutApproval>
  sites: Record<string, { auto_publish: boolean; updated_at: string }>
}

// An approval is bound to the bytes that were approved: the shape files of the bulletin. A regenerated layout
// gets a new digest and falls back to unapproved until an operator looks at it again.
export function layoutDigest(files: { shape: string; body: string }[]): string {
  const hash = createHash('sha256')
  for (const file of [...files].sort((a, b) => a.shape.localeCompare(b.shape))) hash.update(`${file.shape}\n${file.body}\n`)
  return `sha256:${hash.digest('hex')}`
}

export function approvalState(record: LayoutApproval | undefined, digest: string | undefined): { approved: boolean; stale: boolean } {
  if (!record?.approved) return { approved: false, stale: false }
  const stale = digest !== undefined && record.digest !== digest
  return { approved: !stale, stale }
}

export function layoutKey(site: string, bulletinId: string): string {
  return `${site}/${bulletinId}`
}

export type LiveLayoutGate = 'ok' | 'auto-publish-off' | 'unapproved' | 'stale'

// Screens only ever show layouts an operator approved, and only at sites with auto publish on. With the current
// digest of the layout files, the approval must also be for these very files.
export function liveLayoutGate(approvals: Approvals, site: string, bulletinId: string, digest?: string): LiveLayoutGate {
  if (!approvals.sites[site]?.auto_publish) return 'auto-publish-off'
  const state = approvalState(approvals.layouts[layoutKey(site, bulletinId)], digest)
  if (state.stale) return 'stale'
  if (!state.approved) return 'unapproved'
  return 'ok'
}
