import { createHash } from 'node:crypto'

export interface LayoutApproval {
  approved: boolean
  updated_at: string
  digest?: string
}

export interface ClassApproval {
  approved: boolean
  updated_at: string
  digest: string
  approved_from: string
}

export interface Approvals {
  version: '0.1'
  layouts: Record<string, LayoutApproval>
  sites: Record<string, { auto_publish: boolean; updated_at: string }>
  classes?: Record<string, ClassApproval>
}

// An approval is bound to the bytes that were approved: the shape files of the bulletin. A regenerated layout
// gets a new digest and falls back to unapproved until an operator looks at it again.
export function layoutDigest(files: { shape: string; body: string }[]): string {
  const hash = createHash('sha256')
  for (const file of [...files].sort((a, b) => a.shape.localeCompare(b.shape))) hash.update(`${file.shape}\n${file.body}\n`)
  return `sha256:${hash.digest('hex')}`
}

interface ClassedLayout {
  template?: string
  alert?: { hazard?: string; level?: number | null; bulletin_id?: string; issued_at?: string }
  cells?: { role?: string; text?: Record<string, unknown> }[]
  sources?: { type?: string; bulletin_id?: string }[]
}

export function screenClass(layout: ClassedLayout): string {
  return `${layout.alert?.hazard}/${layout.template}/${layout.alert?.level ?? '-'}`
}

// The JMA warning name (headline ja) and the source line follow the bulletin; the Writer's translations of the
// headline do not, so a changed translation is a changed screen.
function withoutBulletinText({ text, ...cell }: NonNullable<ClassedLayout['cells']>[number]): NonNullable<ClassedLayout['cells']>[number] {
  if (cell.role === 'source') return cell
  if (cell.role === 'headline' && text) {
    const { ja: _ja, ...translations } = text
    return { ...cell, text: translations }
  }
  return { ...cell, text }
}

function withoutBulletin(layout: ClassedLayout): ClassedLayout {
  const { bulletin_id: _id, issued_at: _at, ...alert } = layout.alert ?? {}
  return {
    ...layout,
    ...(layout.alert ? { alert } : {}),
    ...(layout.cells ? { cells: layout.cells.map(withoutBulletinText) } : {}),
    ...(layout.sources ? { sources: layout.sources.map(({ bulletin_id, ...source }) => (source.type === 'jma' ? source : { ...source, bulletin_id })) } : {}),
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

// A class approval covers every bulletin of the same kind at the site: the approved wording and arrangement,
// with only the JMA warning name, the source line, the issue time and the bulletin id free to change.
export function classDigest(files: { shape: string; body: string }[]): string {
  return layoutDigest(files.map((file) => ({ shape: file.shape, body: canonicalJson(withoutBulletin(JSON.parse(file.body) as ClassedLayout)) })))
}

export function classKey(site: string, cls: string): string {
  return `${site}/${cls}`
}

// Revoking a bulletin revokes every class approved from it, whatever its layout files say now, and the class of
// its current files.
export function revokeClasses(classes: Record<string, ClassApproval>, site: string, bulletinId: string, currentClassKey: string | undefined, at: string): Record<string, ClassApproval> {
  return Object.fromEntries(Object.entries(classes).map(([key, record]) => {
    const fromBulletin = key.startsWith(`${site}/`) && record.approved_from === bulletinId
    const current = currentClassKey !== undefined && key === classKey(site, currentClassKey)
    return [key, (fromBulletin || current) && record.approved ? { ...record, approved: false, updated_at: at } : record]
  }))
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
export type ApprovedBy = 'bulletin' | 'class' | null

// With `cls`, a layout is also approved when its class was approved for the same content under another bulletin.
// Revoking a bulletin keeps it off even if its class is approved.
export function approvalWith(
  approvals: Approvals, site: string, bulletinId: string, digest?: string, cls?: { key: string; digest: string },
): { approved: boolean; stale: boolean; by: ApprovedBy } {
  const record = approvals.layouts[layoutKey(site, bulletinId)]
  const state = approvalState(record, digest)
  if (state.approved) return { ...state, by: 'bulletin' }
  const byClass = cls && approvals.classes?.[classKey(site, cls.key)]
  if (cls && record?.approved !== false && byClass?.approved && byClass.digest === cls.digest) return { approved: true, stale: false, by: 'class' }
  return { ...state, by: null }
}

// Screens only ever show layouts an operator approved, and only at sites with auto publish on. With the current
// digest of the layout files, the approval must also be for these very files.
export function liveLayoutGateWith(
  approvals: Approvals, site: string, bulletinId: string, digest?: string, cls?: { key: string; digest: string },
): { gate: LiveLayoutGate; by: ApprovedBy } {
  if (!approvals.sites[site]?.auto_publish) return { gate: 'auto-publish-off', by: null }
  const state = approvalWith(approvals, site, bulletinId, digest, cls)
  return { gate: state.approved ? 'ok' : state.stale ? 'stale' : 'unapproved', by: state.by }
}

export function liveLayoutGate(approvals: Approvals, site: string, bulletinId: string, digest?: string, cls?: { key: string; digest: string }): LiveLayoutGate {
  return liveLayoutGateWith(approvals, site, bulletinId, digest, cls).gate
}
