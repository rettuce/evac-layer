import { createHash } from 'node:crypto'

// Synthetic bulletins are composed in advance from JMA sample bulletins so that their screens can be approved before
// a real one arrives. They are never a bulletin of their own on a screen: their approval only stands for the class.
export const SYNTHETIC_PREFIX = 'SYN-'

export function isSyntheticBulletinId(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(SYNTHETIC_PREFIX)
}

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

export function layoutDigest(files: { shape: string; body: string }[]): string {
  const hash = createHash('sha256')
  for (const file of [...files].sort((a, b) => a.shape.localeCompare(b.shape))) hash.update(`${file.shape}\n${file.body}\n`)
  return `sha256:${hash.digest('hex')}`
}

interface ClassedLayout {
  template?: string
  alert?: { hazard?: string; level?: number | null; bulletin_id?: string; issued_at?: string; status?: string }
  cells?: { role?: string; text?: Record<string, unknown> }[]
  sources?: { type?: string; bulletin_id?: string }[]
}

export const DRILL_PREFIX_JA = '【訓練】'

export type BulletinStatus = 'normal' | 'test' | 'drill'

// Layouts composed before the status was written carry it only in the headline the Composer prefixes on a drill.
export function layoutStatus(layout: ClassedLayout): BulletinStatus {
  const status = layout.alert?.status
  if (status === 'drill' || status === 'test') return status
  const headline = layout.cells?.find((cell) => cell.role === 'headline')?.text?.ja
  return typeof headline === 'string' && headline.startsWith(DRILL_PREFIX_JA) ? 'drill' : 'normal'
}

// A drill or test screen has a class of its own that no class approval is ever written for or read from: such
// bulletins are approved one by one (the bundled demos), never by class. The index row's status covers a test
// bulletin's layout written before layouts carried one.
export function screenClass(layout: ClassedLayout, rowStatus?: string): string {
  const own = layoutStatus(layout)
  const status = own === 'normal' && (rowStatus === 'drill' || rowStatus === 'test') ? rowStatus : own
  return `${layout.alert?.hazard}/${layout.template}/${layout.alert?.level ?? '-'}${status === 'normal' ? '' : `/${status}`}`
}

export function classApprovable(cls: string): boolean {
  return !/\/(drill|test)$/.test(cls)
}

function withoutJmaWarningNameAndSource({ text, ...cell }: NonNullable<ClassedLayout['cells']>[number]): NonNullable<ClassedLayout['cells']>[number] {
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
    ...(layout.cells ? { cells: layout.cells.map(withoutJmaWarningNameAndSource) } : {}),
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

export function classDigest(files: { shape: string; body: string }[]): string {
  return layoutDigest(files.map((file) => ({ shape: file.shape, body: canonicalJson(withoutBulletin(JSON.parse(file.body) as ClassedLayout)) })))
}

export function classKey(site: string, cls: string): string {
  return `${site}/${cls}`
}

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

export type LiveLayoutGate = 'ok' | 'auto-publish-off' | 'unapproved' | 'stale' | 'synthetic'
export type ApprovedBy = 'bulletin' | 'class' | null
export interface LayoutClass { key: string; digest: string; checked: boolean }

// The class digest leaves the JMA warning name out, so only a bulletin whose own screens passed the browser check
// (where an overflowing headline is caught) may go out on a class approval.
export interface CheckReport { outcome?: string; verifier?: string; layout_digest?: string; browser_skipped?: string[] }

export function passedBrowserCheck(report: CheckReport | undefined, layoutDigestNow: string): boolean {
  return report?.outcome === 'pass' && /browser|vision/.test(report.verifier ?? '') && !report.browser_skipped?.length && report.layout_digest === layoutDigestNow
}

export function approvalWith(
  approvals: Approvals, site: string, bulletinId: string, digest?: string, cls?: LayoutClass,
): { approved: boolean; stale: boolean; by: ApprovedBy } {
  const record = approvals.layouts[layoutKey(site, bulletinId)]
  const state = approvalState(record, digest)
  if (state.approved) return { ...state, by: 'bulletin' }
  const revoked = record?.approved === false
  const byClass = cls && approvals.classes?.[classKey(site, cls.key)]
  if (cls?.checked && classApprovable(cls.key) && !revoked && byClass?.approved && byClass.digest === cls.digest) return { approved: true, stale: false, by: 'class' }
  return { ...state, by: null }
}

export function liveLayoutGateWith(
  approvals: Approvals, site: string, bulletinId: string, digest?: string, cls?: LayoutClass,
): { gate: LiveLayoutGate; by: ApprovedBy } {
  if (isSyntheticBulletinId(bulletinId)) return { gate: 'synthetic', by: null }
  if (!approvals.sites[site]?.auto_publish) return { gate: 'auto-publish-off', by: null }
  const state = approvalWith(approvals, site, bulletinId, digest, cls)
  return { gate: state.approved ? 'ok' : state.stale ? 'stale' : 'unapproved', by: state.by }
}

export function liveLayoutGate(approvals: Approvals, site: string, bulletinId: string, digest?: string, cls?: LayoutClass): LiveLayoutGate {
  return liveLayoutGateWith(approvals, site, bulletinId, digest, cls).gate
}
