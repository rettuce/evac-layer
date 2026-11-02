const SITE_ID = /^[A-Za-z0-9_-]{1,80}$/

export default defineEventHandler(async (event) => {
  const body = await readBody<{ site_id?: unknown; auto_publish?: unknown }>(event)
  if (typeof body.site_id !== 'string' || !SITE_ID.test(body.site_id) || typeof body.auto_publish !== 'boolean') {
    throw createError({ status: 400, statusText: 'Bad Request', message: 'site_id and auto_publish are required' })
  }
  const approvals = await readApprovals()
  approvals.sites[body.site_id] = { auto_publish: body.auto_publish, updated_at: new Date().toISOString() }
  await writeApprovals(approvals)
  return approvals.sites[body.site_id]
})
