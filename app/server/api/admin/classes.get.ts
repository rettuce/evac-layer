export default defineEventHandler(async (event) => {
  const admin = event.context.admin
  const facility = facilityInScope(admin, getQuery(event).facility_id)
  if (facility === undefined) throw problem(400, 'invalid-request', 'facility_id is required with the operator credential')
  const approvals = await readApprovals()
  const sites = (await readSites()).filter((site) => siteVisibleTo(admin, site) && site.facility_id === facility)
  const listed = await Promise.all(
    sites.map(async (site) => ({ site_id: site.id, classes: await readWhileOwned(site.id, { visible: () => readVisibleSite(site.id, admin), read: (current) => siteClasses(current, approvals) }) })),
  )
  return { classes: classSummaries(listed.flatMap(({ site_id, classes }) => (classes ? [{ site_id, classes }] : []))) }
})
