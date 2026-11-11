import { type Approvals, type Approver, classApprovable, classKey, layoutKey, passedBrowserCheck, revokeClasses } from '~~/layout/gate'
import type { AdminPrincipal } from './adminPolicy'
import type { ClassState, SiteClass } from './siteState'

export const CLASS_KEY = /^[a-z_]+\/[a-z-]+\/[1-5-]$/
export const FACILITY_ID = /^[a-z0-9][a-z0-9-]{2,63}$/
export const MAX_SITE_IDS = 200

export type BlockReason = 'not-passed' | 'stale' | 'draft-wording'
export type SkipReason = BlockReason | 'not-found' | 'no-screens' | 'not-approved'

export interface SiteResult {
  site_id: string
  result: 'approved' | 'revoked' | 'skipped'
  reason?: SkipReason
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

// generate marks a class composed with the Writer's placeholder text as not approvable; the report of each bulletin
// keeps the same Writer source, and also covers the real bulletins that receive composed without a Writer.
function placeholderWording(report: unknown): boolean {
  const attempts = (report as { attempts?: { writer_source?: unknown }[] } | undefined)?.attempts
  return Array.isArray(attempts) && attempts.at(-1)?.writer_source === 'placeholder'
}

// Why the class at a site cannot be approved in bulk. In bulk the browser check is the only thing that looked at the
// screens, so only screens it passed, of the site's present place, with real wording, are approved.
export function bulkBlock({ state, snapshot }: SiteClass): BlockReason | undefined {
  if (state.outcome !== 'pass' || !passedBrowserCheck(snapshot.report, snapshot.digest)) return 'not-passed'
  if (state.stale) return 'stale'
  if (placeholderWording(snapshot.report)) return 'draft-wording'
  return undefined
}

export function classSummaries(sites: { site_id: string; classes: SiteClass[] }[]): ClassSummary[] {
  const rows = new Map<string, { site_id: string; entry: SiteClass }[]>()
  for (const { site_id, classes } of [...sites].sort((a, b) => a.site_id.localeCompare(b.site_id))) {
    for (const entry of classes) {
      if (classApprovable(entry.state.class)) rows.set(entry.state.class, [...(rows.get(entry.state.class) ?? []), { site_id, entry }])
    }
  }
  return [...rows]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cls, list]) => {
      const approved = list.filter(({ entry }) => entry.state.approved).length
      const blocked = list.flatMap(({ entry }) => (entry.state.approved ? [] : [bulkBlock(entry)].filter((r): r is BlockReason => r !== undefined)))
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

// As GET /api/admin/sites: a facility credential is held to its own facility whatever facility_id it sends.
export function facilityInScope(admin: AdminPrincipal | undefined, wanted: unknown): string | undefined {
  if (wanted !== undefined && !(typeof wanted === 'string' && FACILITY_ID.test(wanted))) throw problem(400, 'invalid-request', 'facility_id is invalid')
  return admin?.kind === 'facility' ? admin.facility_id : wanted
}

export interface ClassApprovalRequest {
  cls: string
  approved: boolean
  siteIds?: string[]
  facilityId?: string
}

const BODY_FIELDS = new Set(['class', 'approved', 'site_ids', 'facility_id', 'actor'])

function invalid(message: string): never {
  throw problem(400, 'invalid-request', message)
}

export function parseClassApproval(body: unknown): ClassApprovalRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) invalid('the body must be an object')
  const fields = body as Record<string, unknown>
  const unknown = Object.keys(fields).find((key) => !BODY_FIELDS.has(key))
  if (unknown) invalid(`unknown field ${unknown}`)
  const { class: cls, approved, site_ids: siteIds, facility_id: facilityId } = fields
  if (typeof cls !== 'string' || !CLASS_KEY.test(cls) || !classApprovable(cls)) invalid('class must be <hazard>/<template>/<level> of a class that can be approved (not a drill or test)')
  if (typeof approved !== 'boolean') invalid('approved must be true or false')
  if (facilityId !== undefined && !(typeof facilityId === 'string' && FACILITY_ID.test(facilityId))) invalid('facility_id is invalid')
  if (siteIds === undefined) return { cls, approved, ...(facilityId !== undefined ? { facilityId } : {}) }
  if (!Array.isArray(siteIds) || !siteIds.length || !siteIds.every(isSiteId)) invalid('site_ids must be a non-empty list of site ids')
  const unique = [...new Set(siteIds)]
  if (unique.length > MAX_SITE_IDS) invalid(`site_ids holds more than ${MAX_SITE_IDS} sites; send them in several requests`)
  return { cls, approved, siteIds: unique, ...(facilityId !== undefined ? { facilityId } : {}) }
}

// The same approval already in place is kept as it is, so a bulk approval does not turn a reviewed one into bulk.
export function alreadyApproved(approvals: Approvals, site: string, { state, snapshot }: SiteClass): boolean {
  const bulletin = approvals.layouts[layoutKey(site, state.bulletin_id)]
  const record = approvals.classes?.[classKey(site, state.class)]
  return !!bulletin?.approved && bulletin.digest === snapshot.digest && !!record?.approved && record.digest === snapshot.cls.digest && record.approved_from === state.bulletin_id
}

// A class approval falls as it does when the bulletin it was approved from is revoked: that bulletin's own approval,
// where it still stands, and every class approved from it.
export function revokeClassApproval(approvals: Approvals, site: string, cls: string, at: string): boolean {
  const record = approvals.classes?.[classKey(site, cls)]
  if (!record?.approved) return false
  const bulletin = layoutKey(site, record.approved_from)
  if (approvals.layouts[bulletin]?.approved) approvals.layouts[bulletin] = { approved: false, updated_at: at }
  approvals.classes = revokeClasses(approvals.classes ?? {}, site, record.approved_from, cls, at)
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

async function classAt(id: string, ctx: BulkContext): Promise<SiteClass | undefined> {
  const site = await siteInScope(id, ctx)
  return site && (await siteClasses(site, await readApprovals())).find(({ state }) => state.class === ctx.cls)
}

function withState(result: SiteResult, entry: SiteClass | undefined): SiteResult {
  return entry ? { ...result, state: entry.state } : result
}

const notFound = (site_id: string): SiteResult => ({ site_id, result: 'skipped', reason: 'not-found' })

export async function approveClassAt(id: string, ctx: BulkContext): Promise<SiteResult> {
  const same = stillSameSite(id, async () => (await siteInScope(id, ctx)) !== undefined)
  const site = await siteInScope(id, ctx)
  if (!site) return notFound(id)
  const entry = (await siteClasses(site, await readApprovals())).find(({ state }) => state.class === ctx.cls)
  if (!entry) return { site_id: id, result: 'skipped', reason: 'no-screens' }
  const block = bulkBlock(entry)
  if (block) return { site_id: id, result: 'skipped', reason: block, state: entry.state }
  const written = await guardedSiteWrite(id, {
    visible: same,
    write: () =>
      updateApprovals((approvals) => {
        if (!alreadyApproved(approvals, id, entry)) approveBulletin(approvals, id, entry.state.bulletin_id, entry.snapshot, ctx.at, ctx.approver)
      }),
  })
  if (!written) return notFound(id)
  await requestMissingExports(id).catch((error: Error) => console.warn(`[export] ${id} not queued: ${error.message}`))
  return withState({ site_id: id, result: 'approved' }, await classAt(id, ctx))
}

export async function revokeClassAt(id: string, ctx: BulkContext): Promise<SiteResult> {
  const same = stillSameSite(id, async () => (await siteInScope(id, ctx)) !== undefined)
  if (!(await siteInScope(id, ctx))) return notFound(id)
  const written = await guardedSiteWrite(id, { visible: same, write: () => updateApprovals((approvals) => revokeClassApproval(approvals, id, ctx.cls, ctx.at)) })
  if (!written) return notFound(id)
  const result: SiteResult = written.value ? { site_id: id, result: 'revoked' } : { site_id: id, result: 'skipped', reason: 'not-approved' }
  return withState(result, await classAt(id, ctx))
}
