export default defineEventHandler(async (event) => {
  const admin = event.context.admin
  const facility = facilityInScope(admin, getQuery(event).facility_id)
  if (facility === undefined) throw problem(400, 'invalid-request', 'facility_id is required with the operator credential')
  const [approvals, tables] = await Promise.all([readApprovals(), readHeadlineTables()])
  const sites = (await readSites()).filter((site) => siteVisibleTo(admin, site) && site.facility_id === facility)
  const listed = await mapLimited(sites, SITES_READ_AT_ONCE, async (site) => ({
    site_id: site.id,
    classes: await readWhileOwned(site.id, { visible: () => readVisibleSite(site.id, admin), read: (current) => classesAtSite(current, approvals, tables) }),
  }))
  return { classes: classSummaries(listed.flatMap(({ site_id, classes }) => (classes ? [{ site_id, classes }] : []))) }
})
