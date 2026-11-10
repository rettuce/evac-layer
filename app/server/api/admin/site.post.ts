export default defineEventHandler(async (event) => {
  const body = await readBody<{ site_id?: unknown; auto_publish?: unknown }>(event)
  if (!isSiteId(body.site_id) || typeof body.auto_publish !== 'boolean') {
    throw createError({ status: 400, statusText: 'Bad Request', message: 'site_id and auto_publish are required' })
  }
  const siteId = body.site_id
  const autoPublish = body.auto_publish
  const admin = event.context.admin
  const record = await guardedSiteWrite(siteId, {
    visible: async () => (await readVisibleSite(siteId, admin)) !== undefined,
    write: () => updateApprovals((approvals) => (approvals.sites[siteId] = { auto_publish: autoPublish, updated_at: new Date().toISOString() })),
  })
  if (!record) throw siteNotFound(siteId)
  if (autoPublish) await requestMissingExports(siteId).catch((error: Error) => console.warn(`[export] ${siteId} not queued: ${error.message}`))
  return record.value
})
