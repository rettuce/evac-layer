const FACILITY_ID = /^[a-z0-9][a-z0-9-]{2,63}$/

export default defineEventHandler(async (event) => {
  const admin = event.context.admin
  const { facility_id: wanted } = getQuery(event)
  if (wanted !== undefined && !(typeof wanted === 'string' && FACILITY_ID.test(wanted))) throw problem(400, 'invalid-request', 'facility_id is invalid')
  const sites = (await readSites()).filter((site) => siteVisibleTo(admin, site) && (admin?.kind === 'facility' || wanted === undefined || site.facility_id === wanted))
  const approvals = await readApprovals()
  const states = await Promise.all(sites.map((site) => readWhileOwned(site.id, { visible: () => readVisibleSite(site.id, admin), read: (current) => siteState(current, approvals) })))
  return { sites: states.filter((state) => state !== undefined) }
})
