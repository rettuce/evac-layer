const MIN_SECRET_LENGTH = 16

export default defineEventHandler(async (event) => {
  const body = await readBody<{ site_id?: unknown; url?: unknown; secret?: unknown }>(event)
  if (!isSiteId(body.site_id)) throw createError({ status: 400, statusText: 'Bad Request', message: 'site_id is required' })
  if (typeof body.secret !== 'string' || body.secret.length < MIN_SECRET_LENGTH) {
    throw createError({ status: 400, statusText: 'Bad Request', message: `secret must be at least ${MIN_SECRET_LENGTH} characters` })
  }
  const check = checkWebhookUrl(body.url)
  if (!check.ok) throw createError({ status: 400, statusText: 'Bad Request', message: check.reason })
  await readSiteOr404(body.site_id, event.context.admin)
  try {
    await assertWebhookTarget(check.url, webhookAllowsPrivate())
  } catch (error) {
    throw createError({ status: 400, statusText: 'Bad Request', message: (error as Error).message })
  }
  const { id, site_id, url, created_at } = await addSubscription({ site_id: body.site_id, url: check.url.href, secret: body.secret })
  setResponseStatus(event, 201)
  return { id, site_id, url, created_at }
})
