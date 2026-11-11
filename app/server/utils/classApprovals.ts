import { type Approvals, type Approver, approvalState, classApprovable, classKey, isSyntheticBulletinId, layoutKey } from '~~/layout/gate'
import { type HeadlineTables, headlineMatchesCheckedTable } from '~~/layout/headlineTable'
import type { AdminPrincipal } from './adminPolicy'
import type { LayoutSnapshot } from './approvals'
import { type BlockReason, type SkipReason, approveRechecked, wordingOf } from './classApprovalSteps'
import type { Representative } from './screenClasses'
import type { ClassState, SiteClass } from './siteState'

export const CLASS_KEY = /^[a-z_]+\/[a-z-]+\/[1-5-]$/
export const FACILITY_ID = /^[a-z0-9][a-z0-9-]{2,63}$/
export const MAX_SITE_IDS = 200
export const SITES_READ_AT_ONCE = 8
export const SITES_APPROVED_AT_ONCE = 4

export interface SiteResult {
  site_id: string
  result: 'approved' | 'revoked' | 'skipped'
  reason?: SkipReason
  bulletin_approvals_left?: string[]
  state?: ClassState
}

export interface ClassSummary {
  class: string
  total: number
  approved: number
  pending: number
  blocked: { count: number; reasons: BlockReason[] }
  live: boolean
  sites: { site_id: string; state: ClassState }[]
}

// Why the class at a site cannot be approved in bulk. In bulk the browser check is the only thing that looked at the
// screens, so only screens it passed, of the site's present place, whose headline is shown to be the table's and whose
// wording is known to be real are approved. Whether the ja_easy table is reviewed is left to the delivery gate.
export function bulkBlock(snapshot: LayoutSnapshot, stale: boolean, tables: HeadlineTables | undefined): BlockReason | undefined {
  if (!snapshot.cls.checked) return 'not-passed'
  if (stale) return 'stale'
  if (!headlineMatchesCheckedTable({ files: snapshot.files, digest: snapshot.digest, report: snapshot.report, tables })) return 'headline-unchecked'
  const wording = wordingOf(snapshot.report)
  return wording === 'real' ? undefined : wording === 'draft' ? 'draft-wording' : 'wording-unknown'
}

export function classApprovedFor(approvals: Approvals, site: string, snapshot: LayoutSnapshot): boolean {
  const record = approvals.classes?.[classKey(site, snapshot.cls.key)]
  return !!record?.approved && record.digest === snapshot.cls.digest
}

export interface ClassAtSite extends SiteClass {
  block: BlockReason | undefined
  classApproved: boolean
}

export function classSummaries(sites: { site_id: string; classes: ClassAtSite[] }[]): ClassSummary[] {
  const rows = new Map<string, { site_id: string; entry: ClassAtSite }[]>()
  for (const { site_id, classes } of [...sites].sort((a, b) => a.site_id.localeCompare(b.site_id))) {
    for (const entry of classes) {
      if (classApprovable(entry.state.class)) rows.set(entry.state.class, [...(rows.get(entry.state.class) ?? []), { site_id, entry }])
    }
  }
  return [...rows]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cls, list]) => {
      const approved = list.filter(({ entry }) => entry.classApproved).length
      const blocked = list.flatMap(({ entry }) => (!entry.classApproved && entry.block ? [entry.block] : []))
      return {
        class: cls,
        total: list.length,
        approved,
        pending: list.length - approved - blocked.length,
        blocked: { count: blocked.length, reasons: [...new Set(blocked)].sort() },
        live: list.some(({ entry }) => entry.state.live),
        sites: list.map(({ site_id, entry }) => ({ site_id, state: entry.state })),
      }
    })
}

export async function classesAtSite(site: SiteFile, approvals: Approvals, tables: HeadlineTables | undefined): Promise<ClassAtSite[]> {
  return (await siteClasses(site, approvals)).map((entry) => ({ ...entry, block: bulkBlock(entry.snapshot, entry.state.stale, tables), classApproved: classApprovedFor(approvals, site.id, entry.snapshot) }))
}

// As GET /api/admin/sites: a facility credential is held to its own facility whatever facility_id it sends.
export function facilityInScope(admin: AdminPrincipal | undefined, wanted: unknown): string | undefined {
  if (wanted !== undefined && !(typeof wanted === 'string' && FACILITY_ID.test(wanted))) throw problem(400, 'invalid-request', 'facility_id is invalid')
  return admin?.kind === 'facility' ? admin.facility_id : wanted
}

export function tooManySites(count: number): never {
  throw problem(400, 'too-many-sites', `${count} sites is more than ${MAX_SITE_IDS} in one request; send them in several requests with site_ids`)
}

export interface ClassApprovalRequest {
  cls: string
  approved: boolean
  siteIds?: string[]
  facilityId?: string
}

const BODY_FIELDS = new Set(['class', 'approved', 'site_ids', 'facility_id', 'actor'])
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/

// The actor is copied into every class approval of the request, where a management page shows it.
function hasControlCharacter(actor: unknown): boolean {
  if (typeof actor !== 'object' || actor === null) return false
  return Object.values(actor).some((value) => typeof value === 'string' && CONTROL_CHARACTER.test(value))
}

function invalid(message: string): never {
  throw problem(400, 'invalid-request', message)
}

export function parseClassApproval(body: unknown): ClassApprovalRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) invalid('the body must be an object')
  const fields = body as Record<string, unknown>
  const unknown = Object.keys(fields).find((key) => !BODY_FIELDS.has(key))
  if (unknown) invalid(`unknown field ${unknown}`)
  if (hasControlCharacter(fields.actor)) invalid('actor: id and name must not hold control characters')
  const { class: cls, approved, site_ids: siteIds, facility_id: facilityId } = fields
  if (typeof cls !== 'string' || !CLASS_KEY.test(cls) || !classApprovable(cls)) invalid('class must be <hazard>/<template>/<level> of a class that can be approved (not a drill or test)')
  if (typeof approved !== 'boolean') invalid('approved must be true or false')
  if (facilityId !== undefined && !(typeof facilityId === 'string' && FACILITY_ID.test(facilityId))) invalid('facility_id is invalid')
  if (siteIds === undefined) return { cls, approved, ...(facilityId !== undefined ? { facilityId } : {}) }
  if (!Array.isArray(siteIds) || !siteIds.length) invalid('site_ids must be a non-empty list of site ids')
  if (siteIds.length > MAX_SITE_IDS) tooManySites(siteIds.length)
  if (!siteIds.every(isSiteId)) invalid('site_ids must be a non-empty list of site ids')
  return { cls, approved, siteIds: [...new Set(siteIds)], ...(facilityId !== undefined ? { facilityId } : {}) }
}

// The same class approval already in place is kept as it is, so a bulk approval does not turn a reviewed one into bulk.
function sameClassApproval(approvals: Approvals, site: string, bulletin: string, snapshot: LayoutSnapshot): boolean {
  const record = approvals.classes?.[classKey(site, snapshot.cls.key)]
  return !!record?.approved && record.digest === snapshot.cls.digest && record.approved_from === bulletin
}

// Only the class approval falls, whichever bulletin it was approved from. A bulletin approval records that a person
// looked at that bulletin's screens, and a bulk request does not take it back.
function revokeClassApproval(approvals: Approvals, site: string, cls: string, at: string, approver: Approver): boolean {
  const key = classKey(site, cls)
  const record = approvals.classes?.[key]
  if (!record?.approved) return false
  const { actor: _actor, ...kept } = record
  approvals.classes = { ...approvals.classes, [key]: { ...kept, approved: false, updated_at: at, ...approver } }
  return true
}

export interface BulkContext {
  admin: AdminPrincipal | undefined
  facility: string | undefined
  cls: string
  at: string
  approver: Approver
}

async function siteInScope(id: string, ctx: BulkContext): Promise<SiteFile | undefined> {
  const site = await readVisibleSite(id, ctx.admin)
  return site && (ctx.facility === undefined || site.facility_id === ctx.facility) ? site : undefined
}

// Reads neither the generation jobs that are running nor the site's lock: what stands for a class and whether it is
// stale follow from the last finished jobs alone, so this can be read again under the lock.
async function representativeOf(id: string, cls: string): Promise<Representative | undefined> {
  const site = await readSite(id)
  return site && (await representatives(site, await readRawGenerationFile(id))).find((rep) => rep.cls === cls)
}

// The state answered is read after the change, and only of the site that was changed: one deleted, or deleted and
// registered again, since the request began answers as not found.
async function answer(id: string, ctx: BulkContext, same: () => Promise<boolean>, result: SiteResult): Promise<SiteResult> {
  const site = await siteInScope(id, ctx)
  const entry = site && (await siteClasses(site, await readApprovals())).find(({ state }) => state.class === ctx.cls)
  if (!(await same())) return notFound(id)
  return entry ? { ...result, state: entry.state } : result
}

const notFound = (site_id: string): SiteResult => ({ site_id, result: 'skipped', reason: 'not-found' })

export async function approveClassAt(id: string, ctx: BulkContext): Promise<SiteResult> {
  const same = stillSameSite(id, async () => (await siteInScope(id, ctx)) !== undefined)
  if (!(await siteInScope(id, ctx))) return notFound(id)
  const outcome = await approveRechecked({
    read: async () => {
      const rep = await representativeOf(id, ctx.cls)
      return rep && { bulletin_id: rep.row.bulletin_id, digest: rep.snapshot.digest, class_digest: rep.snapshot.cls.digest, rep }
    },
    block: async ({ rep }) => bulkBlock(rep.snapshot, rep.stale, await readHeadlineTables()),
    guard: (write) => guardedSiteWrite(id, { visible: same, write }),
    write: ({ rep }) =>
      updateApprovals((approvals) => {
        if (!sameClassApproval(approvals, id, rep.row.bulletin_id, rep.snapshot)) approveClass(approvals, id, rep.row.bulletin_id, rep.snapshot, ctx.at, ctx.approver)
      }),
  })
  if (outcome === 'not-found') return notFound(id)
  if (outcome === 'no-screens') return (await same()) ? { site_id: id, result: 'skipped', reason: 'no-screens' } : notFound(id)
  if (outcome === 'approved') await requestMissingExports(id).catch((error: Error) => console.warn(`[export] ${id} not queued: ${error.message}`))
  return answer(id, ctx, same, outcome === 'approved' ? { site_id: id, result: 'approved' } : { site_id: id, result: 'skipped', reason: outcome })
}

// The bulletins of the class at the site that still go out on an approval of their own after the class is revoked.
async function bulletinApprovalsLeft(id: string, cls: string): Promise<string[]> {
  const approvals = await readApprovals()
  const left: string[] = []
  for (const row of (await readLayoutIndex(id))?.entries ?? []) {
    if (!row.screen || isSyntheticBulletinId(row.bulletin_id)) continue
    const snapshot = await readLayoutSnapshot(id, row.bulletin_id)
    if (snapshot?.cls.key === cls && approvalState(approvals.layouts[layoutKey(id, row.bulletin_id)], snapshot.digest).approved) left.push(row.bulletin_id)
  }
  return left.sort()
}

export async function revokeClassAt(id: string, ctx: BulkContext): Promise<SiteResult> {
  const same = stillSameSite(id, async () => (await siteInScope(id, ctx)) !== undefined)
  if (!(await siteInScope(id, ctx))) return notFound(id)
  const written = await guardedSiteWrite(id, { visible: same, write: () => updateApprovals((approvals) => revokeClassApproval(approvals, id, ctx.cls, ctx.at, ctx.approver)) })
  if (!written) return notFound(id)
  const left = await bulletinApprovalsLeft(id, ctx.cls)
  const result: SiteResult = written.value ? { site_id: id, result: 'revoked' } : { site_id: id, result: 'skipped', reason: 'not-approved' }
  return answer(id, ctx, same, left.length ? { ...result, bulletin_approvals_left: left } : result)
}
