const MIN_SECRET_LENGTH = 16

export default defineEventHandler(async (event) => {
  const body = await readBody<{ site_id?: unknown; url?: unknown; secret?: unknown }>(event)
  if (!isSiteId(body.site_id)) throw createError({ status: 400, statusText: 'Bad Request', message: 'site_id is required' })
  if (typeof body.secret !== 'string' || body.secret.length < MIN_SECRET_LENGTH) {
    throw createError({ status: 400, statusText: 'Bad Request', message: `secret must be at least ${MIN_SECRET_LENGTH} characters` })
  }
  const check = checkWebhookUrl(body.url)
  if (!check.ok) throw createError({ status: 400, statusText: 'Bad Request', message: check.reason })
  const siteId = body.site_id
  const secret = body.secret
  const admin = event.context.admin
  const created = await guardedSiteWrite(siteId, {
    visible: async () => (await readVisibleSite(siteId, admin)) !== undefined,
    prepare: async () => {
      try {
        await assertWebhookTarget(check.url, webhookAllowsPrivate())
      } catch (error) {
        throw createError({ status: 400, statusText: 'Bad Request', message: (error as Error).message })
      }
    },
    write: () => addSubscription({ site_id: siteId, url: check.url.href, secret }),
  })
  if (!created) throw siteNotFound(siteId)
  const { id, site_id, url, created_at } = created.value
  setResponseStatus(event, 201)
  return { id, site_id, url, created_at }
})
