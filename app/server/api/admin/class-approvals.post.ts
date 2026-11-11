export default defineEventHandler(async (event) => {
  const admin = event.context.admin
  const request = parseClassApproval(await readBody(event))
  const facility = facilityInScope(admin, request.facilityId)
  if (facility === undefined && !request.siteIds) throw problem(400, 'invalid-request', 'facility_id or site_ids is required with the operator credential')
  const siteIds = request.siteIds ?? (await readSites()).filter((site) => siteVisibleTo(admin, site) && site.facility_id === facility).map((site) => site.id).sort()
  if (siteIds.length > MAX_SITE_IDS) tooManySites(siteIds.length)
  const ctx: BulkContext = { admin, facility, cls: request.cls, at: new Date().toISOString(), approver: approverOf(admin, event.context.audit?.actor, 'bulk') }
  const results = await mapLimited(siteIds, SITES_APPROVED_AT_ONCE, (id) => (request.approved ? approveClassAt(id, ctx) : revokeClassAt(id, ctx)))
  if (event.context.audit) {
    const count = (result: SiteResult['result']) => results.filter((r) => r.result === result).length
    event.context.audit.class_approvals = { class: request.cls, approved: request.approved, results: { approved: count('approved'), revoked: count('revoked'), skipped: count('skipped') } }
  }
  return { class: request.cls, results }
})
